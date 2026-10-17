// Opt-in worker entrypoint. No app configuration or credentials are loaded.
const fs = require('node:fs/promises');
const {createReadStream} = require('node:fs');
const crypto = require('node:crypto');
const net = require('node:net');
const {CookedEditorRuntime} = require('./cooked-editor-runtime');
const {listenCookedWorker} = require('./cooked-worker');
async function hash(path) { const h=crypto.createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex'); }
async function main() {
  if(process.getuid()===0)throw new Error('Worker must run unprivileged');
  const ipc=await fs.lstat('/ipc');
  if(!ipc.isDirectory()||ipc.isSymbolicLink()||ipc.uid!==process.getuid()||(ipc.mode&7))throw new Error('Private owned IPC directory required');
  const manifest=JSON.parse(await fs.readFile('/opt/source-manifest.json','utf8'));
  if(manifest.upstream!=='bce911c1d0652f30b64fd5283cc4aa9fa92811c9')throw new Error('Upstream pin mismatch');
  for(const [name,want]of Object.entries(manifest.sourceFiles)){
    if(name.startsWith('/')||name.split('/').includes('..')||await hash('/opt/upstream/'+name)!==want)throw new Error('Source hash mismatch');
  }
  for(const [name,want]of Object.entries(manifest.modelFiles)){
    if(!['model.bin','config.json','tokenizer.json','vocabulary.txt'].includes(name)||await hash('/opt/model/'+name)!==want)throw new Error('Model hash mismatch');
  }
  const socket='/ipc/cooked.sock';let prior;
  try{prior=await fs.lstat(socket)}catch(e){if(e.code!=='ENOENT')throw e}
  if(prior){
    if(!prior.isSocket()||prior.uid!==process.getuid())throw new Error('Refusing foreign IPC entry');
    const stale=await new Promise((resolve,reject)=>{
      const s=net.createConnection(socket);s.setTimeout(1000,()=>s.destroy(new Error('IPC probe deadline')));
      s.on('connect',()=>{s.destroy();resolve(false)});s.on('error',e=>e.code==='ECONNREFUSED'?resolve(true):reject(e));
    });
    if(!stale)throw new Error('Worker is already listening');
    const now=await fs.lstat(socket);if(now.ino!==prior.ino||!now.isSocket()||now.uid!==prior.uid)throw new Error('IPC entry changed');
    await fs.unlink(socket);
  }
  const runtime=new CookedEditorRuntime({sourceRoot:'/opt/upstream',python:'/usr/local/bin/python',modelPath:'/opt/model',workRoot:'/work/jobs',launcherPath:'/opt/runtime/cooked-editor-launcher.py',path:'/usr/local/bin:/usr/bin:/bin'});
  const server=await listenCookedWorker(runtime,'/work/jobs','/opt/upstream',socket);
  const retire=()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref()};
  server.once('sessionClosed',retire);
  process.on('SIGTERM',retire);
  console.log('Private offline editor worker ready');
}
main().catch(()=>{console.error('Editor worker startup failed; check private mounts and pinned package.');process.exitCode=1});
