"""Noninteractive final-file verification. No voice DSP; listening is not claimed."""
import argparse,hashlib,json,re,subprocess,sys
from pathlib import Path
import numpy as np

def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  while b:=f.read(1048576):h.update(b)
 return h.hexdigest()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('project');parser.add_argument('--runtime',required=True);args=parser.parse_args()
 root=Path(args.project).resolve();runtime_file=Path(args.runtime).resolve();runtime=json.loads(runtime_file.read_text());ffmpeg=runtime['ffmpegExecutable'];ffprobe=runtime['ffprobeExecutable'];node=runtime['nodeExecutable']
 if Path(sys.executable).resolve()!=Path(runtime['pythonExecutable']).resolve():raise ValueError('Running Python differs from configured Python')
 def bindings():return json.loads(subprocess.check_output([node,str(Path(__file__).with_name('receipt-bindings.mjs')),str(root),str(runtime_file)],text=True))
 bound=bindings();p=json.loads((root/'project.json').read_text());final=root/'final.mp4';fps=p['canvas']['fps'];frames=sum(c['out']-c['in'] for c in p['cuts']);expected=frames/fps
 rendered=json.loads((root/'render-receipt.json').read_text())
 assert rendered.get('bindings')==bound,'Renderer/input/runtime changed after rendering'
 assert rendered.get('projectHash')==sha(root/'project.json') and rendered.get('sha256')==sha(final),'Render receipt mismatch'
 meta=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(final)]));v=next(x for x in meta['streams'] if x['codec_type']=='video');a=next(x for x in meta['streams'] if x['codec_type']=='audio')
 assert int(v['nb_frames'])==frames and v['width']==p['canvas']['width'] and v['height']==p['canvas']['height']
 assert abs(float(meta['format']['duration'])-expected)<.08 and abs(float(a['duration'])-expected)<.08
 assert v['codec_name']=='h264' and a['codec_name']=='aac' and abs(float(v.get('start_time',0)))<1/fps
 subprocess.run([ffmpeg,'-v','error','-i',str(final),'-f','null','-'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def pcm(file):return np.frombuffer(subprocess.check_output([ffmpeg,'-v','error','-i',str(file),'-map','0:a:0','-f','f32le','-ac','1','-ar','8000','-']),dtype=np.float32)
 reference=pcm(root/'public/speech.wav');encoded=pcm(final);n=min(len(reference),len(encoded));x=reference[:n].astype(float);y=encoded[:n].astype(float);x-=x.mean();y-=y.mean()
 assert n>1000 and np.std(x)>.00001,'Missing audible reference'
 nfft=1<<(2*n-1).bit_length();r=np.fft.irfft(np.fft.rfft(y,nfft)*np.conj(np.fft.rfft(x,nfft)),nfft);lags=np.arange(-80,81);lag=int(lags[np.argmax(r[lags%nfft])]);corr=float(np.corrcoef(x,y)[0,1]);assert abs(lag)<=8 and corr>.995,(lag,corr)
 windows=[]
 for start in range(0,n-8000+1,8000):
  xx=x[start:start+8000];yy=y[start:start+8000]
  if np.std(xx)<.001:continue
  c=float(np.corrcoef(xx,yy)[0,1]);assert c>.97,('Changed speech window',start/8000,c);windows.append({'startSeconds':start/8000,'correlation':c})
 source=next(a for a in p['assets'] if a['id']==p['source']['assetId']);quality=[]
 for frame in sorted(set([min(15,frames-1),frames//2,max(0,frames-30)])):
  # Only compare the unmodified upper half. Covered samples are explicitly skipped.
  if any(e['from']<=frame<e['from']+e['frames'] for e in p['broll']) or any(e['from']<=frame<e['from']+e['frames'] and e['bounds']['y']<960 for e in p['effects']):continue
  offset=0;original=None
  for cut in p['cuts']:
   if offset<=frame<offset+cut['out']-cut['in']:original=cut['in']+frame-offset;break
   offset+=cut['out']-cut['in']
  w=p['canvas']['width'];h=p['canvas']['height'];half=(h//4)*2
  filt=f'[0:v]crop=iw:{half}:0:0,format=yuv420p,setpts=PTS-STARTPTS[x];[1:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},crop=iw:{half}:0:0,format=yuv420p,setpts=PTS-STARTPTS[y];[x][y]ssim'
  result=subprocess.run([ffmpeg,'-hide_banner','-ss',str(frame/fps),'-i',str(final),'-ss',str(original/fps),'-i',source['originalPath'],'-filter_complex',filt,'-frames:v','1','-an','-f','null','-'],capture_output=True,text=True,check=True)
  found=re.findall(r'All:([0-9.]+)',result.stderr);assert found,result.stderr[-800:];value=float(found[-1]);assert value>.95,(frame,value);quality.append({'outputFrame':frame,'sourceFrame':original,'upperPictureSSIM':value})
 assert bindings()==bound and sha(final)==rendered['sha256'],'Inputs or output changed during QA'
 result={'schemaVersion':1,'status':'PASS','acceptance':'TECHNICAL_PASS_CREATIVE_REVIEW_REQUIRED','bindings':bound,'projectId':p['id'],'revision':p['revision'],'profile':p['profile'],'file':str(final),'sha256':rendered['sha256'],'projectSha256':bound['projectHash'],'rendererHash':bound['rendererHash'],'frames':frames,'durationSeconds':expected,'resolution':[v['width'],v['height']],'fps':fps,'fullDecode':'PASS','audioLagMs':lag/8,'audioCorrelation':corr,'audioWindows':windows,'sourcePreserved':True,'sampledUnchangedPicture':quality,'creativeApproval':'PENDING','continuousHumanListening':'NOT_CLAIMED','limitations':['Observed single speaker; no automatic face tracking','Only selected safe-zone profiles are assessed; focal coverage warnings still require review','Caption/effect ink measured during rendering; no claim of platform UI invariance','Same-clock originals only; preview proxies are rejected','Cooked provenance records verified upstream files; this adapter does not run Cooked']}
 (root/'qa/final-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'PASS','sha256':result['sha256'],'frames':frames,'audioLagMs':lag/8,'audioCorrelation':corr,'unchangedPictureSamples':len(quality)}))

if __name__=='__main__':
 try:main()
 except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
