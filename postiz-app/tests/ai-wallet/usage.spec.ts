import { normalizeOpenAiTokens, normalizeOpenAiMedia, priceUsage } from '@gitroom/nestjs-libraries/services/ai-wallet-usage';

// Synthetic API-shaped receipts; no provider or account data.
const chat = () => ({ id: 'chat_synthetic', model: 'fixture-model', choices: [{ finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
    prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 10 } } });
const rates = { units: { inputUncached: 2n, inputCached: 1n, output: 5n }, per: 1n };
it('partitions cached input and includes reasoning in output exactly once', () => {
  const u = normalizeOpenAiTokens('chat', chat());
  expect(u.units).toEqual({ inputUncached: 60n, inputCached: 40n, output: 20n });
  expect(priceUsage(u, rates)).toBe(260n);
});
it('normalizes completed Responses usage without retaining content', () => {
  const u = normalizeOpenAiTokens('responses', { id: 'resp_synthetic', model: 'fixture-model', status: 'completed',
    output: [{ type: 'reasoning' }, { type: 'message' }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 } } });
  expect(priceUsage(u, rates)).toBe(260n);
  expect(Object.keys(u).sort()).toEqual(['model', 'provider', 'providerRequestId', 'units']);
});
it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100'])('rejects missing/invalid counts %p', (value) => {
  const r = chat(); r.usage.prompt_tokens = value as any;
  expect(() => normalizeOpenAiTokens('chat', r)).toThrow();
});
it('rejects missing cache detail, inconsistent totals, nonfinal streams and unsupported meters', () => {
  for (const update of [{ usage: {} }, { id: '' }, { choices: [] },
    { usage: { ...chat().usage, total_tokens: 999 } },
    { usage: { ...chat().usage, prompt_tokens_details: { cached_tokens: 101 } } },
    { usage: { ...chat().usage, prompt_tokens_details: undefined } },
    { usage: { ...chat().usage, prompt_tokens_details: { cached_tokens: 0, audio_tokens: 1 } } }]) {
    expect(() => normalizeOpenAiTokens('chat', { ...chat(), ...update })).toThrow();
  }
  expect(() => normalizeOpenAiTokens('responses', { ...chat(), status: 'incomplete' })).toThrow();
});
it('rounds only the combined integer amount and rejects an absent/invalid tariff', () => {
  const u = normalizeOpenAiTokens('chat', chat());
  expect(priceUsage(u, { ...rates, per: 100n })).toBe(3n);
  for (const per of [0n, -1n, 1 as any]) expect(() => priceUsage(u, { ...rates, per })).toThrow();
  expect(() => priceUsage(u, { ...rates, units: { ...rates.units, output: undefined as any } })).toThrow();
});

it('separates transcription audio/text tokens; missing detail and duration estimates stay unknown', () => {
  const usage = { type: 'tokens', input_tokens: 100, output_tokens: 5, total_tokens: 105,
    input_token_details: { audio_tokens: 90, text_tokens: 10 } };
  const u = normalizeOpenAiMedia('transcription', { usage }, 'fixture-transcriber', 'req_synthetic');
  expect(u.units).toEqual({ inputText: 10n, inputAudio: 90n, outputText: 5n });
  expect(() => priceUsage(u, rates)).toThrow('tariff');
  for (const value of [{ type: 'duration', seconds: 60 }, { ...usage, input_token_details: undefined }]) {
    expect(() => normalizeOpenAiMedia('transcription', { usage: value }, 'model', 'req_synthetic')).toThrow();
  }
});
it('separates image/text usage and refuses guessed per-image or auto-quality charges', () => {
  const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120,
    input_tokens_details: { text_tokens: 10, image_tokens: 90 },
    output_tokens_details: { text_tokens: 0, image_tokens: 20 } };
  expect(normalizeOpenAiMedia('image', { usage }, 'fixture-image', 'req_synthetic').units)
    .toEqual({ inputText: 10n, inputImage: 90n, outputText: 0n, outputImage: 20n });
  expect(() => normalizeOpenAiMedia('image', { data: [{ b64_json: 'synthetic' }] }, 'model', 'req_synthetic')).toThrow();
  expect(() => normalizeOpenAiMedia('image', { usage: { ...usage, output_tokens_details: undefined } }, 'model', 'req_synthetic')).toThrow();
});
