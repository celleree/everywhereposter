import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after,test } from 'node:test';
import { leadingObject,verifyManifest } from './review-evidence.mjs';

const root=mkdtempSync(join(tmpdir(),'ep-review-evidence-'));after(()=>rmSync(root,{recursive:true,force:true}));
const now=Date.parse('2026-11-11T12:00:00.000Z'),A='a'.repeat(40),B='b'.repeat(40),M='c'.repeat(40),OLD='d'.repeat(40),H='e'.repeat(64);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>JSON.stringify(value)+'\n';
const projection=(record,source)=>({kind:'integrator_projection',source:{locator:'private://synthetic/'+source,sha256:hash('synthetic-original-'+source)},record,associations:{}});
let sequence=0;
function packet() {
 const directory=join(root,String(sequence++)),file=directory+'.manifest.json';
 const subject={repository:'celleree/everywhereposter',pr:42,baseSha:A,headSha:B,scopeSha256:H};
 const reviewer={threadId:'reviewer-thread',parentThreadId:'integrator-thread',agentPath:'/root/review',spawnCallId:'spawn-call-1'};
 const child=projection({type:'session_meta',payload:{id:reviewer.threadId,parent_thread_id:reviewer.parentThreadId,agent_path:reviewer.agentPath,source:{subagent:{thread_spawn:{parent_thread_id:reviewer.parentThreadId,agent_path:reviewer.agentPath}}}}},'child');
 const scope=projection({ownedPaths:['docs/example.md'],prohibitedPaths:['docs/excluded.md']},'scope');scope.associations={repository:subject.repository,pr:42,baseSha:A,headSha:B};
 const platform=[projection({type:'session_meta',payload:{id:reviewer.parentThreadId}},'parent'),projection({type:'response_item',payload:{type:'function_call',name:'spawn_agent',namespace:'collaboration',call_id:reviewer.spawnCallId,arguments:{task_name:'review',fork_turns:'none'}}},'spawn-request'),projection({type:'response_item',payload:{type:'function_call_output',call_id:reviewer.spawnCallId,output:{task_name:reviewer.agentPath}}},'spawn-result'),child];
 const final=()=>projection({type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',status:'completed',content:[{type:'output_text',text:JSON.stringify({subject:{...subject},reviewerThreadId:reviewer.threadId,verdict:'PASS',unresolvedMaterialFindings:0})}]}},'final');
 const identity={workflow:'.github/workflows/pull-request-ci.yml',job:'focused-agent-tests',app:'github-actions'};
 const github=projection({repository:subject.repository,number:42,baseRefOid:A,headRefOid:B,state:'OPEN',checks:[{identity,runId:123,event:'pull_request',status:'completed',conclusion:'success'}]},'github');
 github.associations={capturedAt:new Date(now-1000).toISOString(),scopeSha256:H,mergeRef:{sha:M,baseSha:A,headSha:B},testedRefs:[{runId:123,kind:'merge',sha:M,baseSha:A,headSha:B}]};
 const manifest={version:1,subject,integratorThreadId:reviewer.parentThreadId,participants:[{threadId:reviewer.parentThreadId,roles:['integrator']},{threadId:'implementation-thread',roles:['implementer','designer']}],reviewer,requiredChecks:[identity],evidence:{}};
 const value={file,manifest,scope,platform,review:[structuredClone(child),final()],github};
 value.save=({refreshScope=true}={})=>{
  const scopeBytes=encode(value.scope);if(refreshScope){subject.scopeSha256=hash(scopeBytes);github.associations.scopeSha256=subject.scopeSha256;const verdict=JSON.parse(value.review[1].record.payload.content[0].text);verdict.subject.scopeSha256=subject.scopeSha256;value.review[1].record.payload.content[0].text=JSON.stringify(verdict);}
  for(const name of ['scope','platform','review','github']){
   const path=directory+'.'+name+(name==='platform'||name==='review'?'.jsonl':'.json');
   const data=name==='platform'||name==='review'?value[name].map(encode).join(''):encode(value[name]);
   writeFileSync(path,data,{mode:0o600});manifest.evidence[name]={file:path.split('/').at(-1),sha256:hash(data)};
  }
  const bytes=encode(manifest);writeFileSync(file,bytes,{mode:0o600});value.anchor=hash(bytes);return value;
 };
 value.verdict=patch=>{const text=value.review[1].record.payload.content[0];text.text=JSON.stringify({...JSON.parse(text.text),...patch});};
 return value.save();
}
const verify=(p,time=now)=>verifyManifest(p.file,p.anchor,time);
function expectStatus(p,status,reason){const result=verify(p);assert.equal(result.status,status,JSON.stringify(result));if(reason)assert.ok(result.reasons.includes(reason),JSON.stringify(result));assert.equal(result.liveRecheckRequired,true);return result;}

test('complete matching synthetic projections match snapshot; CLI statuses never certify merge readiness',()=>{
 const p=packet();expectStatus(p,'evidence_matches_snapshot');
 // CLI uses its own real clock: refresh only the independently collected GitHub snapshot.
 p.github.associations.capturedAt=new Date().toISOString();p.save();
 const result=spawnSync(process.execPath,[new URL('./review-evidence.mjs',import.meta.url).pathname,'verify',p.file,p.anchor],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);const value=JSON.parse(result.stdout);assert.equal(value.status,'evidence_matches_snapshot');assert.equal(value.liveRecheckRequired,true);assert.ok(Number.isFinite(Date.parse(value.evaluatedAt)));
 assert.doesNotMatch(result.stdout,/merge_ready|private:\/\/|integrator-thread|reviewer-thread/);
});
test('external manifest anchor and every evidence digest detect byte tampering',()=>{
 const p=packet();assert.equal(verifyManifest(p.file,'0'.repeat(64),now).status,'invalid');
 for(const name of ['scope','platform','review','github']){const q=packet();writeFileSync(join(root,q.manifest.evidence[name].file),'{}\n');expectStatus(q,'invalid','evidence_digest_mismatch');}
 const q=packet();writeFileSync(q.file,readFileSync(q.file,'utf8')+' ');expectStatus(q,'invalid','manifest_digest_mismatch');
});
test('stale head/base/scope are pending; foreign repository/PR identities invalid',()=>{
 for(const field of ['headSha','baseSha','scopeSha256']){const p=packet(),verdict=JSON.parse(p.review[1].record.payload.content[0].text);verdict.subject[field]=field==='scopeSha256'?H:OLD;p.verdict(verdict);p.save({refreshScope:false});expectStatus(p,'pending','stale_'+field.replace('Sha256','').replace('Sha',''));}
 for(const field of ['headRefOid','baseRefOid']){const p=packet();p.github.record[field]=OLD;p.save();expectStatus(p,'pending');}
 for(const repository of ['foreign/repository','celleree/other']){const p=packet();p.github.record.repository=repository;p.save();expectStatus(p,'invalid','foreign_repository');}
 const p=packet();p.github.record.number=43;p.save();expectStatus(p,'invalid','foreign_subject');
 const q=packet();q.manifest.subject.scopeSha256=H;q.save({refreshScope:false});expectStatus(q,'pending','stale_scope');
});
test('platform order, call ID, canonical path and both parent IDs bind original source identity',()=>{
 const changes=[p=>p.platform.reverse(),p=>p.platform[1].record.payload.name='collaboration.spawn_agent',p=>p.platform[1].record.payload.namespace='other',p=>p.platform[2].record.payload.call_id='different-call',p=>p.platform[1].record.payload.call_id='different-call',p=>p.platform[2].record.payload.output.task_name='/root/other',p=>p.platform[3].record.payload.parent_thread_id='other-parent',p=>p.platform[3].record.payload.source.subagent.thread_spawn.parent_thread_id='other-parent',p=>p.platform[3].record.payload.agent_path='/root/other',p=>p.platform[3].record.payload.source.subagent.thread_spawn.agent_path='/root/other',p=>p.platform[1].record.payload.arguments.task_name='other',p=>p.review[0].record.payload.id='other-reviewer'];
 for(const change of changes){const p=packet();change(p);p.save();expectStatus(p,'invalid');}
 const reordered=packet();reordered.review[0].record.payload=Object.fromEntries(Object.entries(reordered.review[0].record.payload).reverse());reordered.save();expectStatus(reordered,'evidence_matches_snapshot');
 const p=packet();p.platform[2].record.payload.output.thread_id='collector-invented-child-id';p.save();expectStatus(p,'invalid');
});
test('reviewer cannot contribute in any roster role; missing fork-none cannot pass',()=>{
 for(const role of ['implementer','designer','integrator']){const p=packet();p.manifest.participants.push({threadId:'reviewer-thread',roles:[role]});p.save();expectStatus(p,'invalid','reviewer_contributor_overlap');}
 for(const fork of [undefined,'all']){const p=packet();p.platform[1].record.payload.arguments.fork_turns=fork;p.save();expectStatus(p,'pending','reviewer_context_not_fresh');}
});
test('only a completed assistant final_answer structured verdict counts; findings unknown or nonpass stay pending',()=>{
 for(const verdict of ['CHANGES_REQUIRED','INCONCLUSIVE']){const p=packet();p.verdict({verdict});p.save();expectStatus(p,'pending','review_not_pass');}
 for(const unresolvedMaterialFindings of [undefined,null,1,'unknown']){const p=packet();p.verdict({unresolvedMaterialFindings});p.save();expectStatus(p,'pending','unresolved_or_unknown_findings');}
 for(const patch of [{phase:'analysis'},{status:'in_progress'},{role:'user'}]){const p=packet();Object.assign(p.review[1].record.payload,patch);p.save();expectStatus(p,'pending','missing_completed_verdict');}
 for(const text of ['PASS — everything looks ready','null','false']){const p=packet();p.review[1].record.payload.content[0].text=text;p.save({refreshScope:false});expectStatus(p,'pending','unstructured_review');}
 const p=packet();p.verdict({reviewerThreadId:'implementation-thread'});p.save();expectStatus(p,'invalid','review_identity_mismatch');
});
test('collector extracts leading JSON before memory citation without rewriting verdict or inferring keywords',()=>{
 const value={subject:{repository:'celleree/everywhereposter',pr:42,baseSha:A,headSha:B,scopeSha256:H},reviewerThreadId:'reviewer-thread',verdict:'PASS',unresolvedMaterialFindings:0};
 assert.deepEqual(leadingObject(JSON.stringify(value)+'\n<oai-mem-citation>synthetic citation only</oai-mem-citation>'),value);
 assert.equal(leadingObject('PASS '+JSON.stringify(value)),null);assert.equal(leadingObject(JSON.stringify(value)+'\nCHANGES_REQUIRED'),null);assert.equal(leadingObject('{"verdict":'),null);
 const p=packet();p.verdict({verdict:'CHANGES_REQUIRED'});const original=JSON.parse(p.review[1].record.payload.content[0].text);const selected=leadingObject(JSON.stringify(original)+'\n<oai-mem-citation>PASS keyword cannot override</oai-mem-citation>');p.review[1].record.payload.content[0].text=JSON.stringify(selected);p.save();expectStatus(p,'pending','review_not_pass');
});
test('required checks need exact identity, successful completion and bound merge-ref or dispatch HEAD',()=>{
 const changes=[p=>p.github.record.checks=[],p=>p.github.record.checks[0].identity={...p.github.record.checks[0].identity,job:'other-job'},p=>p.github.record.checks[0].conclusion='failure',p=>p.github.record.checks[0].status='in_progress',p=>delete p.github.record.checks,p=>p.github.associations.testedRefs=[],p=>delete p.github.associations.testedRefs,p=>delete p.github.associations.mergeRef,p=>delete p.github.associations.testedRefs[0].headSha,p=>p.github.associations.testedRefs[0].sha=OLD,p=>p.github.associations.testedRefs[0].baseSha=OLD,p=>p.github.associations.testedRefs[0].headSha=null,p=>p.github.associations.testedRefs[0].kind='head',p=>p.github.associations.mergeRef=null,p=>p.github.associations.mergeRef.headSha=OLD,p=>p.github.record.checks[0].event='push'];
 for(const change of changes){const p=packet();change(p);p.save();expectStatus(p,'pending');}
 const p=packet();p.github.record.checks[0].event='workflow_dispatch';Object.assign(p.github.associations.testedRefs[0],{kind:'head',sha:B});p.save();expectStatus(p,'evidence_matches_snapshot');
 p.github.associations.testedRefs[0].sha=M;p.save();expectStatus(p,'pending','unbound_tested_ref');
 const q=packet();q.github.associations.testedRefs.push({...q.github.associations.testedRefs[0],sha:OLD});q.save();expectStatus(q,'invalid','contradictory_tested_ref');
});
test('only GitHub snapshot freshness expires; CLI clock is fixed once and unchanged review/check identities do not age out',()=>{
 for(const offset of [1,-900001]){const p=packet();p.github.associations.capturedAt=new Date(now+offset).toISOString();p.save();expectStatus(p,'pending','stale_github_snapshot');}
 for(const offset of [0,-900000]){const p=packet();p.github.associations.capturedAt=new Date(now+offset).toISOString();p.save();expectStatus(p,'evidence_matches_snapshot');}
 for(const capturedAt of ['yesterday','2026-02-30T12:00:00.000Z',null]){const p=packet();p.github.associations.capturedAt=capturedAt;p.save();expectStatus(p,'invalid','invalid_snapshot_timestamp');}
 const p=packet(),oldReview=p.manifest.evidence.review.sha256,later=now+365*86400000;p.github.associations.capturedAt=new Date(later).toISOString();p.save();assert.equal(p.manifest.evidence.review.sha256,oldReview);assert.equal(verify(p,later).status,'evidence_matches_snapshot');
 const source=readFileSync(new URL('./review-evidence.mjs',import.meta.url),'utf8');assert.equal((source.slice(source.indexOf("if (import.meta.url.startsWith('file:')")).match(/Date\.now\(\)/g)||[]).length,1);
});
test('missing artifacts are pending; malformed/private-data fields, unsafe paths and duplicate keys are invalid without public echo',()=>{
 const p=packet();rmSync(join(root,p.manifest.evidence.review.file));expectStatus(p,'pending','missing_review');
 const missing=packet();delete missing.manifest.evidence.platform;writeFileSync(missing.file,encode(missing.manifest));missing.anchor=hash(readFileSync(missing.file));expectStatus(missing,'pending','missing_platform');
 const q=packet();q.platform[1].record.payload.arguments.message='PRIVATE-PROMPT-SENTINEL';q.save();expectStatus(q,'invalid');
 const unsafe=packet();unsafe.manifest.evidence.github.file='../PRIVATE-LOCATOR-SENTINEL';writeFileSync(unsafe.file,encode(unsafe.manifest));unsafe.anchor=hash(readFileSync(unsafe.file));expectStatus(unsafe,'invalid','unsafe_evidence_path');
 const linked=packet(),target=join(root,linked.manifest.evidence.scope.file);rmSync(target);symlinkSync('/etc/passwd',target);expectStatus(linked,'invalid','unsafe_evidence_path');
 const duplicate=packet(),raw=encode(duplicate.manifest).replace('"version":1','"version":1,"version":1');writeFileSync(duplicate.file,raw);duplicate.anchor=hash(raw);expectStatus(duplicate,'invalid','duplicate_json_key');
 const result=spawnSync(process.execPath,[new URL('./review-evidence.mjs',import.meta.url).pathname,'verify',q.file,q.anchor],{encoding:'utf8'});assert.equal(result.status,2);assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE-PROMPT-SENTINEL|private:\/\/|spawn-call-1/);
 const pending=packet();pending.github.associations.capturedAt='2020-01-01T00:00:00.000Z';pending.save();assert.equal(spawnSync(process.execPath,[new URL('./review-evidence.mjs',import.meta.url).pathname,'verify',pending.file,pending.anchor]).status,1);
});
