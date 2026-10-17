"""Local image acceptance only; no daemon, API, broker, or publishing integration."""
import argparse, hashlib, json, math, shutil, subprocess, sys, time
from fractions import Fraction
from pathlib import Path

base=Path('/opt/upstream/plugins/ai-editor')
sys.path.insert(0,str(base/'lib'))
from ai_editor.review import apply_edits

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cut',nargs=2,type=float);a=ap.parse_args()
    source=Path('/input/source.mp4');edit=Path('/work/edit')
    assert source.is_file() and not source.is_symlink()
    assert source.stat().st_size<=100*1024*1024
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(source)]))
    video=next(s for s in probe['streams']if s['codec_type']=='video');audio=next(s for s in probe['streams']if s['codec_type']=='audio')
    duration=float(probe['format']['duration']);fps=float(Fraction(video['avg_frame_rate']))
    assert math.isfinite(duration) and 0<duration<=60 and math.isfinite(fps) and 0<fps<=60
    assert max(video['width'],video['height'])<=1920 and min(video['width'],video['height'])<=1080
    assert all(abs(float(s['start_time']))<0.02 for s in (video,audio,probe['format']))
    assert not edit.exists(), 'FRESH_WORKSPACE_REQUIRED'
    edit.mkdir(mode=0o700)
    before=hashlib.sha256(source.read_bytes()).hexdigest();start=time.monotonic()
    def run(name,args):
        script=base/('lib/ai_editor/review.py' if name=='review' else f'skills/cut/scripts/{name}.py')
        subprocess.run([sys.executable,str(script),*map(str,args)],check=True,timeout=60)
    def render():
        run('build_timeline',[source,edit]);run('render',[source,edit,'--max','1080'])
        (edit/'cut.transcript.json').unlink(missing_ok=True)
        run('verify_cut',[edit,'--engine','whisper'])
    run('transcribe',[source,edit/'words.raw.json','--engine','whisper','--lang','en'])
    run('retakes',['propose',edit]);render()
    run('review',[edit,'start','--video',edit/'cut.mp4','--stage','cut','--transcript',edit/'words.json']);run('review',[edit,'final'])
    first=hashlib.sha256((edit/'cut.mp4').read_bytes()).hexdigest()
    if a.cut:
        assert all(math.isfinite(n)for n in a.cut)and 0 <= a.cut[0] < a.cut[1] <= duration
        for restore,cut in (([],[a.cut]),([a.cut],[])):
            apply_edits(edit,restore,cut);render()
            run('review',[edit,'round','--video',edit/'cut.mp4','--stage','cut','--transcript',edit/'words.json'])
        assert hashlib.sha256((edit/'cut.mp4').read_bytes()).hexdigest()==first,'RESTORE_DIFFERS'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before,'SOURCE_CHANGED'
    def cgroup(name):
        try:return Path('/sys/fs/cgroup',name).read_text().strip()
        except OSError:return None
    summary={'result':'PASS','seconds':round(time.monotonic()-start,3),'sourcePreserved':True,'cutRestore':bool(a.cut),'restoreByteMatchesFirstPass':bool(a.cut),'outputBytes':(edit/'cut.mp4').stat().st_size,'memoryPeakBytes':cgroup('memory.peak'),'memoryEvents':cgroup('memory.events'),'cpuStat':cgroup('cpu.stat'),'paidCalls':0}
    shutil.copyfile(edit/'cut.mp4','/output/cut.mp4')
    Path('/output/result.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))

if __name__=='__main__':main()
