// Offline consistency checks over integrator-selected projections, not authenticated attestations.
import { createHash } from 'node:crypto';
import { constants as C, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = reason => { throw Object.assign(new Error(), { reason }); };
const require = (value, reason = 'malformed_evidence') => { if (!value) invalid(reason); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => require(object(value) && Object.keys(value).every(key => keys.includes(key)));
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\p{Cc}]/u.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const sha = (value, size = 40) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${size}}$`).test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
function parse(bytes) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(source), tokens = /"(?:\\.|[^"\\])*"|[{}\[\]]/g, stack = [];
  let token;
  while ((token = tokens.exec(source))) {
    if (token[0] === '{') stack.push(new Set());
    else if (token[0] === '[') stack.push(null);
    else if (token[0] === '}' || token[0] === ']') stack.pop();
    else if (/^\s*:/.test(source.slice(tokens.lastIndex)) && stack.at(-1)) {
      const key = JSON.parse(token[0]); require(!stack.at(-1).has(key), 'duplicate_json_key'); stack.at(-1).add(key);
    }
  }
  return value;
}
function read(file, limit) {
  const fd = openSync(file, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd); require(stat.isFile() && stat.size <= limit, 'file_limit');
    const bytes = Buffer.alloc(limit + 1), count = readSync(fd,bytes,0,bytes.length,0);
    require(count <= limit, 'file_limit'); return bytes.subarray(0,count);
  } finally { closeSync(fd); }
}
function subject(value) {
  exact(value,['repository','pr','baseSha','headSha','scopeSha256']);
  require(value.repository === 'celleree/everywhereposter', 'foreign_repository');
  require(positive(value.pr) && sha(value.baseSha) && sha(value.headSha) && sha(value.scopeSha256,64), 'malformed_subject');
  return value;
}
function identity(value, expected, pending) {
  subject(value);
  require(value.repository === expected.repository && value.pr === expected.pr, 'foreign_subject');
  if (value.baseSha !== expected.baseSha) pending.add('stale_base');
  if (value.headSha !== expected.headSha) pending.add('stale_head');
  if (value.scopeSha256 !== expected.scopeSha256) pending.add('stale_scope');
}
function projection(value) {
  exact(value,['kind','source','record','associations']);
  require(value.kind === 'integrator_projection' && object(value.record) && object(value.associations));
  exact(value.source,['locator','sha256']);
  require(typeof value.source.locator === 'string' && value.source.locator.length <= 2048 && /^(?:\/|private:)/.test(value.source.locator) && !/[\p{Cc}]/u.test(value.source.locator) && sha(value.source.sha256,64));
  return value;
}
function metadata(value, child = false) {
  projection(value); exact(value.associations,[]); exact(value.record,['type','payload']); require(value.record.type === 'session_meta');
  const payload = value.record.payload;
  exact(payload,child ? ['id','parent_thread_id','agent_path','source'] : ['id']); require(id(payload.id));
  if (child) {
    exact(payload.source,['subagent']); exact(payload.source.subagent,['thread_spawn']);
    exact(payload.source.subagent.thread_spawn,['parent_thread_id','agent_path']);
    require(id(payload.parent_thread_id) && text(payload.agent_path));
  }
  return payload;
}
function checkIdentity(value) {
  exact(value,['workflow','job','app']);
  require(typeof value.workflow === 'string' && /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(value.workflow) && text(value.job) && id(value.app));
  return JSON.stringify([value.workflow,value.job,value.app]);
}
// Collector utility: extract a leading structured object without interpreting prose or PASS keywords.
export function leadingObject(source) {
  require(typeof source === 'string' && source.length <= 65536);
  const value = source.trimStart(); if (!value.startsWith('{')) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      const tail=value.slice(index+1).trim();
      if (tail && !/^<oai-mem-citation>[\s\S]*<\/oai-mem-citation>$/.test(tail)) return null;
      return parse(Buffer.from(value.slice(0,index+1)));
    }
  }
  return null;
}
export function verifyManifest(file, expected, now = Date.now()) {
  const evaluatedAt = new Date(now).toISOString(), pending = new Set();
  const result = (status, reasons = []) => ({ status, reasons, evaluatedAt, liveRecheckRequired: true });
  try {
    require(sha(expected,64), 'invalid_anchor');
    let bytes; try { bytes = read(file,65536); } catch (error) { if (error.code === 'ENOENT') return result('pending',['missing_manifest']); throw error; }
    require(digest(bytes) === expected,'manifest_digest_mismatch');
    const manifest = parse(bytes);
    exact(manifest,['version','subject','integratorThreadId','participants','reviewer','requiredChecks','evidence']); require(manifest.version === 1);
    const target = subject(manifest.subject), reviewer = manifest.reviewer;
    require(id(manifest.integratorThreadId) && Array.isArray(manifest.participants) && manifest.participants.length > 0 && manifest.participants.length <= 100);
    const contributors = new Set(); let integrator = false;
    for (const person of manifest.participants) {
      exact(person,['threadId','roles']); require(id(person.threadId) && !contributors.has(person.threadId)); contributors.add(person.threadId);
      require(Array.isArray(person.roles) && person.roles.length > 0 && new Set(person.roles).size === person.roles.length && person.roles.every(role => ['implementer','designer','integrator'].includes(role)));
      if (person.threadId === manifest.integratorThreadId && person.roles.includes('integrator')) integrator = true;
    }
    exact(reviewer,['threadId','parentThreadId','agentPath','spawnCallId']);
    require(integrator && id(reviewer.threadId) && id(reviewer.parentThreadId) && reviewer.parentThreadId === manifest.integratorThreadId && text(reviewer.spawnCallId));
    require(typeof reviewer.agentPath === 'string' && /^\/root(?:\/[a-z][a-z0-9_]*)+$/.test(reviewer.agentPath));
    require(!contributors.has(reviewer.threadId),'reviewer_contributor_overlap');
    require(Array.isArray(manifest.requiredChecks) && manifest.requiredChecks.length > 0 && manifest.requiredChecks.length <= 32);
    const required = manifest.requiredChecks.map(checkIdentity); require(new Set(required).size === required.length,'duplicate_required_check');
    exact(manifest.evidence,['scope','platform','review','github']);
    const load = (name, lines = false) => {
      const ref = manifest.evidence[name]; if (!ref) { pending.add(`missing_${name}`); return null; }
      exact(ref,['file','sha256']); require(typeof ref.file === 'string' && !isAbsolute(ref.file) && !/[\\\p{Cc}]/u.test(ref.file) && sha(ref.sha256,64));
      const parts = ref.file.split('/'); require(parts.every(part => part && part !== '.' && part !== '..'),'unsafe_evidence_path');
      let path = dirname(resolve(file));
      try {
        for (const part of parts) { path = join(path,part); require(!lstatSync(path).isSymbolicLink(),'unsafe_evidence_path'); }
        const source = read(path,262144); require(digest(source) === ref.sha256,'evidence_digest_mismatch');
        return lines ? new TextDecoder('utf-8',{fatal:true}).decode(source).trimEnd().split('\n').map(line => projection(parse(Buffer.from(line)))) : projection(parse(source));
      } catch (error) { if (error.code === 'ENOENT') { pending.add(`missing_${name}`); return null; } throw error; }
    };
    const scope = load('scope'), platform = load('platform',true), review = load('review',true), github = load('github');
    if (scope) {
      exact(scope.record,['ownedPaths','prohibitedPaths']); exact(scope.associations,['repository','pr','baseSha','headSha']);
      for (const [key,paths] of Object.entries(scope.record)) require(Array.isArray(paths) && paths.length <= 100 && (key !== 'ownedPaths' || paths.length > 0) && paths.every(path => typeof path === 'string' && path.length <= 512 && !/^[\/]|[\\\p{Cc}*?\[\]{}]/u.test(path) && path.replace(/\/$/,'').split('/').every(part => part && part !== '.' && part !== '..')));
      require(Array.isArray(scope.record.ownedPaths) && Array.isArray(scope.record.prohibitedPaths));
      identity({...scope.associations,scopeSha256:manifest.evidence.scope.sha256},target,pending);
    }
    let child;
    if (platform) {
      require(platform.length === 4,'platform_record_order'); const parent = metadata(platform[0]); child = metadata(platform[3],true);
      require(parent.id === reviewer.parentThreadId && child.id === reviewer.threadId && child.parent_thread_id === parent.id && child.source.subagent.thread_spawn.parent_thread_id === parent.id,'platform_parent_mismatch');
      for (const item of [platform[1],platform[2]]) { exact(item.associations,[]); exact(item.record,['type','payload']); require(item.record.type === 'response_item'); }
      const call = platform[1].record.payload, output = platform[2].record.payload;
      exact(call,['type','name','namespace','call_id','arguments']); exact(call.arguments,['task_name','fork_turns']); exact(output,['type','call_id','output']); exact(output.output,['task_name']);
      require(call.type === 'function_call' && call.name === 'spawn_agent' && call.namespace === 'collaboration' && output.type === 'function_call_output' && call.call_id === reviewer.spawnCallId && output.call_id === call.call_id,'spawn_call_mismatch');
      require(typeof call.arguments.task_name === 'string' && /^[a-z][a-z0-9_]*$/.test(call.arguments.task_name) && reviewer.agentPath.endsWith('/'+call.arguments.task_name) && output.output.task_name === reviewer.agentPath && child.agent_path === reviewer.agentPath && child.source.subagent.thread_spawn.agent_path === reviewer.agentPath,'spawn_path_mismatch');
      if (call.arguments.fork_turns !== 'none') pending.add('reviewer_context_not_fresh');
    }
    if (review) {
      require(review.length === 2,'review_record_order'); const reviewedChild = metadata(review[0],true);
      require(reviewedChild.id === reviewer.threadId && reviewedChild.parent_thread_id === reviewer.parentThreadId && reviewedChild.agent_path === reviewer.agentPath && reviewedChild.source.subagent.thread_spawn.parent_thread_id === reviewer.parentThreadId && reviewedChild.source.subagent.thread_spawn.agent_path === reviewer.agentPath,'review_identity_mismatch');
      if (child) require(review[0].source.sha256 === platform[3].source.sha256,'review_identity_mismatch');
      const final = review[1]; exact(final.associations,[]); exact(final.record,['type','payload']); require(final.record.type === 'response_item');
      const message = final.record.payload; exact(message,['type','role','phase','status','content']);
      require(Array.isArray(message.content) && message.content.length === 1); exact(message.content[0],['type','text']);
      if (message.type !== 'message' || message.role !== 'assistant' || message.phase !== 'final_answer' || message.status !== 'completed' || message.content[0].type !== 'output_text') pending.add('missing_completed_verdict');
      else {
        let verdict; try { verdict = parse(Buffer.from(message.content[0].text)); } catch { pending.add('unstructured_review'); }
        if (!object(verdict)) pending.add('unstructured_review');
        else {
          exact(verdict,['subject','reviewerThreadId','verdict','unresolvedMaterialFindings']); identity(verdict.subject,target,pending); require(verdict.reviewerThreadId === reviewer.threadId,'review_identity_mismatch');
          require(['PASS','CHANGES_REQUIRED','INCONCLUSIVE'].includes(verdict.verdict));
          if (verdict.verdict !== 'PASS') pending.add('review_not_pass');
          if (!Number.isSafeInteger(verdict.unresolvedMaterialFindings) || verdict.unresolvedMaterialFindings !== 0) pending.add('unresolved_or_unknown_findings');
        }
      }
    }
    if (github) {
      exact(github.record,['repository','number','baseRefOid','headRefOid','state','checks']); exact(github.associations,['capturedAt','scopeSha256','mergeRef','testedRefs']);
      const gh = github.record, assoc = github.associations;
      identity({repository:gh.repository,pr:gh.number,baseSha:gh.baseRefOid,headSha:gh.headRefOid,scopeSha256:assoc.scopeSha256},target,pending);
      if (gh.state !== 'OPEN') pending.add('pr_not_open');
      require(typeof assoc.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(assoc.capturedAt) && Number.isFinite(Date.parse(assoc.capturedAt)),'invalid_snapshot_timestamp');
      const [year,month,day] = assoc.capturedAt.slice(0,10).split('-').map(Number), last = new Date(0); last.setUTCFullYear(year,month,0);
      require(month>=1&&month<=12&&day>=1&&day<=last.getUTCDate(),'invalid_snapshot_timestamp');
      const age = now - Date.parse(assoc.capturedAt); if (age<0 || age>900000) pending.add('stale_github_snapshot');
      const observedChecks=gh.checks ?? [], testedRefs=assoc.testedRefs ?? [];
      require(Array.isArray(observedChecks) && observedChecks.length<=64 && Array.isArray(testedRefs) && testedRefs.length<=64);
      if (assoc.mergeRef != null) { exact(assoc.mergeRef,['sha','baseSha','headSha']); require(['sha','baseSha','headSha'].every(key => assoc.mergeRef[key] == null || sha(assoc.mergeRef[key]))); }
      const refs = new Map();
      for (const ref of testedRefs) { exact(ref,['runId','kind','sha','baseSha','headSha']); require(positive(ref.runId)&&!refs.has(ref.runId),'contradictory_tested_ref'); require((ref.kind==null||['merge','head'].includes(ref.kind))&&['sha','baseSha','headSha'].every(key=>ref[key]==null||sha(ref[key]))); refs.set(ref.runId,ref); }
      const checks = new Map();
      for (const check of observedChecks) { exact(check,['identity','runId','event','status','conclusion']); const key=checkIdentity(check.identity); require(!checks.has(key)&&positive(check.runId)&&(check.event==null||text(check.event))&&(check.status==null||text(check.status))&&(check.conclusion==null||text(check.conclusion)),'contradictory_check'); checks.set(key,check); }
      for (const key of required) {
        const check=checks.get(key); if (!check) { pending.add('missing_required_check'); continue; }
        if (check.status!=='completed'||check.conclusion!=='success') pending.add('required_check_not_success');
        const ref=refs.get(check.runId); if (!ref||ref.baseSha!==target.baseSha||ref.headSha!==target.headSha) { pending.add('unbound_tested_ref'); continue; }
        if (check.event==='workflow_dispatch') { if(ref.kind!=='head'||ref.sha!==target.headSha) pending.add('unbound_tested_ref'); }
        else if(check.event==='pull_request') { const merge=assoc.mergeRef; if(ref.kind!=='merge'||!merge||!sha(merge.sha)||merge.baseSha!==target.baseSha||merge.headSha!==target.headSha||ref.sha!==merge.sha) pending.add('unbound_tested_ref'); }
        else pending.add('unbound_tested_ref');
      }
    }
    return result(pending.size?'pending':'evidence_matches_snapshot',[...pending].sort());
  } catch (error) { return result('invalid',[error.reason||'malformed_evidence']); }
}
if (import.meta.url.startsWith('file:') && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now=Date.now();
  const result=process.argv.length===5&&process.argv[2]==='verify' ? verifyManifest(process.argv[3],process.argv[4],now) : {status:'invalid',reasons:['cli_usage'],evaluatedAt:new Date(now).toISOString(),liveRecheckRequired:true};
  console.log(JSON.stringify(result)); process.exitCode={evidence_matches_snapshot:0,pending:1,invalid:2}[result.status];
}
