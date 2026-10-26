"""Executed only in the offline image with /input read-only and /job tmpfs."""
import hashlib,json,math,os,subprocess,sys
from pathlib import Path

def run(spec):
    timeout=spec['policy']['normalizeSeconds'];source='/input/download.bin';output='/job/asset.mp4'
    def probe(file):
        raw=subprocess.check_output(['/usr/bin/ffprobe','-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',file],timeout=min(15,timeout))
        if len(raw)>1024*1024: raise ValueError('metadata_over_budget')
        return json.loads(raw)
    meta=probe(source);videos=[s for s in meta['streams'] if s['codec_type']=='video'];duration=float(meta['format']['duration'])
    if len(videos)!=1 or not math.isfinite(duration) or not 0<duration<=spec['policy']['sourceSeconds']+.1: raise ValueError('invalid_media')
    v=videos[0]
    if not 1<=v['width']<=7680 or not 1<=v['height']<=7680 or v.get('disposition',{}).get('attached_pic'): raise ValueError('invalid_media')
    start,end=spec['request']['interval']
    if end>duration+.001: raise ValueError('invalid_interval')
    subprocess.run(['/usr/bin/ffmpeg','-v','error','-n','-protocol_whitelist','file,pipe','-i',source,'-ss',str(start),'-t',str(end-start),'-map','0:v:0','-an','-vf',"scale=w='min(1080,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",'-r','30','-fps_mode','cfr','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-fs',str(spec['policy']['assetBytes']),'-movflags','+faststart',output],timeout=timeout,check=True)
    facts=probe(output);out=facts['streams'][0];actual=float(facts['format']['duration'])
    if abs(actual-(end-start))>1/30+.002 or out['codec_name']!='h264' or out['avg_frame_rate']!='30/1' or os.path.getsize(output)>spec['policy']['assetBytes']: raise ValueError('invalid_media')
    subprocess.run(['/usr/bin/ffmpeg','-v','error','-protocol_whitelist','file,pipe','-i',output,'-f','null','-'],timeout=timeout,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    with open(output,'rb') as f: sha=hashlib.file_digest(f,'sha256').hexdigest()
    with open(source,'rb') as f: original=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':sha,'acquiredSha256':original,'duration':actual,'fps':30,'width':out['width'],'height':out['height'],'codec':'h264','audio':'discarded supporting-footage audio','sourceInterval':list(spec['request']['interval']),'fullDecode':'PASS'}

if __name__=='__main__':
    try: print(json.dumps(run(json.loads(sys.stdin.buffer.read(65537)))))
    except Exception: print(json.dumps({'status':'failed','reason':'invalid_media_or_resource_limit'}));sys.exit(1)
