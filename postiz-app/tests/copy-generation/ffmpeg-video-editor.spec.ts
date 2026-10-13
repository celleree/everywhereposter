import { mkdtemp, rm, writeFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { buildFfmpegRenderArgs, FfmpegVideoEditorService } from '../../libraries/nestjs-libraries/src/media-editing/ffmpeg-video-editor.service';
import { buildVideoEditDecisionList } from '../../libraries/nestjs-libraries/src/media-editing/video-edit-decision';

const probe = (duration = 4, width = 1280, fps = '30/1', audio = true) => JSON.stringify({ format: { duration }, streams: [{ codec_type: 'video', width, height: 720, avg_frame_rate: fps }, ...(audio ? [{ codec_type: 'audio' }] : [])] });
const list = () => buildVideoEditDecisionList({ mediaId: 'm', durationMs: 4000, pacingPreset: 'balanced', detectedSilence: [{ sourceStartMs: 1000, sourceEndMs: 3000 }] });
jest.mock('file-type', () => ({ fromFile: jest.fn(async () => ({ mime: 'video/mp4' })) }));
class StubEditor extends FfmpegVideoEditorService {
  calls: Array<{ command: string; args: string[]; options: any }> = [];
  responses: Array<string | Error> = [];
  outputPath?: string;
  protected async runMediaCommand(command: string, args: string[], options: any) {
    this.calls.push({ command, args, options });
    const response = this.responses.shift();
    if (command === 'ffmpeg' && args.includes('libx264')) { this.outputPath = args.at(-1); await writeFile(this.outputPath!, 'output'); }
    if (response instanceof Error) throw response;
    return { stdout: response || '', stderr: '' };
  }
}
describe('bounded FFmpeg editor', () => {
  let directory: string;
  let path: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'edit-test-')); path = join(directory, 'source.mp4'); await writeFile(path, 'source'); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('uses argument arrays, reset timestamps, local protocols and bounded threads', () => {
    const args = buildFfmpegRenderArgs('/source ;$(echo unsafe).mp4', '/output.mp4', list());
    expect(args[args.indexOf('-i') + 1]).toBe('/source ;$(echo unsafe).mp4');
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('concat=n=2:v=1:a=1');
    expect(args).toEqual(expect.arrayContaining(['-nostdin', '-protocol_whitelist', 'file', '-fs', '-n']));
  });
  it.each([[61, 1280, '30/1', true, 'SOURCE_TOO_LONG'], [4, 3840, '30/1', true, 'UNSUPPORTED_SOURCE'], [4, 1280, '120/1', true, 'UNSUPPORTED_SOURCE'], [4, 1280, '30/1', false, 'UNSUPPORTED_SOURCE']])('rejects duration/resolution/fps/audio limits (%s, %s, %s, %s)', async (duration, width, fps, audio, code) => {
    const editor = new StubEditor();
    editor.responses.push(probe(duration as number, width as number, fps as string, audio as boolean));
    await expect(editor.analyzeTalkingHeadVideo({ inputPath: path, mediaId: 'm', pacingPreset: 'balanced' })).rejects.toMatchObject({ code });
    expect(editor.calls).toHaveLength(1);
  });
  it('cleans partial output when FFmpeg fails', async () => {
    const editor = new StubEditor();
    editor.responses.push(probe(), new Error('timeout'));
    await expect(editor.render(path, list())).rejects.toMatchObject({ code: 'RENDER_FAILED' });
    await expect(stat(dirname(editor.outputPath!))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await stat(path)).toBeDefined();
  });
  it('cleans an invalid output instead of returning it', async () => {
    const editor = new StubEditor();
    editor.responses.push(probe(), '', probe(4));
    await expect(editor.render(path, list())).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    await expect(stat(dirname(editor.outputPath!))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a changed source before rendering', async () => {
    const editor = new StubEditor(); editor.responses.push(probe(5));
    await expect(editor.render(path, list())).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
    expect(editor.calls).toHaveLength(1);
  });
});
