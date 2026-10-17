"""Restricted source-time policy; reuse native rendering/review/verification, never word cuts."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def read(path):
    return json.loads(path.read_text())


def save(path, value):
    path.write_text(json.dumps(value, indent=1))


def command(args):
    r = subprocess.run(args, capture_output=True, text=True, check=True, timeout=60)
    if len(r.stdout) + len(r.stderr) > 8 * 1024 * 1024:
        raise ValueError('ANALYSIS_LIMIT')
    return r


def probe(path):
    return json.loads(command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file',
        '-show_entries', 'format=start_time,duration:stream=codec_type,codec_name,start_time,duration,sample_rate,width,height,r_frame_rate',
        '-of', 'json', str(path)]).stdout)


def source_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def presentation_audio(audio, meta):
    # PyAV resampling can flush a few samples past an exact presentation end.
    # AAC can also expose at most one incomplete decoded packet. Trim only past
    # matching declared presentation ends; mismatched/long decoded tails remain.
    av = {kind: next((s for s in meta['streams'] if s['codec_type'] == kind), None)
          for kind in ('audio', 'video')}
    if all(av.values()):
        end = float(av['audio']['duration'])
        if math.isfinite(end) and end > 0 and abs(end-float(av['video']['duration'])) <= .001:
            samples = round(end*16000)
            padding = 16
            if av['audio'].get('codec_name') == 'aac':
                rate = int(av['audio']['sample_rate'])
                if not 8000 <= rate <= 192000:
                    raise ValueError('UNSUPPORTED_AUDIO_RATE')
                padding += math.ceil(1024/rate*16000)
            if 0 < len(audio)-samples <= padding:
                return audio[:samples]
    return audio


def prepare(source, edit, settings, B):
    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    meta = probe(source)
    video = next(s for s in meta['streams'] if s['codec_type'] == 'video')
    n, d = video['r_frame_rate'].split('/')
    if not 0 < float(n)/float(d) <= 30 or not 0 < min(video['width'], video['height']) <= 720 or max(video['width'], video['height']) > 1280:
        raise ValueError('UNSUPPORTED_BLOCK_RESOURCES')
    audio = presentation_audio(decode_audio(str(source)), meta)
    if not 0 < len(audio) <= 240 * 16000:
        raise ValueError('UNSUPPORTED_SOURCE')
    speech = get_speech_timestamps(audio, VadOptions(threshold=.2, min_silence_duration_ms=200, speech_pad_ms=120))
    if not speech:
        raise ValueError('NO_SPEECH')
    fps, duration, total = B.probe(source)
    times = json.loads(command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file', '-select_streams', 'v:0',
        '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(source)]).stdout)['frames']
    pts = [float(t['best_effort_timestamp_time']) for t in times]
    if not 0 < fps <= 30 or len(pts) != total or not 0 < total <= 7200 or abs(pts[0]) > .001 or any(
        abs(b-a-1/fps) > .001 for a, b in zip(pts, pts[1:])) or any(
        abs(float(s['start_time'])) > .001 for s in meta['streams'] if s['codec_type'] in ('audio', 'video')):
        raise ValueError('UNSUPPORTED_CFR_SOURCE')
    end = total / fps
    tail = audio[min(len(audio), round(end*16000)):]
    if end > len(audio)/16000 + .04 or (len(tail) and (max(abs(tail)) > 10**(-45/20) or any(s['end']/16000 > end for s in speech))):
        raise ValueError('UNALIGNED_AUDIO_TAIL')
    # Phase1 Natural's minimum pause/padding; stricter quiet level and VAD veto.
    noise = min(-45, settings['silenceThresholdDb'])
    stderr = command(['ffmpeg', '-hide_banner', '-nostdin', '-threads', '2', '-protocol_whitelist', 'file',
        '-i', str(source), '-map', '0:a:0', '-vn', '-af',
        f"silencedetect=noise={noise}dB:d={settings['minimumSilenceMs']/1000}", '-f', 'null', '-']).stderr
    gaps, start = [], None
    padding = settings['speechPaddingMs']/1000
    for kind, value in re.findall(r'silence_(start|end):\s*(-?[\d.]+)', stderr):
        if kind == 'start':
            start = max(0, float(value))
        elif start is not None:
            finish = min(float(value), end)
            # Global VAD misses quiet speech beside louder recordings. Recheck
            # each proposed quiet gap at local gain before permitting its edges.
            chunk = audio[round(start*16000):round(finish*16000)]
            peak = max(abs(chunk)) if len(chunk) else 0
            if peak:
                speech.extend(dict(start=s['start']+round(start*16000), end=s['end']+round(start*16000)) for s in
                    get_speech_timestamps(chunk*(.9/peak), VadOptions(threshold=.2, min_silence_duration_ms=100, speech_pad_ms=120)))
            pieces = [(start, finish)]
            for s in speech:
                a, b = s['start']/16000-padding, s['end']/16000+padding
                pieces = [(x, y) for lo, hi in pieces for x, y in [(lo, min(hi, a)), (max(lo, b), hi)] if y > x]
            gaps.extend((a, b) for a, b in pieces if b-a >= .25)
            start = None
    edges = []
    for a, b in gaps:
        frame = round((a+b)/2*fps)
        if a+.1 <= frame/fps <= b-.1:
            edges.append(frame)
    frames = [[a, b] for a, b in zip(edges, edges[1:]) if b > a and any(
        s['start']/16000 < b/fps and s['end']/16000 > a/fps for s in speech)]
    result = dict(version='quiet-block-v1', sourceSha256=source_hash(source), fps=fps, total=total,
        duration=duration, gaps=gaps, blockFrames=frames, blocks=[[a/fps, b/fps] for a, b in frames])
    save(edit/'boundary-policy.json', result)
    save(edit/'safe-cuts.json', [])


def selected(policy, edits, current):
    if not isinstance(edits, dict) or set(edits)-{'cut', 'restore', 'pause'} or edits.get('pause'):
        raise ValueError('UNSUPPORTED_BLOCK_EDIT')
    cut, restore = edits.get('cut', []), edits.get('restore', [])
    if not isinstance(cut, list) or not isinstance(restore, list) or not 0 < len(cut)+len(restore) <= 100:
        raise ValueError('UNSUPPORTED_BLOCK_EDIT')
    if any(r not in policy['blocks'] or r in current for r in cut) or any(r not in current for r in restore) or any(r in restore for r in cut):
        raise ValueError('UNSUPPORTED_BLOCK_EDIT')
    if len({tuple(r) for r in cut+restore}) != len(cut+restore):
        raise ValueError('UNSUPPORTED_BLOCK_EDIT')
    return sorted([r for r in current if r not in restore]+cut)


def build(source, edit, policy, current, B):
    import preview_cut
    fps, total = policy['fps'], policy['total']
    if any(r not in policy['blocks'] for r in current):
        raise ValueError('UNSUPPORTED_BLOCK_EDIT')
    chosen = [policy['blockFrames'][policy['blocks'].index(r)] for r in current]
    # Integer cut frames are exactly the published source ranges: no word snap or widening.
    cuts = [dict(start=(a+1e-7)/fps, end=(b-1e-7)/fps) for a, b in chosen]
    raw = read(edit/'words.raw.json')
    toks = [w for w in raw if w.get('type') in ('word', 'audio_event')]
    frames = B.kept_frames(cuts, fps, policy['duration'], total, [dict(start=0)])
    # Native's tiny-span suppression must not discard any unselected source frames.
    expected, cursor = [], 0
    for a, b in chosen:
        if cursor < a:
            expected.append([cursor, a])
        cursor = max(cursor, b)
    if cursor < total:
        expected.append([cursor, total])
    if frames != expected or not frames:
        raise ValueError('UNSAFE_NATIVE_TIMELINE')
    spans = [dict(start=a/fps, end=b/fps) for a, b in frames]
    model = [dict(start=a/fps, end=b/fps, kind='manual', confidence='high', evidence='Whole pause-bounded speech block') for a, b in chosen]
    final = sum(s['end']-s['start'] for s in spans)
    save(edit/'decisions.json', spans)
    save(edit/'report.json', dict(source=str(source), fps=fps, duration=policy['duration'], final_s=final,
        frames=frames, model_cuts=model, cuts=model, labels={}, splices_in_speech=[], keep=[], policy='quiet-block-v1'))
    save(edit/'words.json', B.retime(toks, spans))
    preview_cut.write_all(edit, toks, model, spans, policy['duration'], final)



def preserve_uncut_audio(source, edit, policy):
    # An untouched draft needs no AAC re-encode/fades. Preserve its actual ASR
    # source audio; edited timelines continue through the unchanged renderer.
    if read(edit/'safe-cuts.json'):
        return False
    if read(edit/'report.json')['frames'] != [[0, policy['total']]] or read(edit/'decisions.json') != [
            dict(start=0, end=policy['total']/policy['fps'])]:
        raise ValueError('UNSAFE_NATIVE_TIMELINE')
    meta = probe(source)
    av = {kind: next(s for s in meta['streams'] if s['codec_type'] == kind) for kind in ('audio', 'video')}
    if av['audio']['codec_name'] != 'aac' or any(abs(float(s['start_time'])) > .001 for s in av.values()) or abs(
            float(av['audio']['duration'])-float(av['video']['duration'])) > .001:
        return False

    def packets(path, kind):
        return json.loads(command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file', '-select_streams', kind+':0',
            '-show_packets', '-show_data_hash', 'sha256', '-show_entries',
            'packet=pts_time,dts_time,duration_time,data_hash,side_data_list', '-of', 'json', str(path)]).stdout)

    def pcm(path):
        # Exactly the pinned transcriber's mono16k signed16 extraction, without WAV headers.
        return command(['ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', str(path),
            '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
            '-f', 'hash', '-hash', 'sha256', '-']).stdout.strip()

    cut = edit/'cut.mp4'
    audio, video, source_pcm = packets(source, 'a'), packets(cut, 'v'), pcm(source)
    with tempfile.TemporaryDirectory(prefix='uncut-audio-', dir=edit) as folder:
        output = Path(folder)/'cut.mp4'
        command(['ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', str(cut), '-i', str(source),
            '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', str(output)])
        if packets(output, 'a') != audio or packets(output, 'v') != video or pcm(output) != source_pcm:
            raise ValueError('UNCUT_MEDIA_CHANGED')
        output.replace(cut)
    print('Uncut AAC packets, video packets and ASR PCM preserved', flush=True)
    return True


def audit(edit, policy):
    current = read(edit/'safe-cuts.json')
    if any(r not in policy['blocks'] for r in current):
        raise ValueError('UNSAFE_NATIVE_TIMELINE')
    chosen = [policy['blockFrames'][policy['blocks'].index(r)] for r in current]
    expected_spans, cursor = [], 0
    for a, b in chosen:
        if cursor < a:
            expected_spans.append(dict(start=cursor/policy['fps'], end=a/policy['fps']))
        cursor = max(cursor, b)
    if cursor < policy['total']:
        expected_spans.append(dict(start=cursor/policy['fps'], end=policy['total']/policy['fps']))
    if read(edit/'decisions.json') != expected_spans:
        raise ValueError('UNSAFE_NATIVE_TIMELINE')
    meta = probe(edit/'cut.mp4')
    expected = sum(s['end']-s['start'] for s in read(edit/'decisions.json'))
    streams = [s for s in meta['streams'] if s['codec_type'] in ('audio', 'video')]
    av = {s['codec_type']: s for s in streams}
    if set(av) != {'audio', 'video'} or len(streams) != 2:
        raise ValueError('INVALID_OUTPUT_SYNC')
    tolerance = max(1/policy['fps'], 1024/int(av['audio']['sample_rate']))+.005
    if any(abs(float(s['start_time'])) > .001 or abs(float(s['duration'])-expected) > tolerance for s in av.values()):
        raise ValueError('INVALID_OUTPUT_SYNC')


def main():
    action, root, source, directory, *rest = sys.argv[1:]
    source, edit = Path(source), Path(directory)
    sys.path.insert(0, str(Path(root)/'plugins/ai-editor/skills/cut/scripts'))
    import build_timeline as B
    if action == 'prepare':
        prepare(source, edit, json.loads(rest[0]), B)
        return
    policy = read(edit/'boundary-policy.json')
    if policy['version'] != 'quiet-block-v1' or policy['sourceSha256'] != source_hash(source):
        raise ValueError('SOURCE_CHANGED')
    if action == 'apply':
        save(edit/'safe-cuts.json', selected(policy, read(Path(rest[0])), read(edit/'safe-cuts.json')))
    elif action == 'build':
        build(source, edit, policy, read(edit/'safe-cuts.json'), B)
    elif action == 'audit':
        audit(edit, policy)
        if preserve_uncut_audio(source, edit, policy):
            audit(edit, policy)
    else:
        raise ValueError('UNSUPPORTED_ACTION')


if __name__ == '__main__':
    main()
