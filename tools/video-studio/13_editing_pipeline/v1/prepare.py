"""Import a verified Cooked edit without rendering its compressed cut again.

Usage: python prepare.py RAW_VIDEO COOKED_EDIT NEW_PROJECT
The new project gets original media, original-timeline cuts, and cached alignment.
AI direction is supplied as project.json after inspecting director-input.json.
"""
import hashlib,json,shutil,subprocess,sys
from pathlib import Path

def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        while chunk:=f.read(1024*1024): h.update(chunk)
    return h.hexdigest()
def probe(p):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
def run(args): subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
def write(p,d): p.write_text(json.dumps(d,indent=2)+'\n')

def main():
    raw,cooked,out=map(lambda s:Path(s).resolve(),sys.argv[1:4])
    studio=Path(__file__).resolve().parents[2]
    if out.exists(): raise ValueError('Use a new project directory; existing projects are immutable')
    meta=probe(raw);v=next(s for s in meta['streams'] if s['codec_type']=='video');a=next(s for s in meta['streams'] if s['codec_type']=='audio')
    n,d=map(int,v['r_frame_rate'].split('/'));fps=n/d
    if fps!=int(fps) or fps<24 or fps>60 or abs(v['width']/v['height']-9/16)>.001: raise ValueError('Pilot requires CFR portrait 24–60 fps')
    if v.get('color_transfer') not in [None,'bt709']: raise ValueError('HDR needs an explicit color-management path')
    if abs(float(v.get('start_time','nan')))>.001 or abs(float(a.get('start_time','nan')))>.001: raise ValueError('Nonzero stream timestamps require explicit alignment')
    duration=float(meta['format']['duration']);fps=int(fps)
    if duration>1800 or raw.stat().st_size>4*1024**3: raise ValueError('Local admission: <=30 min, <=4 GiB; capacity is not yet accepted at this ceiling')
    source_hash=sha(raw)
    provenance=json.loads((cooked/'advanced-provenance.json').read_text())
    if provenance['preserved_files'].get(str(raw),{}).get('sha256')!=source_hash: raise ValueError('Cooked/source hash mismatch')
    cuts=[{'in':round(c['start']*fps),'out':round(c['end']*fps),'reason':'Existing reviewed Cooked speech cut; original source order retained'} for c in json.loads((cooked/'decisions.json').read_text())]
    frames=sum(c['out']-c['in'] for c in cuts)
    public=out/'public';assets=public/'assets';assets.mkdir(parents=True)
    inventory=[]
    def stage(asset_id,path,evidence):
        p=Path(path).resolve();dest=assets/(asset_id+p.suffix.lower());shutil.copy2(p,dest)
        digest=sha(p)
        if sha(dest)!=digest: raise ValueError('Staging mismatch')
        rec={'id':asset_id,'file':'assets/'+dest.name,'sha256':digest,'kind':'image','evidence':evidence,'originalPath':str(p)}
        if p.suffix.lower() in ['.mp4','.mov']:
            info=probe(p);s=next(x for x in info['streams'] if x['codec_type']=='video');num,den=map(int,s['r_frame_rate'].split('/'))
            rec.update(kind='video',duration=float(info['format']['duration']),fps=num/den,width=s['width'],height=s['height'])
        inventory.append(rec);return rec,dest
    source,staged=stage('source',raw,'Original talking-head recording, verified against Cooked source receipt')
    source['previewFile']='assets/source-preview.mp4'
    run(['ffmpeg','-v','error','-n','-i',str(staged),'-map','0:v:0','-vf','scale=720:1280','-an','-c:v','libx264','-crf','23','-preset','veryfast','-threads','2','-movflags','+faststart',str(public/source['previewFile'])])
    broll,bpath=stage('broll',studio/'02_broll_linecut/Edits_Broll_20261019_195218.MP4','Owned footage of the same founder at a laptop; workload illustration, not product-function proof')
    broll['previewFile']='assets/broll-preview.mp4'
    run(['ffmpeg','-v','error','-n','-threads','2','-i',str(bpath),'-map','0:v:0','-vf','scale=720:1280','-an','-c:v','libx264','-crf','24','-preset','fast','-threads','2','-g','30','-pix_fmt','yuv420p','-movflags','+faststart',str(public/broll['previewFile'])])
    proxy=next(s for s in probe(public/broll['previewFile'])['streams'] if s['codec_type']=='video')
    original=next(s for s in probe(bpath)['streams'] if s['codec_type']=='video')
    if proxy.get('nb_frames')!=original.get('nb_frames'): raise ValueError('B-roll preview changed the source frame count')
    for name,at in [('laptop',8.5),('typing',14.5),('coding',24.5)]:
        dest=assets/(name+'.png');run(['ffmpeg','-v','error','-n','-ss',str(at),'-i',str(bpath),'-frames:v','1',str(dest)])
        inventory.append({'id':name,'file':'assets/'+dest.name,'sha256':sha(dest),'kind':'image','evidence':f'Unmodified frame at {at}s of owned B-roll; same speaker and setting'})
    for name in ['font.ttf','logo.png']:
        shutil.copy2(studio/'08_reviews/all_effects_v2/public-staged'/name,public/name)
    labels=''.join(f'[a{i}]' for i in range(len(cuts)))
    graph=f'[0:a]asplit={len(cuts)}{labels};'+''.join(f'[a{i}]atrim=start={c["in"]/fps}:end={c["out"]/fps},asetpts=PTS-STARTPTS[b{i}];' for i,c in enumerate(cuts))
    graph+=''.join(f'[b{i}]' for i in range(len(cuts)))+f'concat=n={len(cuts)}:v=0:a=1,aresample=48000,apad=whole_len={round(frames/fps*48000)},atrim=end_sample={round(frames/fps*48000)}[audio]'
    run(['ffmpeg','-v','error','-n','-i',str(staged),'-filter_complex',graph,'-map','[audio]','-c:a','pcm_s16le',str(public/'speech.wav')])
    words=[{'id':f'w{i}','text':w['text'],'start':w['start'],'end':min(w['end'],frames/fps)} for i,w in enumerate(json.loads((cooked/'captions.json').read_text())) if w.get('type','word')=='word']
    groups=[];group=[]
    for w in words:
        candidate=' '.join(x['text'] for x in group+[w])
        if group and (len(candidate)>25 or len(group)>=5 or w['start']-group[-1]['end']>.35): groups.append({'wordIds':[x['id'] for x in group]});group=[]
        group.append(w)
        if w['text'].endswith(('.', '?', '!', ',', ';')):groups.append({'wordIds':[x['id'] for x in group]});group=[]
    if group:groups.append({'wordIds':[x['id'] for x in group]})
    faces=[{'t':s['t'],'x':s['box'][0]*10.8,'y':s['box'][1]*19.2,'width':s['box'][2]*10.8,'height':s['box'][3]*19.2} for s in json.loads((cooked/'face.json').read_text())['heads']]
    draft={'schemaVersion':1,'id':out.name,'revision':1,'canvas':{'width':v['width'],'height':v['height'],'fps':fps},'source':{'assetId':'source','sha256':source_hash,'frames':round(duration*fps)},'assets':inventory,'cuts':cuts,'words':words,'captions':groups,'speaker':{'count':1,'basis':'Existing sampled visual face boxes in Cooked cut time; no multi-speaker diarization claim','faces':faces},'broll':[],'effects':[],'director':{'summary':'AWAITING AI DIRECTION','decisions':[]},'provenance':{'cookedCommit':provenance['editor_commit'],'cookedProject':str(cooked),'inputs':{f:sha(cooked/f) for f in ['decisions.json','captions.json','face.json']},'sourceDurationSeconds':duration}}
    write(out/'draft.json',draft)
    write(out/'director-input.json',{'source':draft['source'],'canvas':draft['canvas'],'outputSeconds':frames/fps,'words':words,'assets':inventory,'brief':'Preserve script order and hook. Select authentic B-roll and reusable motion by narration meaning. Respect explicit script cues; preserve source and prior work. Protect observed speaker. Produce reviewable JSON, not a new rendering app. No publishing.','brollIndex':(studio/'11_registry/broll_segments.csv').read_text()})
    write(out/'prepare-receipt.json',{'source':str(raw),'sourceSha256':source_hash,'sourceUnchanged':sha(raw)==source_hash,'outputFrames':frames,'outputSeconds':frames/fps,'audioTimeline':{'sourceSha256':source_hash,'fps':fps,'cuts':[[c['in'],c['out']] for c in cuts]},'audioSha256':sha(public/'speech.wav'),'originalResolution':[v['width'],v['height']],'previewResolution':[720,1280]})
    print(json.dumps({'project':str(out),'frames':frames,'seconds':frames/fps,'resolution':[v['width'],v['height']]}))
if __name__=='__main__':main()
