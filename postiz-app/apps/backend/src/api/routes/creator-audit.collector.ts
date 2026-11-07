// Isolated beta pin: live Meta capability/version support still requires an authorized probe.
import { CORE_METRICS, EXTRA_METRICS, METRICS, FOLLOWER_FIELD, MetricName, MetricUnit, metricName, metricUnit } from './creator-audit.metrics';
const API_VERSION = 'v25.0';
const MAX_RECORDS = 300, MAX_PAGES = 10, MAX_REQUESTS = 1900, TIMEOUT_MS = 15000;
type Status = 'available' | 'not_returned' | 'unsupported' | 'not_authorized' | 'error' | 'not_requested';
type Reason = 'auth_required' | 'rate_limited' | 'request_budget' | 'time_budget' | 'timeout' | 'error' | 'metadata_limit' | 'page_limit' | 'challenge_required' | 'redirect_blocked' | 'invalid_response' | 'no_owned_reel' | 'invalid_core_metric' | 'not_authorized' | 'response_budget';
export interface InstagramAuditConnection {
  id: string; organizationId: string; internalId: string;
  providerIdentifier: string; token: string;
}
interface Measurement {
  value: number | null; status: Status; unit: MetricUnit | null; definition: string;
  source: 'instagram_media_insights' | 'instagram_account_metadata'; api_version: string; observed_at: string;
  period: 'lifetime' | 'snapshot'; since: null; until: null;
  provider_definition?: string | null;
}
interface AuditRecord {
  media_id: string; account_id: string; shortcode: string; permalink: string; published_at: string;
  media_product_type: 'REELS'; relationship: 'primary_owned' | 'unknown'; owner_id: string | null;
  paid: null; trial: null; asset_status: 'available' | 'unavailable'; duration_seconds: null;
  metrics: Record<string, Measurement>;
}
interface Asset { media_id: string; url: string; caption: string }
interface State {
  identity: string; account: { account_id: string; username: string | null }; collectedAt: string;
  since: string; until: string; after: string | null; pages: number; discoveryDone: boolean;
  records: AuditRecord[]; assets: Asset[]; capabilities: Record<string, Status>; profileDone: boolean;
  truncated: boolean; terminalReason: Reason | null;
  accountMetrics?: Record<string, Measurement>;
}
// Transient SERVER-only state, including expiring CDN URLs. Never send or log this checkpoint.
export interface InstagramAuditCheckpoint { version: 1; state: State }
export interface InstagramAuditOptions {
  fetcher?: typeof fetch; now?: () => Date; checkpoint?: InstagramAuditCheckpoint;
  /** Server-only capability probe; its fixed limits cannot be overridden. */
  capabilityProbe?: { targetMediaId?: string; metrics?: readonly MetricName[] };
}
export interface InstagramProbeEvidence {
  requested_version: string; provider: string; request_count: number;
  ledger: { attempt: number; operation: 'profile' | 'metadata' | 'insights'; metric: string | null; http_status: number | null; response_version: string | null }[];
  status: 'complete' | 'stopped'; stop_reason: Reason | null;
  login_verified: boolean; primary_owned_reel_verified: boolean; asset_url_present: boolean | null;
  metrics: Record<string, { value: number | null; status: Status; returned_metric_name: string | null; returned_period: string | null;
    unit: string | null; definition: string | null; collector_unit_label: MetricUnit | null }>;
}
class Stop extends Error { constructor(readonly reason: Reason) { super(reason); } }
function invalid() { return new Error('instagram_audit_invalid_identity_or_response'); }
const numericId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,40}$/.test(value);
const safeLabel = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function canonicalReel(value: unknown) {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value)) return null;
  const match = /^https:\/\/(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]{1,64})\/?$/.exec(value);
  return match ? { shortcode: match[1], permalink: `https://www.instagram.com/reel/${match[1]}/` } : null;
}
// Allow exact Meta CDN domain boundaries only; no redirect or arbitrary asset fetching here.
function trustedAsset(value: unknown, token: string): string | null {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f\\]|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) || value.includes(token)) return null;
  try {
    const url = new URL(value);
    const allowed = ['cdninstagram.com', 'fbcdn.net'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    return url.protocol === 'https:' && allowed && !url.username && !url.password && !url.hash && !url.port ? url.href : null;
  } catch { return null; }
}
function measurement(name: string, status: Status, observedAt: string, value: number | null = null,
  unit: MetricUnit | null = metricUnit(name, null), definition: string | null = null): Measurement {
  return { value, status, unit, provider_definition: definition,
    definition: `instagram-${name.replace(/_/g, '-')}-lifetime-${API_VERSION}`,
    source: 'instagram_media_insights', api_version: API_VERSION, observed_at: observedAt,
    period: 'lifetime', since: null, until: null };
}

