import { execFile } from 'child_process';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { FfmpegVideoEditorService } from '@gitroom/nestjs-libraries/media-editing/ffmpeg-video-editor.service';
import { buildVideoEditDecisionList, getKeptDurationMs } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
const execFileAsync = promisify(execFile);

describe('talking-head FFmpeg render integration', () => {
  jest.setTimeout(60_000);

  it('removes synthetic dead air, preserves A/V, and stores an MP4', async () => {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'postiz-video-edit-integration-')
    );
    const sourcePath = join(workingDirectory, 'source.mp4');
    let rendered:
      | Awaited<ReturnType<FfmpegVideoEditorService['render']>>
      | undefined;

    try {
      await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=25:duration=4',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:sample_rate=48000:duration=4',
        '-filter:a',
        "volume=0:enable='between(t,1,3)'",
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        '-y',
        sourcePath,
      ]);

      const sourceHash = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
      const editor = new FfmpegVideoEditorService();
      const decisionList = await editor.analyzeTalkingHeadVideo({
        inputPath: sourcePath,
        mediaId: 'synthetic-media',
        pacingPreset: 'tight',
      });
      const deadAir = decisionList.decisions.find(
        (decision) => decision.action === 'cut'
      );
      expect(deadAir).toEqual(
        expect.objectContaining({
          action: 'cut',
          reasons: ['silence', 'dead_air'],
        })
      );
      expect(
        (deadAir?.sourceEndMs || 0) - (deadAir?.sourceStartMs || 0)
      ).toBeGreaterThan(1_000);

      rendered = await editor.render(sourcePath, decisionList);
      expect(rendered.durationMs).toBeLessThan(3_200);
      expect(rendered.durationMs).toBeGreaterThan(1_800);
      expect(
        Math.abs(rendered.durationMs - getKeptDurationMs(decisionList))
      ).toBeLessThan(250);

      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,start_time:format=format_name', '-of', 'json', rendered.outputPath]);
      expect(JSON.parse(stdout).streams).toEqual(expect.arrayContaining([
        expect.objectContaining({ codec_name: 'h264', codec_type: 'video' }),
        expect.objectContaining({ codec_name: 'aac', codec_type: 'audio' }),
      ]));
      for (const stream of JSON.parse(stdout).streams) expect(Math.abs(Number(stream.start_time))).toBeLessThanOrEqual(0.001);
      expect(createHash('sha256').update(await readFile(sourcePath)).digest('hex')).toBe(sourceHash);
      const renderedPath = rendered.outputPath;
      await rendered.cleanup();
      await rendered.cleanup();
      await expect(stat(renderedPath)).rejects.toMatchObject({ code: 'ENOENT' });

    } finally {
      await rendered?.cleanup();
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
  it('streams disjoint video keeps in order with aligned audio timing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postiz-video-streaming-edit-'));
    const sourcePath = join(directory, 'ordered.mp4');
    let rendered: Awaited<ReturnType<FfmpegVideoEditorService['render']>> | undefined;
    try {
      await execFileAsync('ffmpeg', ['-v', 'error',
        '-f', 'lavfi', '-i', 'color=c=red:size=320x240:rate=25:duration=2',
        '-f', 'lavfi', '-i', 'color=c=green:size=320x240:rate=25:duration=3',
        '-f', 'lavfi', '-i', 'color=c=blue:size=320x240:rate=25:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=7',
        '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
        '-map', '[v]', '-map', '3:a:0', '-c:v', 'libx264', '-threads', '2',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourcePath]);
      const decisions = buildVideoEditDecisionList({ mediaId: 'ordered', durationMs: 7000,
        pacingPreset: 'balanced', detectedSilence: [] });
      decisions.decisions = [
        { id: 'k1', action: 'keep', sourceStartMs: 0, sourceEndMs: 1000, reasons: ['audible_content'] },
        { id: 'c1', action: 'cut', sourceStartMs: 1000, sourceEndMs: 2000, reasons: ['silence'] },
        { id: 'k2', action: 'keep', sourceStartMs: 2000, sourceEndMs: 3000, reasons: ['audible_content'] },
        { id: 'c2', action: 'cut', sourceStartMs: 3000, sourceEndMs: 5000, reasons: ['silence'] },
        { id: 'k3', action: 'keep', sourceStartMs: 5000, sourceEndMs: 6000, reasons: ['audible_content'] },
        { id: 'c3', action: 'cut', sourceStartMs: 6000, sourceEndMs: 7000, reasons: ['silence'] },
      ];
      rendered = await new FfmpegVideoEditorService().render(sourcePath, decisions);

      const sample = async (time: string) => {
        const { stdout } = await execFileAsync('ffmpeg', ['-v', 'error', '-i', rendered!.outputPath, '-ss', time,
          '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
        return [...Buffer.from(stdout as any).subarray(0, 3)];
      };
      const [red, green, blue] = await Promise.all(['0.5', '1.5', '2.5'].map(sample));
      expect(red[0]).toBeGreaterThan(red[1] + red[2]);
      expect(green[1]).toBeGreaterThan(green[0] + green[2]);
      expect(blue[2]).toBeGreaterThan(blue[0] + blue[1]);

      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries',
        'stream=codec_type,start_time,duration', '-of', 'json', rendered.outputPath]);
      const streams = JSON.parse(String(stdout)).streams;
      const video = streams.find((stream: any) => stream.codec_type === 'video');
      const audio = streams.find((stream: any) => stream.codec_type === 'audio');
      expect(Math.abs(Number(video.start_time))).toBeLessThanOrEqual(0.001);
      expect(Math.abs(Number(audio.start_time))).toBeLessThanOrEqual(0.001);
      expect(Math.abs(Number(video.duration) - Number(audio.duration))).toBeLessThan(0.1);
      expect(Math.abs(rendered.durationMs - 3000)).toBeLessThan(150);
    } finally {
      await rendered?.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects a real delayed-audio source in analysis and direct rendering without changing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postiz-video-offset-test-'));
    const sourcePath = join(directory, 'delayed.mp4');
    try {
      await execFileAsync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4', '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3.5', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath]);
      const before = await readFile(sourcePath);
      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', sourcePath]);
      const streams = JSON.parse(stdout).streams;
      expect(Number(streams.find((s: { codec_type: string }) => s.codec_type === 'audio').start_time)).toBeGreaterThan(0.45);
      expect(Number(streams.find((s: { codec_type: string }) => s.codec_type === 'video').start_time)).toBe(0);
      const editor = new FfmpegVideoEditorService();
      await expect(editor.analyzeTalkingHeadVideo({ inputPath: sourcePath, mediaId: 'delayed', pacingPreset: 'balanced' })).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
      const decisions = buildVideoEditDecisionList({ mediaId: 'delayed', durationMs: 4000, pacingPreset: 'balanced', detectedSilence: [] });
      await expect(editor.render(sourcePath, decisions)).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
      expect(await readFile(sourcePath)).toEqual(before);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
