import { execFile } from 'child_process';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { FfmpegVideoEditorService } from '@gitroom/nestjs-libraries/media-editing/ffmpeg-video-editor.service';
import { getKeptDurationMs } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
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

      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type:format=format_name', '-of', 'json', rendered.outputPath]);
      expect(JSON.parse(stdout).streams).toEqual(expect.arrayContaining([
        expect.objectContaining({ codec_name: 'h264', codec_type: 'video' }),
        expect.objectContaining({ codec_name: 'aac', codec_type: 'audio' }),
      ]));
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
});
