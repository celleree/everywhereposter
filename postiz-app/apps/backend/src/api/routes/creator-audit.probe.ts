import { collectInstagramAudit, InstagramAuditConnection } from './creator-audit.collector';
import { MetricName } from './creator-audit.metrics';

/** Exactly one account/Reel, no retries, pagination, refresh, downloads, persistence or resumable state. */
export async function runInstagramCapabilityProbe(connection: InstagramAuditConnection, runId: string,
  options: { fetcher?: typeof fetch; targetMediaId?: string; metrics?: readonly MetricName[] } = {}) {
  const result = await collectInstagramAudit(connection, runId, { fetcher: options.fetcher,
    capabilityProbe: { targetMediaId: options.targetMediaId, metrics: options.metrics } });
  // Assets, username, permalink, tokens, captions and checkpoint never leave the collector.
  return result.probeEvidence!;
}
