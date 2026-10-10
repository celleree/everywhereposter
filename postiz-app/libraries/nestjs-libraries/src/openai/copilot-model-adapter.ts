import { OpenAIAdapter } from '@copilotkit/runtime';
import { LUNA_CHAT } from './model-config';

export function createLunaCopilotAdapter() {
  const adapter = new OpenAIAdapter({ model: LUNA_CHAT.model });
  const completions = adapter.openai.beta.chat.completions;
  const stream = completions.stream.bind(completions);
  // CopilotKit's bundled SDK predates effort none; its transport forwards it intact.
  completions.stream = ((body, options) => stream({
    ...body,
    ...(body.model === LUNA_CHAT.model ? { reasoning_effort: LUNA_CHAT.reasoning_effort } : {}),
  }, options)) as typeof completions.stream;
  return adapter;
}
