import { OpenaiService, generateFlareImage } from '@gitroom/nestjs-libraries/openai/openai.service';
import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';

jest.mock('openai', () => {
  const generate = jest.fn();
  const parse = jest.fn();
  const create = jest.fn();
  return { __esModule: true, default: jest.fn().mockImplementation(() => ({
    images: { generate }, chat: { completions: { parse, create } },
  })), generate, parse, create };
});
const mocks = () => jest.requireMock('openai') as { generate: jest.Mock; parse: jest.Mock; create: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it.each([
  [false, false, false, '1024x1024'],
  [true, true, false, '1024x1536'],
  [true, false, true, '1536x1024'],
])('generates Flare PNGs with supported size and storage-compatible output', async (url, vertical, horizontal, size) => {
  const base64 = Buffer.from('fixture-png').toString('base64');
  mocks().generate.mockResolvedValue({ data: [{ b64_json: base64 }] });
  const result = await new OpenaiService().generateImage('fixture prompt', url as boolean, vertical as boolean, horizontal as boolean);
  expect(mocks().generate).toHaveBeenCalledWith({ model: 'gpt-image-2.5-flare', prompt: 'fixture prompt', size, output_format: 'png', n: 1 });
  expect(result).toBe(url ? `data:image/png;base64,${base64}` : base64);
  if (url) expect(Buffer.from(await (await fetch(result)).arrayBuffer()).toString()).toBe('fixture-png');
});

it('fails without image data and never switches away from Flare', async () => {
  mocks().generate.mockResolvedValue({ data: [] });
  await expect(generateFlareImage('fixture prompt')).rejects.toThrow('Flare returned no image data');
  expect(mocks().generate).toHaveBeenCalledTimes(1);
  mocks().generate.mockRejectedValue(new Error('provider unavailable'));
  await expect(generateFlareImage('fixture prompt')).rejects.toThrow('provider unavailable');
  expect(mocks().generate).toHaveBeenCalledTimes(2);
});

it('uses Luna for extraction and Sol for drafting without unsupported sampling parameters', async () => {
  mocks().parse.mockResolvedValue({ choices: [{ message: { parsed: { draft: 'fixture', visualSummary: 'fixture' } } }] });
  const service = new CopyGenerationModelService();
  await service.analyzeImage({ buffer: Buffer.from('fixture'), mimeType: 'image/png' });
  expect(mocks().parse.mock.calls[0][0]).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none' });
  await service.generatePlatformDraft({ platform: { name: 'LinkedIn' } } as any, 'fixture', 'fixture');
  const request = mocks().parse.mock.calls[1][0];
  expect(request).toMatchObject({ model: 'gpt-6.1-sol', reasoning_effort: 'medium' });
  expect(request.temperature).toBeUndefined();
  expect(request.tools).toBeUndefined();
});

it('preserves ten post alternatives using compatible single-choice Sol requests', async () => {
  mocks().create.mockResolvedValue({ choices: [{ message: { content: '[{"post":"fixture"}]' } }] });
  const results = await new OpenaiService().generatePosts('fixture');
  expect(results).toHaveLength(10);
  expect(mocks().create).toHaveBeenCalledTimes(10);
  for (const [body] of mocks().create.mock.calls) {
    expect(body).toMatchObject({ model: 'gpt-6.1-sol', reasoning_effort: 'medium' });
    expect(body.n).toBeUndefined(); expect(body.temperature).toBeUndefined();
  }
});
