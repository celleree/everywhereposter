import { validateVideoProbe, VIDEO_CHUNK_BYTES, VIDEO_MAX_BYTES } from '../../libraries/nestjs-libraries/src/upload/resumable-video.validation';
import { validate } from 'class-validator';
import { CreateVideoUploadDto } from '../../libraries/nestjs-libraries/src/dtos/media/create.video.upload.dto';

const probe = (duration: any, codec = 'h264') => ({ format: { duration, format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }, streams: [{ codec_type: 'video', codec_name: codec }] });
it.each([0.01, 599.999, 600])('accepts duration %s', value => expect(validateVideoProbe(probe(value))).toBe(value));
it.each([0, -1, 600.001, 601, undefined, 'NaN', 'Infinity'])('rejects invalid duration %s', value => expect(() => validateVideoProbe(probe(value))).toThrow());
it('accepts HEVC in MP4/MOV but rejects raw elementary streams and audio-only containers', () => {
  expect(validateVideoProbe(probe(600, 'hevc'))).toBe(600);
  expect(() => validateVideoProbe({ ...probe(1), format: { duration: 1, format_name: 'hevc' } })).toThrow();
  expect(() => validateVideoProbe({ ...probe(1), streams: [{ codec_type: 'audio' }] })).toThrow();
});
it('enforces a separate byte ceiling and digest syntax in the server DTO', async () => {
  const dto = Object.assign(new CreateVideoUploadDto(), { organizationId: 'org', clientId: 'a'.repeat(16), originalName: 'video.MOV', byteSize: VIDEO_MAX_BYTES, manifest: Array(Math.ceil(VIDEO_MAX_BYTES / VIDEO_CHUNK_BYTES)).fill('a'.repeat(64)) });
  expect(await validate(dto)).toEqual([]);
  dto.byteSize++; expect((await validate(dto)).some(error => error.property === 'byteSize')).toBe(true);
  dto.byteSize--; dto.manifest[0] = 'bogus'; expect((await validate(dto)).some(error => error.property === 'manifest')).toBe(true);
});
