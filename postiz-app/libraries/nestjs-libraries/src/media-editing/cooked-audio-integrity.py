"""Prove retained AAC against an immutable source and a caller-owned frame plan.

This proves waveform/packet provenance and presentation clocks, not transcript or
semantic edit quality. Unknown transformations fail closed. No model is loaded.
"""
import hashlib
import json
import math
from pathlib import Path
from fractions import Fraction
import subprocess
import sys
import tempfile


VERSION = 'source-plan-audio-v1'
MAX_BYTES = 100 * 1024 * 1024


def regular(path):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError('UNSUPPORTED_MEDIA_FILE')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def command(args):
    result = subprocess.run(args, capture_output=True, check=True, timeout=60)
    if len(result.stdout) + len(result.stderr) > 8 * 1024 * 1024:
        raise ValueError('ANALYSIS_LIMIT')
    return result.stdout


def probe(path, selector=None, packets=False):
    args = ['ffprobe', '-v', 'error', '-protocol_whitelist', 'file']
    if selector:
        args += ['-select_streams', selector]
    if packets:
        args += ['-show_packets', '-show_data_hash', 'sha256', '-show_entries',
                 'packet=pts,dts,duration,data_hash,side_data_list']
    else:
        args += ['-count_frames', '-show_data_hash', 'sha256', '-show_entries',
                 'stream=codec_type,codec_name,profile,pix_fmt,width,height,sample_rate,channels,channel_layout,time_base,extradata_hash,start_time,duration,r_frame_rate,nb_read_frames']
    return json.loads(command(args + ['-of', 'json', str(path)]))


def streams(meta):
    values = meta['streams']
    if len(values) != 2 or sorted(s['codec_type'] for s in values) != ['audio', 'video']:
        raise ValueError('UNSUPPORTED_STREAMS')
    return {s['codec_type']: s for s in values}


def finite(value):
    n = float(value)
    if not math.isfinite(n):
        raise ValueError('INVALID_CLOCK')
    return n


def video_clock(path, video, fps, count, native_frames=None):
    packets = probe(path, 'v:0', True)['packets']
    pts = sorted(int(p['pts']) for p in packets)
    scale = Fraction(video['time_base'])
    # Native renders separate MP4 spans, whose movie durations round UP to
    # milliseconds before concat. Derive those exact join offsets from the
    # trusted frame plan; a blanket timestamp tolerance would hide real drift.
    expected, offset = [], Fraction(0)
    for a, b in native_frames or [[0, count]]:
        expected.extend(round((offset + Fraction(i) / Fraction(str(fps))) / scale) for i in range(b-a))
        duration = Fraction(b-a) / Fraction(str(fps))
        offset += Fraction(math.ceil(duration * 1000), 1000) if native_frames else duration
    if len(pts) != count or int(video['nb_read_frames']) != count or pts != expected:
        raise ValueError('VIDEO_CLOCK_MISMATCH')
    end = float(expected[-1] * scale) + 1 / fps
    if abs(end - count / fps) > .001 or abs(finite(video['start_time'])) > .000001 or abs(finite(video['duration']) - end) > .000001:
        raise ValueError('VIDEO_CLOCK_MISMATCH')


def trusted_frames(plan, fps, total):
    ranges = plan['removedBlocks']
    if not isinstance(ranges, list) or len(ranges) > 100:
        raise ValueError('UNSUPPORTED_PLAN')
    chosen = []
    for pair in ranges:
        if not isinstance(pair, list) or len(pair) != 2 or any(
                type(n) not in (int, float) or not math.isfinite(n) for n in pair):
            raise ValueError('UNSUPPORTED_PLAN')
        a, b = [round(n * fps) for n in pair]
        if not 0 <= a < b <= total or any(abs(n - f / fps) > 1e-7 for n, f in zip(pair, [a, b])):
            raise ValueError('UNSUPPORTED_PLAN')
        chosen.append([a, b])
    if chosen != sorted(chosen) or any(a[1] > b[0] for a, b in zip(chosen, chosen[1:])):
        raise ValueError('UNSUPPORTED_PLAN')
    frames, cursor = [], 0
    for a, b in chosen:
        if cursor < a:
            frames.append([cursor, a])
        cursor = b
    if cursor < total:
        frames.append([cursor, total])
    if not frames:
        raise ValueError('EMPTY_PLAN')
    return frames


