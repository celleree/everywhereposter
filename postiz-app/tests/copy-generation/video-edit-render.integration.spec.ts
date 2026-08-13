import { execFile } from 'child_process';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { FfmpegVideoEditorService } from '@gitroom/nestjs-libraries/media-editing/ffmpeg-video-editor.service';
import { getKeptDurationMs } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
import { LocalStorage } from '@gitroom/nestjs-libraries/upload/local.storage';
import { CloudflareStorage } from '@gitroom/nestjs-libraries/upload/cloudflare.storage';
import {
  createTalkingHeadStylePlan,
  toTalkingHeadStyleMetadata,
} from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

const execFileAsync = promisify(execFile);

describe('talking-head FFmpeg render integration', () => {
  jest.setTimeout(60_000);

  it('removes synthetic dead air, preserves A/V, and stores an MP4', async () => {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'postiz-video-edit-integration-')
    );
    const sourcePath = join(workingDirectory, 'source.mp4');
    const uploadDirectory = join(workingDirectory, 'uploads');
    const previousFrontendUrl = process.env.FRONTEND_URL;
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

      const editor = new FfmpegVideoEditorService();
      const decisionList = await editor.analyzeTalkingHeadVideo({
        inputPath: sourcePath,
        mediaId: 'synthetic-media',
        style: toTalkingHeadStyleMetadata(
          createTalkingHeadStylePlan({
            stylePrompt: 'Make the pacing tight and punchy.',
            pacingPreset: 'tight',
            plannerSource: 'deterministic-fallback',
          })
        ),
        transcription: {
          id: 'synthetic-transcription',
          generation: 1,
          text: 'Tone before the pause and tone after the pause.',
        },
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

      process.env.FRONTEND_URL = 'http://localhost:4200';
      const storage = new LocalStorage(uploadDirectory);
      const uploaded = await storage.uploadFromPath(
        rendered.outputPath,
        'synthetic-edited.mp4'
      );
      const uploadedPath = join(
        uploadDirectory,
        new URL(uploaded.path).pathname.replace(/^\/uploads\//, '')
      );
      const uploadedFile = await stat(uploadedPath);

      expect(uploaded).toMatchObject({
        mimetype: 'video/mp4',
        originalname: 'synthetic-edited.mp4',
      });
      expect(uploadedFile.size).toBeGreaterThan(0);
      await storage.removeFile(uploaded.path);
      await expect(stat(uploadedPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });

      const cloudflare = new CloudflareStorage(
        'test-account',
        'test-access-key',
        'test-secret-key',
        'auto',
        'test-bucket',
        'https://media.example.com'
      );
      const send = jest.fn().mockImplementation(async (command) => {
        command.input?.Body?.destroy?.();
        return {};
      });
      (cloudflare as any)._client = { send };
      const cloudflareUpload = await cloudflare.uploadFromPath(
        rendered.outputPath,
        'synthetic-edited.mp4'
      );
      await cloudflare.removeFile(cloudflareUpload.path);

      expect(cloudflareUpload).toMatchObject({
        path: expect.stringMatching(
          /^https:\/\/media\.example\.com\/[a-zA-Z0-9]+\.mp4$/
        ),
        mimetype: 'video/mp4',
        originalname: 'synthetic-edited.mp4',
      });
      expect(send.mock.calls[0][0].constructor.name).toBe('PutObjectCommand');
      expect(send.mock.calls[1][0].constructor.name).toBe(
        'DeleteObjectCommand'
      );
      expect(send.mock.calls[1][0].input).toMatchObject({
        Bucket: 'test-bucket',
        Key: cloudflareUpload.filename,
      });
    } finally {
      if (previousFrontendUrl === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = previousFrontendUrl;
      }
      await rendered?.cleanup();
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
});
