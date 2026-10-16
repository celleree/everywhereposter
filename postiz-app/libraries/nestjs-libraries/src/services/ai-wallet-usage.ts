/** Server-side usage accounting only. No prices, grants or provider calls. */
export type MeasuredUsage = {
  provider: string; model: string; providerRequestId: string; units: Record<string, bigint>;
};
export type UsageRates = { units: Record<string, bigint>; per: bigint };
const count = (value: unknown): bigint => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('Missing or invalid provider usage.');
  return BigInt(value);
};

/** A final response with provider identity is required; stream deltas are not receipts.
 * Cached input is a subset of input; reasoning tokens are already part of output.
 * Images, audio and tool charges require their own meter and are not priced here. */
export function normalizeOpenAiTokens(kind: 'chat' | 'responses', raw: unknown): MeasuredUsage {
  const r = raw as any;
  const id = r?.id;
  if (!['chat', 'responses'].includes(kind) || !r || typeof id !== 'string' || !id.trim() || id.length > 200 ||
      typeof r.model !== 'string' || !r.model.trim() || r.model.length > 200 || !r.usage ||
      (kind === 'responses' && r.status !== 'completed') ||
      (kind === 'chat' && (!Array.isArray(r.choices) || r.choices.length !== 1 ||
        !['stop', 'length', 'tool_calls', 'content_filter'].includes(r.choices[0]?.finish_reason)))) {
    throw Error('A final identified provider receipt is required.');
  }
  const u = r.usage;
  const input = count(kind === 'responses' ? u.input_tokens : u.prompt_tokens);
  const output = count(kind === 'responses' ? u.output_tokens : u.completion_tokens);
  const cached = count(
    (kind === 'responses' ? u.input_tokens_details?.cached_tokens : u.prompt_tokens_details?.cached_tokens));
  if ((u.prompt_tokens_details?.audio_tokens || u.completion_tokens_details?.audio_tokens) ||
      (kind === 'chat' && r.choices[0]?.message?.audio != null) ||
      (kind === 'responses' && (!Array.isArray(r.output) || r.output.some((item: any) =>
        !['message', 'reasoning'].includes(item.type) || (item.type === 'message' &&
          (!Array.isArray(item.content) || item.content.some((part: any) => !['output_text', 'refusal'].includes(part.type)))))))) {
    throw Error('Provider usage requires an additional meter.');
  }
  if (cached > input || count(u.total_tokens) !== input + output) throw Error('Inconsistent provider token usage.');
  return { provider: 'openai', model: r.model, providerRequestId: id,
    units: { inputUncached: input - cached, inputCached: cached, output } };
}

/** Media endpoints do not echo a model/id: callers must retain the trusted request
 * model and SDK transport request id. Never derive billed units from text length,
 * configured image count, duration estimates or successful output alone. */
export function normalizeOpenAiMedia(kind: 'transcription' | 'image', raw: unknown,
  model: string, providerRequestId: string): MeasuredUsage {
  if (!model?.trim() || model.length > 200 || !providerRequestId?.trim() || providerRequestId.length > 200) {
    throw Error('An identified media receipt is required.');
  }
  const u = (raw as any)?.usage;
  if (!u || !['transcription', 'image'].includes(kind) ||
      (kind === 'transcription' && u.type !== 'tokens')) throw Error('Missing token-based media usage.');
  const input = count(u.input_tokens), output = count(u.output_tokens);
  const d = kind === 'transcription' ? u.input_token_details : u.input_tokens_details;
  if (d?.cached_tokens !== undefined && count(d.cached_tokens) !== BigInt(0)) throw Error('Cached media requires its own meter.');
  const inputText = count(d?.text_tokens);
  const inputMedia = count(kind === 'transcription' ? d?.audio_tokens : d?.image_tokens);
  if (inputText + inputMedia !== input || count(u.total_tokens) !== input + output) throw Error('Inconsistent media usage.');
  const units = kind === 'transcription' ? { inputText, inputAudio: inputMedia, outputText: output } : {
    inputText, inputImage: inputMedia, outputText: count(u.output_tokens_details?.text_tokens),
    outputImage: count(u.output_tokens_details?.image_tokens),
  };
  if (kind === 'image' && units.outputText + units.outputImage !== output) throw Error('Inconsistent image output usage.');
  return { provider: 'openai', model, providerRequestId, units };
}

/** Explicit server-supplied integer tariff; deliberately no default rates.
 * Round once after summing categories, never through floating-point dollars. */
export function priceUsage(usage: MeasuredUsage, rates: UsageRates): bigint {
  const keys = Object.keys(usage.units);
  if (!keys.length || typeof rates?.per !== 'bigint' || rates.per <= BigInt(0) ||
      keys.some((key) => typeof usage.units[key] !== 'bigint' || usage.units[key] < BigInt(0) ||
        typeof rates.units?.[key] !== 'bigint' || rates.units[key] < BigInt(0))) throw Error('Invalid explicit usage tariff.');
  const numerator = keys.reduce((sum, key) => sum + usage.units[key] * rates.units[key], BigInt(0));
  return (numerator + rates.per - BigInt(1)) / rates.per;
}