/** Offline-tested collector. Uses connected credentials only in Bearer headers, never in URLs. */
export async function collectInstagramAudit(connection: InstagramAuditConnection, runId: string, options: InstagramAuditOptions = {}) {
  const { id, organizationId, internalId, providerIdentifier: provider, token } = connection;
  if (!safeLabel(id) || !safeLabel(organizationId) || !numericId(internalId) || !safeLabel(runId) ||
      !['instagram', 'instagram-standalone'].includes(provider) || typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw invalid();
  const probe = options.capabilityProbe;
  if (probe && (options.checkpoint || (probe.targetMediaId !== undefined && !numericId(probe.targetMediaId)) ||
      (probe.metrics && (!probe.metrics.length || probe.metrics.length > 6 || new Set(probe.metrics).size !== probe.metrics.length ||
        probe.metrics.some(name => !METRICS.includes(name)))))) throw invalid();
  const passes = probe ? [probe.metrics || CORE_METRICS] : [CORE_METRICS, EXTRA_METRICS];
  const requestedMetrics = passes.flat();
  const evidence: InstagramProbeEvidence | undefined = probe ? { requested_version: API_VERSION, provider,
    request_count: 0, ledger: [], status: 'stopped', stop_reason: null, login_verified: false,
    primary_owned_reel_verified: false, asset_url_present: null, metrics: {} } : undefined;
  const now = options.now || (() => new Date());
  const timestamp = () => { const date = now(); if (!Number.isFinite(date.getTime())) throw invalid(); return date.toISOString(); };
  const until = timestamp(), identity = JSON.stringify([id, organizationId, internalId, provider, API_VERSION]);
  const prior = options.checkpoint;
  if (prior && (prior.version !== 1 || prior.state.identity !== identity || prior.state.records.length > MAX_RECORDS)) throw invalid();
  const state: State = prior ? copy(prior.state) : {
    identity, account: { account_id: internalId, username: null }, collectedAt: until,
    since: new Date(Date.parse(until) - 180 * 86400000).toISOString(), until, after: null, pages: 0,
    discoveryDone: false, profileDone: false, records: [], assets: [], capabilities: {}, truncated: false, terminalReason: null,
  };
  const fetcher = options.fetcher || fetch, host = provider === 'instagram' ? 'graph.facebook.com' : 'graph.instagram.com';
  const deadline = Date.now() + (probe ? 45000 : 120000);
  let requests = 0, reason: Reason | null = state.terminalReason;
  async function request(path: string, parameters: Record<string, string>): Promise<any> {
    const url = new URL(`https://${host}/${API_VERSION}/${path}`);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    for (let attempt = 0; attempt < (probe ? 1 : 2); attempt++) {
      if (requests >= (probe ? 8 : MAX_REQUESTS)) throw new Stop('request_budget');
      if (Date.now() >= deadline) throw new Stop('time_budget');
      requests++;
      if (evidence) {
        evidence.request_count = requests;
        evidence.ledger.push({ attempt: requests, operation: parameters.metric ? 'insights' :
          parameters.fields.includes('username') ? 'profile' : 'metadata', metric: parameters.metric || null, http_status: null, response_version: null });
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      try {
        const response: any = await Promise.race([
          fetcher(url.href, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, redirect: probe ? 'manual' : 'error' }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Stop('timeout')); }, probe ? Math.min(5000, deadline - Date.now()) : TIMEOUT_MS); }),
        ]);
        if (evidence) {
          const entry = evidence.ledger[evidence.ledger.length - 1];
          entry.http_status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
          const versions = ['facebook-api-version', 'instagram-api-version'].map(name => response.headers?.get(name))
            .filter((value): value is string => typeof value === 'string' && /^v\d{1,3}\.\d{1,3}$/.test(value));
          entry.response_version = versions.length && versions.every(version => version === versions[0]) ? versions[0] : null;
        }
        if (probe && response.status === 403) throw new Stop('not_authorized');
        if (probe && (response.redirected || (response.status >= 300 && response.status < 400))) throw new Stop('redirect_blocked');
        if (response.status === 401) throw new Stop('auth_required');
        if (response.status === 429) throw new Stop('rate_limited');
        async function readPayload() {
          if (!probe || !response.body?.getReader) {
            const value = await response.json();
            if (probe && new TextEncoder().encode(JSON.stringify(value)).byteLength > 262144) throw new Stop('response_budget');
            return value;
          }
          const reader = response.body.getReader(), chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 262144) {
              void reader.cancel().catch(() => {});
              throw new Stop('response_budget');
            }
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          return JSON.parse(new TextDecoder().decode(bytes));
        }
        const payload = await Promise.race([
          readPayload(), new Promise((_, reject) => { /* response body shares the same timeout */
            controller.signal.addEventListener('abort', () => reject(new Stop('timeout')), { once: true });
          }),
        ]);
        const code = payload?.error?.code;
        if (probe && code === 459) throw new Stop('challenge_required');
        if (response.status === 401 || code === 190) throw new Stop('auth_required');
        if (response.status === 429 || [4, 17, 32, 613].includes(code)) throw new Stop('rate_limited');
        if (!probe && response.status >= 500 && attempt === 0) continue;
        if (!response.ok || payload?.error) {
          if (code === 10 || code === 200 || response.status === 403) return { failure: 'not_authorized' };
          if (code === 100) return { failure: 'unsupported' };
          return { failure: 'error' };
        }
        return payload;
      } catch (error) {
        if (error instanceof Stop) throw error;
        if (probe || attempt === 1) return { failure: 'error' };
      } finally { clearTimeout(timer!); }
    }
    return { failure: 'error' };
  }
  try {
    if (!state.profileDone) {
      const standalone = provider === 'instagram-standalone';
      const profile = await request(standalone ? 'me' : internalId, { fields: standalone ? 'user_id,username' : 'id,username' });
      if (profile.failure) throw new Stop('error');
      const accountId = standalone ? profile.user_id : profile.id;
      if (accountId !== internalId || (profile.id && !standalone && profile.id !== internalId) ||
          (profile.account_type !== undefined && !['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(profile.account_type)) ||
          typeof profile.username !== 'string' || !/^[A-Za-z0-9_.]{1,30}$/.test(profile.username) || profile.username.includes(token)) throw invalid();
      state.account.username = profile.username; state.profileDone = true;
      if (evidence) evidence.login_verified = true;
    }
    while (!state.discoveryDone) {
      const parameters: Record<string, string> = { fields: 'id,caption,media_product_type,media_type,media_url,permalink,timestamp,owner', limit: probe ? '1' : '50' };
      if (state.after) parameters.after = state.after;
      const payload = await request(probe?.targetMediaId || `${internalId}/media`, probe?.targetMediaId ? { fields: parameters.fields } : parameters);
      const page = probe?.targetMediaId && !payload.failure ? { data: [payload] } : payload;
      if (page.failure || !Array.isArray(page.data) || page.data.length > (probe ? 1 : 50)) throw new Stop('error');
      if (evidence && page.data.length === 1) evidence.asset_url_present = typeof page.data[0]?.media_url === 'string' && page.data[0].media_url.trim().length > 0;
      if (probe && (page.data.length !== 1 || page.data[0]?.media_product_type !== 'REELS' ||
          page.data[0]?.owner?.id !== internalId)) throw new Stop('no_owned_reel');
      if (probe?.targetMediaId && page.data[0]?.id !== probe.targetMediaId) throw invalid();
      // Validate the entire page before mutating it or making any Insights calls.
      const additions: { record: AuditRecord; asset: Asset | null }[] = [];
      for (const media of page.data) {
        if (media?.media_product_type !== 'REELS') continue;
        const canonical = canonicalReel(media.permalink), published = Date.parse(media.timestamp);
        if (!numericId(media.id) || !canonical || canonical.shortcode.includes(token) || !Number.isFinite(published)) throw invalid();
        const owner = media.owner?.id ?? null;
        if ((owner !== null && !numericId(owner)) || (media.account_id !== undefined && media.account_id !== internalId)) throw invalid();
        if (published < Date.parse(state.since) || published > Date.parse(state.until)) {
          if (probe) throw new Stop('no_owned_reel');
          continue;
        }
        const duplicate = [...state.records, ...additions.map(item => item.record)].find(record => record.media_id === media.id || record.shortcode === canonical.shortcode);
        if (duplicate) {
          if (duplicate.media_id !== media.id || duplicate.shortcode !== canonical.shortcode || duplicate.owner_id !== owner) throw invalid();
          continue;
        }
        const assetUrl = trustedAsset(media.media_url, token);
        const caption = typeof media.caption === 'string' ? media.caption.replaceAll(token, '[redacted]').slice(0, 10000) : '';
        const record: AuditRecord = { media_id: media.id, account_id: internalId, ...canonical,
          published_at: new Date(published).toISOString(), media_product_type: 'REELS',
          relationship: owner === internalId ? 'primary_owned' : 'unknown', owner_id: owner, paid: null, trial: null,
          asset_status: assetUrl ? 'available' : 'unavailable', duration_seconds: null, metrics: {} };
        additions.push({ record, asset: assetUrl ? { media_id: media.id, url: assetUrl, caption } : null });
      }
      const exceededCap = state.records.length + additions.length > MAX_RECORDS;
      for (const item of additions) {
        if (state.records.length === MAX_RECORDS) break;
        state.records.push(item.record); if (item.asset) state.assets.push(item.asset);
      }
      state.pages++;
      if (evidence) {
        evidence.primary_owned_reel_verified = state.records.length === 1 && state.records[0].relationship === 'primary_owned';
        state.discoveryDone = true;
        break; // Never inspect or follow probe paging, including cursor checkpoints.
      }
      // paging.next is only a presence signal. Its URL is never followed, copied, or returned.
      const hasNext = Boolean(page.paging?.next);
      const after = page.paging?.cursors?.after;
      if (hasNext && (typeof after !== 'string' || !after || after.length > 2048 || /[\x00-\x20\x7f]/.test(after) || after.includes(token) || after === state.after)) throw invalid();
      state.after = hasNext ? after : null;
      if (state.records.length >= MAX_RECORDS || state.pages >= MAX_PAGES) {
        state.truncated = hasNext || exceededCap;
        state.terminalReason = state.truncated ? (state.records.length >= MAX_RECORDS ? 'metadata_limit' : 'page_limit') : null;
        state.discoveryDone = true;
      } else state.discoveryDone = !hasNext;
    }
    if (!probe && !state.accountMetrics?.followers_count) {
      const observed = timestamp();
      const data = await request(provider === 'instagram' ? internalId : 'me', {
        fields: (provider === 'instagram' ? 'id,' : 'user_id,') + FOLLOWER_FIELD });
      const value = data.followers_count;
      const accountId = provider === 'instagram' ? data.id : data.user_id;
      const status: Status = data.failure || (accountId !== internalId ? 'error' :
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? 'available' : 'not_returned');
      state.accountMetrics = { followers_count: { ...measurement('followers_count', status, observed, status === 'available' ? value : null),
        source: 'instagram_account_metadata', period: 'snapshot', definition: `instagram-followers-count-snapshot-${API_VERSION}` } };
    }
    // Finish the core distribution counters across the cohort before optional
    // metrics consume the existing time/request budget. Resume reuses both.
    for (const names of passes) for (const record of state.records) {
      for (const name of names) {
        if (record.metrics[name]) continue;
        if (record.relationship === 'unknown') { record.metrics[name] = measurement(name, 'not_requested', timestamp()); continue; }
        const cached = state.capabilities[name];
        if (cached === 'not_authorized') { record.metrics[name] = measurement(name, cached, timestamp()); continue; }
        const payload = await request(`${record.media_id}/insights`, { metric: metricName(name), period: 'lifetime' });
        let status: Status = payload.failure || 'not_returned', value: number | null = null;
        let returnedName: string | null = null, returnedPeriod: string | null = null, unit: string | null = null, definition: string | null = null;
        if (!payload.failure) {
          if (!Array.isArray(payload.data)) status = 'error';
          else {
            const rows = payload.data.filter((entry: any) => entry?.name === name);
            if (rows.length > 1) status = 'error';
            else if (rows.length === 1) {
              const row = rows[0];
              {
                returnedName = row.name;
                returnedPeriod = ['lifetime', 'day', 'week', 'days_28', 'total_over_range'].includes(row.period) ? row.period : null;
                // Only provider-returned metadata can establish a unit or definition.
                if (typeof row.unit === 'string' && /^[A-Za-z][A-Za-z _-]{0,39}$/.test(row.unit) && !row.unit.includes(token)) unit = row.unit;
                if (typeof row.description === 'string' && row.description.length <= 500 &&
                    !/[\x00-\x1f\x7f]|https?:|authorization|bearer|access_token|signature=/i.test(row.description) &&
                    !row.description.includes(token)) definition = row.description;
              }
              const values = row.values;
              const observed = row.total_value?.value ?? (Array.isArray(values) && values.length === 1 ? values[0]?.value : undefined);
              if (row.period && row.period !== 'lifetime') status = 'error';
              else if (typeof observed === 'number' && Number.isFinite(observed) && observed >= 0) {
                const resolvedUnit = metricUnit(name, { unit, description: definition });
                if (!resolvedUnit || (name === 'reels_skip_rate' && observed > (resolvedUnit === 'ratio' ? 1 : 100))) status = 'error';
                else { value = observed; status = 'available'; }
              }
              else status = 'not_returned';
            }
          }
        }
        const resolvedUnit = metricUnit(name, { unit, description: definition });
        record.metrics[name] = measurement(name, status, timestamp(), value, resolvedUnit, definition);
        if (evidence) {
          evidence.metrics[name] = { value, status, returned_metric_name: returnedName, returned_period: returnedPeriod, unit, definition, collector_unit_label: resolvedUnit };
          if (name === 'views' && status !== 'available') throw new Stop('invalid_core_metric');
        }
        // A media-specific unsupported response cannot suppress later media or erase observed support.
        if (status === 'available' || status === 'not_authorized' ||
            (status === 'unsupported' && state.capabilities[name] !== 'available') || !state.capabilities[name]) state.capabilities[name] = status;
      }
    }
    reason = state.terminalReason;
  } catch (error) {
    if (!(error instanceof Stop) && !probe) throw invalid();
    reason = error instanceof Stop ? error.reason : 'invalid_response';
  }
  const records = state.records.map(record => ({ ...record, metrics: Object.fromEntries(
    requestedMetrics.map(name => [name, record.metrics[name] || measurement(name, 'not_requested', state.collectedAt)])) }));
  const incomplete = !state.discoveryDone || state.records.some(record => requestedMetrics.some(name => !record.metrics[name]));
  const collectedAt = new Date(Math.max(Date.parse(timestamp()), Date.parse(state.until),
    ...records.flatMap(record => Object.values(record.metrics).map(metric => Date.parse(metric.observed_at))))).toISOString();
  const snapshot = freeze({ schema_version: 1, organization_id: organizationId, connection_id: id, provider,
    account_id: internalId, run_id: runId, collected_at: collectedAt, api_version: API_VERSION,
    window: { since: state.since, until: state.until }, coverage: { discovered: records.length, truncated: state.truncated || incomplete, partial_reason: reason },
    ...(!probe ? { account_metrics: state.accountMetrics || {} } : {}),
    capabilities: Object.fromEntries(METRICS.map(name => [name, state.capabilities[name] || 'not_requested'])), records });
  if (evidence) {
    evidence.stop_reason = reason;
    evidence.status = !reason && Object.keys(evidence.metrics).length === requestedMetrics.length ? 'complete' : 'stopped';
    for (const name of requestedMetrics) evidence.metrics[name] ||= { value: null, status: 'not_requested',
      returned_metric_name: null, returned_period: null, unit: null, definition: null, collector_unit_label: metricUnit(name, null) };
  }
  return { ...(evidence ? { probeEvidence: freeze(evidence) } : {}), snapshot, account: freeze(copy(state.account)), assets: freeze(copy(state.assets)),
    checkpoint: freeze({ version: 1 as const, state: copy(state) }) };
}
