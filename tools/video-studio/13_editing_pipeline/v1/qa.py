"""Final-file QA, source preservation and sampled unchanged-picture quality."""
import hashlib,json,math,re,subprocess,sys
from pathlib import Path
import numpy as np

def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  while b:=f.read(1048576):h.update(b)
 return h.hexdigest()
def pcm(p):return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(p),'-map','0:a:0','-f','f32le','-ac','1','-ar','8000','-']),dtype=np.float32)
root=Path(sys.argv[1]).resolve();p=json.loads((root/'project.json').read_text());final=root/'final.mp4';fps=p['canvas']['fps'];frames=sum(c['out']-c['in'] for c in p['cuts']);expected=frames/fps
prepared=json.loads((root/'prepare-receipt.json').read_text())
assert prepared['audioTimeline']=={'sourceSha256':p['source']['sha256'],'fps':fps,'cuts':[[c['in'],c['out']] for c in p['cuts']]},'Audio timeline changed'
assert prepared['audioSha256']==sha(root/'public/speech.wav'),'Prepared audio changed'
meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(final)]));v=next(x for x in meta['streams'] if x['codec_type']=='video');a=next(x for x in meta['streams'] if x['codec_type']=='audio')
assert int(v['nb_frames'])==frames and v['width']==p['canvas']['width'] and v['height']==p['canvas']['height']
assert abs(float(meta['format']['duration'])-expected)<.08 and abs(float(a['duration'])-expected)<.08
assert v['codec_name']=='h264' and a['codec_name']=='aac'
subprocess.run(['ffmpeg','-v','error','-i',str(final),'-f','null','-'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
reference=pcm(root/'public/speech.wav');encoded=pcm(final);n=min(len(reference),len(encoded));x=reference[:n].astype(float);y=encoded[:n].astype(float);x-=x.mean();y-=y.mean()
# Existing NumPy FFT path; no additional scientific runtime is required.
nfft=1<<(2*n-1).bit_length();r=np.fft.irfft(np.fft.rfft(y,nfft)*np.conj(np.fft.rfft(x,nfft)),nfft);lags=np.arange(-80,81);lag=int(lags[np.argmax(r[lags%nfft])]);corr=float(np.corrcoef(x,y)[0,1]);assert abs(lag)<=8 and corr>.995,(lag,corr)
source=next(x for x in p['assets'] if x['id']==p['source']['assetId']);assert sha(Path(source['originalPath']))==source['sha256']
quality=[]
for seconds in [2,23,40,55,65,81]:
 frame=round(seconds*fps);offset=0;original=None
 for cut in p['cuts']:
  if offset<=frame<offset+cut['out']-cut['in']:original=cut['in']+frame-offset;break
  offset+=cut['out']-cut['in']
 if original is None:continue
 h=(p['canvas']['height']//4)*2
 filt=f'[0:v]crop=iw:{h}:0:0,format=yuv420p,setpts=PTS-STARTPTS[x];[1:v]crop=iw:{h}:0:0,format=yuv420p,setpts=PTS-STARTPTS[y];[x][y]ssim'
 result=subprocess.run(['ffmpeg','-hide_banner','-ss',str(frame/fps),'-i',str(final),'-ss',str(original/fps),'-i',source['originalPath'],'-filter_complex',filt,'-frames:v','1','-an','-f','null','-'],capture_output=True,text=True,check=True)
 m=re.findall(r'All:([0-9.]+)',result.stderr);assert m,result.stderr[-800:];value=float(m[-1]);quality.append({'outputFrame':frame,'sourceFrame':original,'faceAreaSSIM':value})
 assert value>.95,(seconds,value)
result={'status':'PASS','file':str(final),'sha256':sha(final),'projectSha256':sha(root/'project.json'),'frames':frames,'durationSeconds':expected,'resolution':[v['width'],v['height']],'sourceResolutionRetained':True,'fullDecode':'PASS','audioLagMs':lag/8,'audioCorrelation':corr,'sourcePreserved':True,'sampledUnchangedPicture':quality,'creativeApproval':'PENDING','continuousHumanListening':'NOT_CLAIMED','limitations':['Single observed speaker; no multi-speaker diarization','AI direction supplied by Codex session, not an unattended new-upload service','SSIM samples cover unobscured picture only; lossy H.264 export is not lossless']}
(root/'qa/final-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