def read(edit, name):
    path = edit / name
    if path.is_symlink() or path.stat().st_size > 64 * 1024:
        raise ValueError('UNSUPPORTED_MANIFEST')
    return json.loads(path.read_text())


def pcm(path):
    data = command(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '2',
                    '-protocol_whitelist', 'file', '-i', str(path), '-map', '0:a:0',
                    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', '-'])
    # FFmpeg can flush decoder/resampler padding after the declared endpoint.
    # Compare all of it, without truncation, against the same source-plan decode.
    if not data or len(data) > 241 * 16000 * 2:
        raise ValueError('UNSUPPORTED_PCM')
    return len(data), hashlib.sha256(data).hexdigest()


def audio_identity(path, audio):
    keys = ['codec_name', 'profile', 'sample_rate', 'channels', 'channel_layout',
            'time_base', 'extradata_hash', 'start_time', 'duration']
    if audio['codec_name'] != 'aac' or not audio.get('extradata_hash'):
        raise ValueError('UNSUPPORTED_AUDIO')
    packets = probe(path, 'a:0', True)['packets']
    if not packets or len(packets) > 50000 or any(not all(k in p for k in ('pts', 'dts', 'duration', 'data_hash')) for p in packets):
        raise ValueError('INCOMPLETE_AUDIO_PROOF')
    return {k: audio[k] for k in keys}, packets


def verify(source, edit, raw_plan):
    receipt = edit / 'audio-integrity.json'
    # A stale or forged disk receipt is never evidence of a completed invocation.
    receipt.unlink(missing_ok=True)
    plan = json.loads(raw_plan)
    if not isinstance(plan, dict) or set(plan) != {'version', 'sourceSha256', 'removedBlocks'} or plan['version'] != VERSION:
        raise ValueError('UNSUPPORTED_PLAN')
    expected_hash = plan['sourceSha256']
    if not isinstance(expected_hash, str) or len(expected_hash) != 64 or any(c not in '0123456789abcdef' for c in expected_hash):
        raise ValueError('UNSUPPORTED_PLAN')
    cut = edit / 'cut.mp4'
    regular(source)
    regular(cut)
    source_hash, output_hash = digest(source), digest(cut)
    if source_hash != expected_hash:
        raise ValueError('SOURCE_CHANGED')
    original, rendered = streams(probe(source)), streams(probe(cut))
    video, audio = original['video'], original['audio']
    fps = float(Fraction(video['r_frame_rate']))
    total = int(video['nb_read_frames'])
    if not 0 < fps <= 30 or not 0 < total <= 7200 or total / fps > 240 or not 0 < min(video['width'], video['height']) <= 720 or max(video['width'], video['height']) > 1280:
        raise ValueError('UNSUPPORTED_SOURCE')
    if any(abs(finite(s['start_time'])) > .000001 for s in original.values()) or abs(
            finite(audio['duration']) - total / fps) > .001:
        raise ValueError('UNSUPPORTED_SOURCE_SYNC')
    video_clock(source, video, fps, total)
    frames = trusted_frames(plan, fps, total)
    spans = [dict(start=a / fps, end=b / fps) for a, b in frames]
    if read(edit, 'safe-cuts.json') != plan['removedBlocks'] or read(edit, 'decisions.json') != spans or read(edit, 'report.json')['frames'] != frames:
        raise ValueError('UNTRUSTED_TIMELINE')
    output_video = rendered['video']
    count = sum(b - a for a, b in frames)
    if output_video['codec_name'] != 'h264' or output_video['pix_fmt'] != 'yuv420p' or any(
            output_video[k] != video[k] for k in ('width', 'height')) or float(Fraction(output_video['r_frame_rate'])) != fps:
        raise ValueError('UNSUPPORTED_VIDEO_TRANSFORM')
    video_clock(cut, output_video, fps, count, frames)
    with tempfile.TemporaryDirectory(prefix='audio-proof-', dir=edit) as folder:
        expected = source
        if plan['removedBlocks'] or audio['codec_name'] != 'aac':
            parts = []
            for i, (a, b) in enumerate(frames):
                start, end = a / fps, b / fps
                parts.append(f'[0:a:0]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,'
                             f'afade=t=in:d=0.008,afade=t=out:st={max(0.0, end-start-.008):.6f}:d=0.008[a{i}]')
            filters = ';'.join(parts) + ';' + ''.join(f'[a{i}]' for i in range(len(frames))) + f'concat=n={len(frames)}:v=0:a=1[ac]'
            expected = Path(folder) / 'expected.m4a'
            command(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '2', '-protocol_whitelist', 'file',
                     '-vn', '-i', str(source), '-filter_complex', filters, '-map', '[ac]',
                     '-c:a', 'aac', '-b:a', '192k', str(expected)])
        expected_audio = next(s for s in probe(expected)['streams'] if s['codec_type'] == 'audio')
        expected_identity = audio_identity(expected, expected_audio)
        actual_identity = audio_identity(cut, rendered['audio'])
        if expected_identity != actual_identity or pcm(expected) != pcm(cut):
            raise ValueError('RETAINED_AUDIO_MISMATCH')
    if digest(source) != source_hash or digest(cut) != output_hash:
        raise ValueError('MEDIA_CHANGED_DURING_PROOF')
    proof = dict(version=VERSION, sourceSha256=source_hash, outputSha256=output_hash,
                 planSha256=hashlib.sha256(raw_plan.encode()).hexdigest(),
                 audioPackets=len(actual_identity[1]), frameCount=count)
    receipt.write_text(json.dumps(proof, separators=(',', ':')))
    print('Complete source-plan audio integrity verified', flush=True)


