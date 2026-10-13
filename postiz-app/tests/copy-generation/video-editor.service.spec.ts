import { VideoEditorService } from '../../libraries/nestjs-libraries/src/media-editing/video-editor.service';
import { prepareEditorSource } from '../../libraries/nestjs-libraries/src/media-editing/video-editor-source';
import { UploadFactory } from '../../libraries/nestjs-libraries/src/upload/upload.factory';
import { MediaRepository } from '../../libraries/nestjs-libraries/src/database/prisma/media/media.repository';
import { MediaTranscriptionRepository } from '../../libraries/nestjs-libraries/src/database/prisma/media-transcription/media-transcription.repository';
import { VideoEditingError } from '../../libraries/nestjs-libraries/src/media-editing/ffmpeg-video-editor.service';

jest.mock('../../libraries/nestjs-libraries/src/media-editing/video-editor-source', () => ({ prepareEditorSource: jest.fn() }));
jest.mock('../../libraries/nestjs-libraries/src/upload/upload.factory', () => ({ UploadFactory: { createStorage: jest.fn() } }));
function fixture() {
  const prepared = { inputPath: '/source.mp4', cleanup: jest.fn().mockResolvedValue(undefined) };
  const rendered = { outputPath: '/render.mp4', durationMs: 2000, cleanup: jest.fn().mockResolvedValue(undefined) };
  const receipt = { filename: 'new.mp4', path: 'https://uploads/new.mp4', originalname: 'source-edited.mp4', mimetype: 'video/mp4', rollback: jest.fn().mockResolvedValue(undefined) };
  const storage = { uploadFromPath: jest.fn().mockResolvedValue(receipt) };
  (UploadFactory.createStorage as jest.Mock).mockReturnValue(storage);
  (prepareEditorSource as jest.Mock).mockResolvedValue(prepared);
  const media = { getMediaByOrganizationIdAndId: jest.fn().mockResolvedValue({ id: 'source', type: 'video', path: '/source.mp4', name: 'source.mp4' }), saveFile: jest.fn().mockResolvedValue({ id: 'output', type: 'video' }) };
  const transcripts = { getCurrentForActiveMedia: jest.fn().mockResolvedValue({ id: 'transcript', generation: 2, status: 'READY', text: 'Not used for timing' }) };
  const editor = { analyzeTalkingHeadVideo: jest.fn().mockResolvedValue({ schemaVersion: 1 }), render: jest.fn().mockResolvedValue(rendered) };
  return { service: new VideoEditorService(media as any, transcripts as any, editor as any), media, transcripts, editor, storage, prepared, rendered, receipt };
}
describe('organization-scoped video editor', () => {
  it('returns a separate output, reads scoped transcript provenance and does not delete the successful upload', async () => {
    const f = fixture();
    expect(await f.service.create('org', 'source', { schemaVersion: 1 })).toMatchObject({ schemaVersion: 1, outputMedia: { id: 'output' }, render: { status: 'completed', durationMs: 2000 } });
    expect(f.media.getMediaByOrganizationIdAndId).toHaveBeenCalledWith('org', 'source');
    expect(f.transcripts.getCurrentForActiveMedia).toHaveBeenCalledWith('org', 'source');
    expect(f.editor.analyzeTalkingHeadVideo).toHaveBeenCalledWith(expect.objectContaining({ pacingPreset: 'balanced', transcription: { id: 'transcript', generation: 2, alignment: 'none' } }));
    expect(f.media.saveFile).toHaveBeenCalledWith('org', 'new.mp4', 'https://uploads/new.mp4', 'source-edited.mp4', 'video/mp4');
    expect(f.receipt.rollback).not.toHaveBeenCalled();
    expect(f.prepared.cleanup).toHaveBeenCalledTimes(1); expect(f.rendered.cleanup).toHaveBeenCalledTimes(1);
  });
  it('refuses foreign/deleted media before preparation, transcript lookup or rendering', async () => {
    const f = fixture(); f.media.getMediaByOrganizationIdAndId.mockResolvedValue(null);
    await expect(f.service.create('foreign', 'source', { schemaVersion: 1 })).rejects.toMatchObject({ status: 404 });
    expect(f.transcripts.getCurrentForActiveMedia).not.toHaveBeenCalled(); expect(f.editor.render).not.toHaveBeenCalled();
  });
  it('does not require or trigger transcription for acoustic editing', async () => {
    const f = fixture(); f.transcripts.getCurrentForActiveMedia.mockResolvedValue(null);
    await f.service.create('org', 'source', { schemaVersion: 1, pacingPreset: 'tight' });
    expect(f.editor.analyzeTalkingHeadVideo).toHaveBeenCalledWith(expect.objectContaining({ transcription: null, pacingPreset: 'tight' }));
  });
  it('rolls back only the generated upload after database failure and releases admission', async () => {
    const f = fixture(); f.media.saveFile.mockRejectedValueOnce(new Error('db failure'));
    await expect(f.service.create('org', 'source', { schemaVersion: 1 })).rejects.toMatchObject({ status: 500 });
    expect(f.receipt.rollback).toHaveBeenCalledTimes(1);
    await expect(f.service.create('org', 'source', { schemaVersion: 1 })).resolves.toBeDefined();
  });
  it('does not upload when a source is removed during rendering', async () => {
    const f = fixture(); f.media.getMediaByOrganizationIdAndId.mockResolvedValueOnce({ type: 'video', path: '/source.mp4', name: 'source.mp4' }).mockResolvedValueOnce(null);
    await expect(f.service.create('org', 'source', { schemaVersion: 1 })).rejects.toMatchObject({ status: 404 });
    expect(f.storage.uploadFromPath).not.toHaveBeenCalled(); expect(f.rendered.cleanup).toHaveBeenCalledTimes(1);
  });
  it('rejects concurrent work and releases admission after render failure', async () => {
    const f = fixture(); let reject!: (error: Error) => void;
    f.editor.render.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const first = f.service.create('org', 'source', { schemaVersion: 1 });
    while (!reject) await new Promise((resolve) => setImmediate(resolve));
    await expect(f.service.create('org', 'source', { schemaVersion: 1 })).rejects.toMatchObject({ status: 429 });
    reject(new VideoEditingError('RENDER_FAILED', 'render failed'));
    await expect(first).rejects.toMatchObject({ status: 422, response: expect.objectContaining({ code: 'RENDER_FAILED' }) });
    await expect(f.service.create('org', 'source', { schemaVersion: 1 })).resolves.toBeDefined();
  });
  it.each([{ schemaVersion: 2 }, { schemaVersion: 1, pacingPreset: 'unsafe' }, { schemaVersion: 1, tracks: {} }, { schemaVersion: 1, organizationId: 'other' }])('rejects malformed/unsupported request %j before I/O', async (body) => {
    const f = fixture(); await expect(f.service.create('org', 'source', body as any)).rejects.toMatchObject({ status: 400 });
    expect(f.media.getMediaByOrganizationIdAndId).not.toHaveBeenCalled();
  });
  it('uses active organization filters in both repository queries', async () => {
    const findFirst = jest.fn();
    await new MediaRepository({ model: { media: { findFirst } } } as any, {} as any).getMediaByOrganizationIdAndId('org', 'source');
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'source', organizationId: 'org', deletedAt: null } });
    findFirst.mockClear();
    await new MediaTranscriptionRepository({ mediaTranscription: { findFirst } } as any).getCurrentForActiveMedia('org', 'source');
    expect(findFirst).toHaveBeenCalledWith({ where: { mediaId: 'source', media: { organizationId: 'org', deletedAt: null } } });
  });
});
