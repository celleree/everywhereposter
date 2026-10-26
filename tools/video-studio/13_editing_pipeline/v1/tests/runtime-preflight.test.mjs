import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectRuntimeConfig} from '../runtime-preflight.mjs';

const testDirectory=fileURLToPath(new URL('.',import.meta.url));
const packages=['@remotion/bundler','@remotion/renderer','@remotion/player','remotion','react','react-dom','esbuild'];
async function fixture(t){
 const dir=await mkdtemp(path.join(testDirectory,'.runtime-preflight-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const config={schemaVersion:1,effectsV1Root:'effects/v1',effectsV2Root:'effects/v2',nodeModulesRoot:'node_modules',nodeExecutable:'tools/node',pythonExecutable:'tools/python',pythonSitePackagesRoot:'site-packages',browserExecutable:'tools/browser',ffmpegExecutable:'tools/ffmpeg',ffprobeExecutable:'tools/ffprobe',lockfilePath:'package-lock.json'};
 const put=async(file,content)=>{const absolute=path.join(dir,file);await mkdir(path.dirname(absolute),{recursive:true});await writeFile(absolute,content);};
 for(const key of ['effectsV1Root','effectsV2Root'])await mkdir(path.join(dir,config[key]),{recursive:true});
 for(const key of ['nodeExecutable','pythonExecutable','browserExecutable','ffmpegExecutable','ffprobeExecutable'])await put(config[key],'deliberately non-executable synthetic file');
 for(const name of packages){
  await put(`node_modules/${name}/package.json`,JSON.stringify({name,version:'1.2.3',main:'index.js',scripts:{postinstall:'MUST NOT EXECUTE'}}));
  await put(`node_modules/${name}/index.js`,'throw new Error("package code must not load");');
 }
 for(const name of ['numpy','PIL'])await put(`site-packages/${name}/__init__.py`,'raise RuntimeError("package code must not load")');
 await put('package-lock.json','synthetic lockfile; content validation is outside this preflight');
 return {dir,config,put,run:()=>inspectRuntimeConfig(config,dir)};
}
const check=(result,name)=>result.checks.find(item=>item.name===name);

test('complete synthetic metadata remains runtime-unverified and never loads code',async t=>{
 const f=await fixture(t),before=await readdir(f.dir,{recursive:true}),lock=await readFile(path.join(f.dir,'package-lock.json'));
 const result=await f.run();
 assert.equal(result.status,'METADATA_PRESENT');assert.equal(result.runtimeCompatibility,'UNVERIFIED');
 assert.equal(check(result,'react').version,'1.2.3');assert.equal(check(result,'pythonExecutable').version,undefined);
 assert.equal(check(result,'numpy').status,'FOUND');assert.equal(check(result,'PIL').status,'FOUND');
 assert.deepEqual(await readdir(f.dir,{recursive:true}),before);
 assert.deepEqual(await readFile(path.join(f.dir,'package-lock.json')),lock);
 assert.deepEqual(await f.run(),result);
});

test('the committed example uses placeholders and reports each unconfigured prerequisite',async()=>{
 const example=JSON.parse(await readFile(new URL('../runtime-config.example.json',import.meta.url),'utf8'));
 assert.ok(Object.entries(example).every(([key,value])=>key==='schemaVersion'||value===null));
 const result=await inspectRuntimeConfig(example,testDirectory);
 assert.equal(result.status,'INCOMPLETE');assert.equal(result.checks.length,10);
 assert.ok(result.checks.every(item=>item.status==='NOT_CONFIGURED'&&item.detail.includes(item.name)));
});

test('unknown and secret-bearing fields are rejected without echoing supplied values',async()=>{
 for(const field of ['apiKey','token','environment','credentials','extra','__proto__']){
  const config=JSON.parse(`{"schemaVersion":1,"${field}":"synthetic-secret-do-not-echo"}`);
  const result=await inspectRuntimeConfig(config,testDirectory);
  assert.equal(result.status,'CONFIG_INVALID');assert.equal(result.checks.length,1);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret-do-not-echo'));
 }
});

test('unsupported schema, nested settings, URLs and invalid path values are rejected',async()=>{
 for(const config of [null,[],{}, {schemaVersion:2},{schemaVersion:1,nodeExecutable:{env:{token:'synthetic'}}},{schemaVersion:1,browserExecutable:'https://user:synthetic@example.invalid/browser'},{schemaVersion:1,ffmpegExecutable:''},{schemaVersion:1,ffmpegExecutable:'bad\npath'},{schemaVersion:1,nodeModulesRoot:'\\\\server\\share'},{schemaVersion:1,nodeModulesRoot:'//server/share'},{schemaVersion:1,nodeExecutable:'C:node.exe'},{schemaVersion:1,nodeExecutable:'C:'},{schemaVersion:1,lockfilePath:'.env'}]){
  assert.equal((await inspectRuntimeConfig(config,testDirectory)).status,'CONFIG_INVALID');
 }
});

test('missing named files and packages produce findings instead of fabricated versions',async t=>{
 const f=await fixture(t);
 f.config.browserExecutable='missing-browser';await rm(path.join(f.dir,'node_modules/react/package.json'));await rm(path.join(f.dir,'site-packages/numpy/__init__.py'));
 const result=await f.run();assert.equal(result.status,'INCOMPLETE');
 for(const name of ['browserExecutable','react','numpy']){assert.equal(check(result,name).status,'MISSING');assert.equal(check(result,name).version,undefined);}
});

test('relative paths resolve from the configuration directory, not cwd',async t=>{
 const f=await fixture(t),relative=await f.run();
 const absolute=Object.fromEntries(Object.entries(f.config).map(([key,value])=>[key,key==='schemaVersion'?value:path.resolve(f.dir,value)]));
 assert.deepEqual(await inspectRuntimeConfig(absolute,testDirectory),relative);
});

test('wrong file types are unverified',async t=>{
 const f=await fixture(t);f.config.nodeExecutable='effects';f.config.effectsV1Root='tools/node';
 const result=await f.run();assert.equal(result.status,'INCOMPLETE');
 assert.equal(check(result,'nodeExecutable').status,'UNVERIFIED');assert.equal(check(result,'effectsV1Root').status,'UNVERIFIED');
});

test('package metadata must have the expected name and a declared version',async t=>{
 const f=await fixture(t);
 for(const content of ['{',JSON.stringify({name:'other',version:'1.2.3'}),JSON.stringify({name:'react'}),JSON.stringify({name:'react',version:'synthetic-secret-invalid-version'}),' '.repeat(128*1024+1)]){
  await f.put('node_modules/react/package.json',content);
  const result=await f.run();assert.equal(check(result,'react').status,'UNVERIFIED');assert.equal(check(result,'react').version,undefined);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret-invalid-version'));
 }
});

test('dependency metadata cannot escape a configured root through a directory link',async t=>{
 const f=await fixture(t);await rm(path.join(f.dir,'node_modules/react'),{recursive:true});
 await f.put('outside-react/package.json',JSON.stringify({name:'react',version:'9.9.9'}));
 await symlink(path.join(f.dir,'outside-react'),path.join(f.dir,'node_modules/react'),process.platform==='win32'?'junction':'dir');
 const result=await f.run();assert.equal(check(result,'react').status,'UNVERIFIED');assert.equal(check(result,'react').version,undefined);
});

test('unlisted packages and ancestor node_modules are not discovered',async t=>{
 const f=await fixture(t);await f.put('node_modules/unrelated/package.json','not JSON');
 const result=await f.run();assert.equal(result.status,'METADATA_PRESENT');assert.equal(check(result,'unrelated'),undefined);
 await mkdir(path.join(f.dir,'empty-node_modules'));f.config.nodeModulesRoot='empty-node_modules';
 const empty=await f.run();assert.equal(empty.status,'INCOMPLETE');
 for(const name of packages)assert.equal(check(empty,name).status,'MISSING');
});
