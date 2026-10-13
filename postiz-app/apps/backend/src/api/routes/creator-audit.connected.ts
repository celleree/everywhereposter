import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { collectInstagramAudit, InstagramAuditCheckpoint } from './creator-audit.collector';
import { auditAssertion, creatorAuditConfig } from './creator-audit.proxy';

type Connection = { id: string; organizationId: string; internalId: string; providerIdentifier: string; token: string;
  disabled?: boolean; deletedAt?: unknown; refreshNeeded?: boolean; inBetweenSteps?: boolean; tokenExpiration?: Date | string | null };
type Job = { id: string; org: string; actor: string; integrationId: string; cap: number;
  status: 'running' | 'paused' | 'submitted' | 'error' | 'done'; checkpoint?: InstagramAuditCheckpoint;
  collection?: Awaited<ReturnType<typeof collectInstagramAudit>>; error_code?: string; attempt: number };

/** Small adapter around the existing private task API. Checkpoints never enter browser payloads. */
export class ConnectedAuditJobs {
  private readonly jobs = new Map<string, Job>();
  constructor(private readonly lookup: (org: string, id: string) => Promise<Connection | null | undefined>) {}

  private async connection(org: string, id: string) {
    const connection = await this.lookup(org, id);
    if (!connection || connection.organizationId !== org || connection.id !== id || connection.disabled || connection.deletedAt ||
        connection.inBetweenSteps || !['instagram', 'instagram-standalone'].includes(connection.providerIdentifier)) {
      throw new HttpException('Select an available Instagram connection in this workspace.', 400);
    }
    const expires = connection.tokenExpiration ? new Date(connection.tokenExpiration).getTime() : null;
    if (!connection.token || connection.refreshNeeded || (expires !== null && (!Number.isFinite(expires) || expires <= Date.now()))) {
      throw new HttpException('Reconnect this Instagram account before collecting Insights.', 409);
    }
    return connection;
  }

  async start(org: string, actor: string, body: unknown) {
    if (!creatorAuditConfig()) throw new HttpException('Creator Audit is unavailable.', 404);
    const input = body as Record<string, unknown>;
    if (!input || Array.isArray(input) || Object.keys(input).some(k => !['integration_id', 'resume_task_id', 'analysis_cap'].includes(k)) ||
        typeof input.integration_id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(input.integration_id)) {
      throw new HttpException('Choose a connected Instagram account.', 400);
    }
    const cap = input.analysis_cap ?? 30;
    if (!Number.isInteger(cap) || Number(cap) < 1 || Number(cap) > 30) throw new HttpException('Audit sample exceeds its budget.', 400);
    let job: Job;
    if (input.resume_task_id !== undefined) {
      if (typeof input.resume_task_id !== 'string') throw new HttpException('Audit task unavailable.', 404);
      const prior = this.jobs.get(input.resume_task_id);
      if (!prior || prior.org !== org || prior.integrationId !== input.integration_id || prior.cap !== cap) {
        throw new HttpException('Audit task unavailable.', 404);
      }
      if (['running', 'submitted'].includes(prior.status)) return { id: prior.id, kind: 'connected', status: 'running' };
      job = prior;
    } else {
      if ([...this.jobs.values()].some(j => j.org === org && ['running', 'submitted'].includes(j.status))) {
        throw new HttpException('Wait for the active audit or resume its saved task.', 409);
      }
      job = { id: randomUUID().replace(/-/g, ''), org, actor, integrationId: input.integration_id, cap: Number(cap), status: 'running', attempt: 0 };
    }
    await this.connection(org, job.integrationId); // Ownership and reconnect checks precede collection or assertions.
    if (input.resume_task_id && ['running', 'submitted'].includes(job.status)) return { id: job.id, kind: 'connected', status: 'running' };
    if ([...this.jobs.values()].some(j => j.org === org && j.id !== job.id && ['running', 'submitted'].includes(j.status))) {
      throw new HttpException('Wait for the active audit or resume its saved task.', 409);
    }
    if (this.jobs.size >= 100 && !this.jobs.has(job.id)) {
      const oldest = [...this.jobs.values()].find(j => !['running', 'submitted'].includes(j.status));
      if (!oldest) throw new HttpException('Audit worker is busy. Try later.', 503);
      this.jobs.delete(oldest.id);
    }
    job.status = 'running'; job.error_code = undefined; job.actor = actor;
    this.jobs.set(job.id, job);
    void this.run(job);
    return { id: job.id, kind: 'connected', status: 'running' };
  }

  current(org: string) {
    const own = [...this.jobs.values()].filter(j => j.org === org);
    return own.find(j => ['running', 'submitted'].includes(j.status))?.id ||
      own.reverse().find(j => ['paused', 'error'].includes(j.status))?.id || null;
  }
  owns(id: string, org: string) { return this.jobs.get(id)?.org === org; }
  identity(id: string, org: string) {
    const job = this.jobs.get(id);
    return job?.org === org ? { integration_id: job.integrationId, analysis_cap: job.cap } : {};
  }
  submitted(id: string, org: string) { return this.owns(id, org) && ['submitted', 'done'].includes(this.jobs.get(id)!.status); }
  finished(id: string, org: string) { if (this.owns(id, org)) this.jobs.get(id)!.status = 'done'; }
  view(id: string, org: string) {
    const job = this.jobs.get(id);
    if (!job || job.org !== org) throw new HttpException('Audit task unavailable.', 404);
    return { id, kind: 'connected', ...this.identity(id, org), status: job.status === 'running' ? 'running' : 'error',
      ...(job.status !== 'running' ? { error: 'Collection or processing needs attention. Reconnect or resume this account.',
        error_code: job.error_code || 'resume_available', resumable: true } : {}) };
  }

  private async run(job: Job) {
    try {
      const connection = await this.connection(job.org, job.integrationId);
      if (job.collection && (job.collection.snapshot.account_id !== connection.internalId ||
          job.collection.snapshot.provider !== connection.providerIdentifier)) throw new Error('connection_changed');
      const result = job.collection || await collectInstagramAudit(connection, randomUUID().replace(/-/g, ''), { checkpoint: job.checkpoint });
      job.checkpoint = result.checkpoint;
      const paused = ['auth_required', 'rate_limited', 'request_budget', 'time_budget', 'timeout', 'error'].includes(result.snapshot.coverage.partial_reason || '');
      if (!paused) job.collection = result;
      if (!result.account.username) { job.status = 'paused'; job.error_code = result.snapshot.coverage.partial_reason || 'account_unavailable'; return; }
      const config = creatorAuditConfig();
      if (!config) throw new Error('disabled');
      const path = '/api/audit/connected';
      const body = JSON.stringify({ task_id: job.id, account: result.account, snapshot: result.snapshot,
        assets: result.assets, analysis_cap: job.cap, ...(paused ? { collect_only: true } : {}) });
      if (Buffer.byteLength(body) > 4_000_000) throw new Error('snapshot_budget');
      const response = await fetch(config.origin + path, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: 'Bearer ' + auditAssertion(config.secret, job.org, job.actor, 'POST', path, body, true, 'connected_snapshot'),
          'Content-Type': 'application/json' }, body });
      if (response.status !== 202) throw new Error('receiver_rejected');
      job.attempt++;
      job.status = paused ? 'paused' : 'submitted';
      if (paused) job.error_code = result.snapshot.coverage.partial_reason || 'partial_collection';
    } catch {
      // Exceptions may contain tokens or expiring CDN URLs. Never serialize or log them.
      job.status = 'error'; job.error_code = 'connected_audit_interrupted';
    }
  }
}