def diagnose(source, edit, raw_plan, upstream):
    # Explicit offline diagnostic only: never load a second ASR model during
    # normal runtime acceptance. Incomplete physical proof cannot reach ASR.
    verify(source, edit, raw_plan)
    proof = read(edit, 'audio-integrity.json')
    transcript = edit / 'cut.transcript.json'
    transcript.unlink(missing_ok=True)
    script = upstream / 'plugins/ai-editor/skills/cut/scripts/verify_cut.py'
    regular(script)
    try:
        result = subprocess.run([sys.executable, str(script), str(edit), '--engine', 'whisper'],
                                capture_output=True, timeout=180)
        if len(result.stdout) + len(result.stderr) > 8 * 1024 * 1024:
            raise ValueError('DIAGNOSTIC_LIMIT')
        diagnostic = dict(status='clean' if result.returncode == 0 else 'differences-or-unavailable',
                          exitCode=result.returncode, report=(result.stdout + result.stderr).decode(errors='replace'))
    except subprocess.TimeoutExpired:
        diagnostic = dict(status='unavailable', reason='timeout')
    if digest(source) != proof['sourceSha256'] or digest(edit / 'cut.mp4') != proof['outputSha256']:
        raise ValueError('MEDIA_CHANGED_DURING_DIAGNOSTIC')
    diagnostic.update(authoritative=False, audioIntegrity=proof)
    (edit / 'asr-diagnostic.json').write_text(json.dumps(diagnostic))
    print('ASR diagnostic recorded separately from complete audio proof', flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == 'verify':
        verify(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4])
    elif len(sys.argv) == 6 and sys.argv[1] == 'diagnose':
        diagnose(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], Path(sys.argv[5]))
    else:
        raise ValueError('UNSUPPORTED_ACTION')
