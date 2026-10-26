"""Local-only acceptance harness. No media or machine paths are committed."""
from pathlib import Path
import json,hashlib,subprocess,sys
R=Path(__file__).resolve().parent;S=Path(sys.argv[1]).resolve();local=R/'projects';local.mkdir(exist_ok=True)
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
ffmpeg=Path(sys.argv[2]);ffprobe=Path(sys.argv[3]);node=Path(sys.argv[4]);browser=Path(json.loads((S/'browser-runtime.json').read_text())['path'])
runtime=dict(schemaVersion=1,effectsV1Root=None,effectsV2Root=None,nodeModulesRoot=str(R/'node_modules'),nodeExecutable=str(node),pythonExecutable=sys.executable,pythonSitePackagesRoot=str(Path(sys.executable).parent/'Lib/site-packages'),browserExecutable=str(browser),ffmpegExecutable=str(ffmpeg),ffprobeExecutable=str(ffprobe),lockfilePath=str(R/'package-lock.json'))
(R/'runtime.local.json').write_text(json.dumps(runtime,indent=2))
source=S.parent.parent/'source/Edits_Easy_20261019_202407.mp4';broll=S/'public/broll-opening.mp4';audio=S/'outputs/Everywhere-Poster-Sample-B-Matched-Loudness.mp4'
assert sha(source)=='c14465a16bc8587bb36f36208828436fee8bcde379ca87795eddf6ad250a5c55','Original source changed'
assert sha(broll)=='6e6535be4dd800ae254e5624d5aa3ff8739c1b62bca07d2cf5562f3b3cbf7b5e','Owned B-roll changed'
assert sha(audio)=='5664ce03f98fe51746e5fa685f0e65f4a57c297d959dbd46b9f9ce3e25b93c68','Approved audio changed'
assets=[dict(id='source',kind='video',file='assets/source.mp4',sha256=sha(source),duration=59.633333,fps=30,width=1440,height=2560,evidence='User-owned original Easy recording'),dict(id='owned-broll',kind='video',file='assets/owned-broll.mp4',sha256=sha(broll),duration=2.3,fps=30,width=1080,height=1920,evidence='Owned B-roll frames 150-219, original sha256 94157d4d76110972a06fc861d35bdd5e04282b1ddae3e10e4f36c01c4f39a748')]
inputs=[dict(id=a['id'],path=str(p),sha256=a['sha256']) for a,p in zip(assets,[source,broll])]
for i,at in enumerate([.5,1.8]):
 p=local/f'owned-still-{i}.png'
 if not p.exists():subprocess.run([str(ffmpeg),'-v','error','-ss',str(at),'-i',str(broll),'-frames:v','1','-n',str(p)],check=True)
 a=dict(id=f'owned-still-{i}',kind='image',file=f'assets/owned-still-{i}.png',sha256=sha(p),evidence=f'Unmodified owned B-roll derivative frame at {at}s');assets.append(a);inputs.append(dict(id=a['id'],path=str(p),sha256=a['sha256']))
words=[dict(id=f'w{i}',text=w['text'],start=w['start'],end=w['end']) for i,w in enumerate(json.loads((S/'public/sample-words.json').read_text())['words'])]
def event(kind,idx,props,bounds):return dict(id=kind,type=kind,from_=round(words[idx]['start']*30),frames=60,anchorWords=[words[idx]['id']],reason='Narration-anchored owned acceptance illustration',bounds=bounds,props=props)
p=dict(schemaVersion=1,id='owned-easy-acceptance',revision=1,profile='easy-graphics-v1',canvas=dict(width=1080,height=1920,fps=30),source=dict(assetId='source',sha256=sha(source),frames=1789),assets=assets,cuts=[dict(in_=a,out=b,reason='Existing approved sample source cut') for a,b in [[632,701],[712,919],[934,1104]]],words=words,captions=[dict(wordIds=[w['id'] for w in words[i:i+4]]) for i in range(0,len(words),4)],speaker=dict(count=1,faces=[dict(t=t,x=300,y=520,width=450,height=430) for t in [0,7,14]]),broll=[dict(id='physical-work',assetId='owned-broll',from_=round(words[3]['start']*30),frames=35,sourceStart=.5,anchorWords=[words[3]['id']],reason='Owned footage illustrating work')],effects=[event('EasyRelationship',12,dict(layout='flow',heading='AI helps tailor',theme='light',nodes=[dict(id='tone',label='Tone + context',icon='document'),dict(id='format',label='Length + layout',icon='recording')]),dict(x=140,y=295,width=700,height=180)),event('EasyMediaPanels',30,dict(theme='dark',panels=[dict(id='one',assetId='owned-still-0',at=0),dict(id='two',assetId='owned-still-1',at=.3)]),dict(x=140,y=1000,width=700,height=235))],safeZones=dict(version=1,profiles=['linkedin-organic-v1']),director=dict(summary='Owned acceptance of captions, footage and accessible registered graphics; no new publication or capability claim',decisions=[]))
for c in p['cuts']:c['in']=c.pop('in_')
for e in p['effects']+p['broll']:e['from']=e.pop('from_')
font=S/'public/Body-Bold.ttf';m=dict(schemaVersion=1,project=p,inputs=dict(assets=inputs,font=dict(path=str(font),sha256=sha(font)),audio=dict(path=str(audio),sha256=sha(audio),timeline=dict(sourceSha256=p['source']['sha256'],fps=30,cuts=[[632,701],[712,919],[934,1104]]))),provenance=dict(origin='approved-edl',cooked=None,originalSourceSha256=sha(source),proxy=None,audioReference='User-approved sample B; decode audio only, no DSP'))
(R/'owned.local.json').write_text(json.dumps(m,indent=2));print('Local owned manifest prepared; media remain ignored.')
