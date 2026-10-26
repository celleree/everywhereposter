import json, os, subprocess, sys, tempfile, time
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
from contract import validate, checked_policy
from runtime.proxy_relay import start

def arguments(url):
    return [sys.executable,'/opt/yt-dlp','--ignore-config','--no-config-locations',
            '--no-plugin-dirs','--no-remote-components','--no-js-runtimes',
            '--proxy','http://127.0.0.1:18080','--no-playlist','--no-cache-dir',
            '--socket-timeout','15','--retries','1','--fragment-retries','1',
            '--no-progress','--no-warnings','--fixup','never','--no-part',
            '--no-overwrites','--format','best[ext=mp4]/best','--',url]

def completed_download(code,file,limit):
    # Official yt-dlp exits101 when max-downloads=1 stops after the first file.
    # Neither code alone proves success: require bytes, then offline media QA.
    if code not in [0,101] or not os.path.isfile(file) or os.path.islink(file) or not 0<os.stat(file).st_size<=limit:
        raise ValueError('invalid_media')

def check_metadata(meta,request,policy):
    duration=meta.get('duration')
    if meta.get('_type') in ['playlist','multi_video'] or meta.get('is_live') or meta.get('live_status') in ['is_live','is_upcoming','post_live']:
        raise ValueError('unsupported_source')
    # Generic direct MP4 commonly has no duration; authoritative bounded probing
    # occurs offline after byte/time-limited acquisition, never assume its length.
    if duration is not None:
        if type(duration) not in [int,float] or not 0<duration<=policy['sourceSeconds']: raise ValueError('unsupported_source')
        if request['interval'][1]>duration: raise ValueError('invalid_interval')
    return duration

def run(request,policy):
    validate(request,policy);start();started=time.monotonic();args=arguments(request['url'])
    def remaining(): return max(.01,policy['acquisitionSeconds']-(time.monotonic()-started))
    with tempfile.TemporaryFile(dir='/job') as info:
        subprocess.run(args[:-2]+['--dump-single-json','--skip-download']+args[-2:],stdout=info,stderr=subprocess.DEVNULL,check=True,timeout=remaining())
        info.seek(0);raw=info.read(1024*1024+1)
        if len(raw)>1024*1024: raise ValueError('metadata_over_budget')
        meta=json.loads(raw)
    duration=check_metadata(meta,request,policy)
    result=subprocess.run(args[:-2]+['--max-downloads','1','--max-filesize',str(policy['trafficBytes']),'-o','/job/download.bin']+args[-2:],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=remaining(),check=False)
    file='/job/download.bin'
    completed_download(result.returncode,file,policy['trafficBytes'])
    return {'status':'downloaded','duration':duration,'sourceId':str(meta.get('id',''))[:200],'extractor':str(meta.get('extractor_key',''))[:200]}

if __name__=='__main__':
    try:
        envelope=json.loads(sys.stdin.buffer.read(65537))
        print(json.dumps(run(envelope['request'],checked_policy(envelope['policy']))))
    except Exception:
        print(json.dumps({'status':'failed','reason':'acquisition_failed_or_blocked'}));sys.exit(1)
