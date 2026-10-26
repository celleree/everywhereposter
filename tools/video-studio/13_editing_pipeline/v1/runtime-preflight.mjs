import {readFile,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const fields={effectsV1Root:'directory',effectsV2Root:'directory',nodeModulesRoot:'directory',nodeExecutable:'file',pythonExecutable:'file',pythonSitePackagesRoot:'directory',browserExecutable:'file',ffmpegExecutable:'file',ffprobeExecutable:'file',lockfilePath:'file'};
const packages=['@remotion/bundler','@remotion/renderer','@remotion/player','remotion','react','react-dom','esbuild'];
const lockfiles=['package-lock.json','pnpm-lock.yaml','yarn.lock'];
const report=(status,checks)=>({schemaVersion:1,status,runtimeCompatibility:'UNVERIFIED',checks});
const invalid=detail=>report('CONFIG_INVALID',[{name:'configuration',status:'INVALID',detail}]);

function validate(config){
 if(!config||Array.isArray(config)||typeof config!=='object'||config.schemaVersion!==1)return 'Use a JSON object with schemaVersion 1.';
 if(Object.keys(config).some(key=>key!=='schemaVersion'&&!Object.hasOwn(fields,key)))return 'Unknown configuration fields are forbidden; use only the documented path fields. Credentials and environment settings are not accepted.';
 for(const key of Object.keys(fields)){
  const value=config[key];
  if(value==null)continue;
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||/[\x00-\x1f]/.test(value)||/^[a-z][a-z0-9+.-]*:\/\//i.test(value)||/^(?:\\\\|\/\/|[a-z]:(?:$|[^\\/]))/i.test(value))return `${key} must be a local path string or null; URLs, network/drive-relative paths and control characters are forbidden.`;
  if(key==='lockfilePath'&&!lockfiles.includes(path.basename(value)))return 'lockfilePath must name package-lock.json, pnpm-lock.yaml or yarn.lock.';
 }
}

async function readJson(file,maxBytes){
 const info=await stat(file);
 if(!info.isFile()||info.size>maxBytes)throw Error('Unsupported metadata file');
 return JSON.parse(await readFile(file,'utf8'));
}

async function inspectPath(name,file,kind){
 try{
  const info=await stat(file);
  if(kind==='directory'?!info.isDirectory():!info.isFile())return {name,status:'UNVERIFIED',detail:`Expected a ${kind}; correct the configured path.`};
  return {name,status:'FOUND',detail:`${kind==='directory'?'Directory':'File'} exists; contents, executability and compatibility are unverified.`};
 }catch(error){
  return {name,status:error.code==='ENOENT'||error.code==='ENOTDIR'?'MISSING':'UNVERIFIED',detail:`Cannot inspect the configured ${kind}; supply an approved existing prerequisite or correct its path.`};
 }
}

// Follow only named metadata beneath an explicitly configured root, never ancestor lookup.
async function withinRoot(root,relative){
 const base=await realpath(root),file=await realpath(path.join(base,relative)),rel=path.relative(base,file);
 if(rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel))throw Error('Metadata resolves outside configured root');
 return file;
}

export async function inspectRuntimeConfig(config,configDirectory){
 const error=validate(config);
 if(error)return invalid(error);
 const checks=[],roots={};
 for(const [name,kind] of Object.entries(fields)){
  if(config[name]==null){checks.push({name,status:'NOT_CONFIGURED',detail:`Set ${name} to an approved existing ${kind}; no automatic discovery or installation is performed.`});continue;}
  const file=path.resolve(configDirectory,config[name]),check=await inspectPath(name,file,kind);
  checks.push(check);if(check.status==='FOUND')roots[name]=file;
 }
 if(roots.nodeModulesRoot)for(const name of packages){
  try{
   const file=await withinRoot(roots.nodeModulesRoot,`${name}/package.json`),metadata=await readJson(file,128*1024);
   if(metadata?.name!==name||typeof metadata.version!=='string'||metadata.version.length>100||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(metadata.version))throw Error('Invalid package identity');
   checks.push({name,status:'FOUND',version:metadata.version,detail:'Declared package metadata only; package code and compatibility were not checked.'});
  }catch(error){
   checks.push({name,status:error.code==='ENOENT'||error.code==='ENOTDIR'?'MISSING':'UNVERIFIED',detail:'Provide matching package.json name/version metadata inside nodeModulesRoot; no package code is loaded.'});
  }
 }
 if(roots.pythonSitePackagesRoot)for(const name of ['numpy','PIL']){
  try{
   const file=await withinRoot(roots.pythonSitePackagesRoot,`${name}/__init__.py`);
   checks.push(await inspectPath(name,file,'file'));
  }catch(error){
   checks.push({name,status:error.code==='ENOENT'||error.code==='ENOTDIR'?'MISSING':'UNVERIFIED',detail:'Provide the existing package inside pythonSitePackagesRoot; Python is never launched and package code is never read.'});
  }
 }
 return report(checks.every(check=>check.status==='FOUND')?'METADATA_PRESENT':'INCOMPLETE',checks);
}

async function main(){
 let result;
 if(process.argv.length!==3)result=invalid('Usage: node runtime-preflight.mjs path/to/runtime-config.json');
 else{
  try{
   const file=path.resolve(process.argv[2]),config=await readJson(file,64*1024);
   result=await inspectRuntimeConfig(config,path.dirname(file));
  }catch{result=invalid('Cannot read runtime configuration; provide a readable JSON object no larger than 64 KiB.');}
 }
 console.log(JSON.stringify(result,null,2));
 process.exitCode=result.status==='CONFIG_INVALID'?2:result.status==='INCOMPLETE'?1:0;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
