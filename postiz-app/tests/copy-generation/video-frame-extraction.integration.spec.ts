import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';

const execFileAsync = promisify(execFile);

describe('video frame extraction with FFmpeg', () => {
  it('extracts representative JPEG frames and normalizes scenes to sampled timestamps', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'postiz-frame-test-'));
    const videoPath = join(workingDirectory, 'sample.mp4');

    class IntegrationService extends CopyGenerationModelService {
      protected async requestVideoInsights() {
        return {
          visualSummary: 'A generated test pattern changes across the clip.',
          facts: ['A test pattern is visible.'],
          unknowns: [],
          coreMessage: 'Representative frames can ground a video source.',
          sourceConfidence: 0.8,
          scenes: [
            {
              timestampSeconds: 0.2,
              description: 'Opening test frame.',
              visibleText: '',
              usefulForPosting: true,
            },
            {
              timestampSeconds: 4.7,
              description: 'Closing test frame.',
              visibleText: '',
              usefulForPosting: true,
            },
          ],
        };
      }
    }

    try {
      await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x180:rate=10',
        '-t',
        '5',
        '-c:v',
        'mpeg4',
        '-pix_fmt',
        'yuv420p',
        '-y',
        videoPath,
      ]);

      const result = await new IntegrationService().analyzeVideoFrames({
        inputPath: videoPath,
        mimeType: 'video/mp4',
        originalName: 'sample.mp4',
      });

      expect(result.facts).toEqual(['A test pattern is visible.']);
      expect(result.scenes).toHaveLength(2);
      expect(result.scenes[0].timestampSeconds).toBeCloseTo(0.6, 2);
      expect(result.scenes[1].timestampSeconds).toBeCloseTo(4.4, 2);
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
});
