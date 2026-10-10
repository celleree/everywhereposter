import { createLunaCopilotAdapter } from '@gitroom/nestjs-libraries/openai/copilot-model-adapter';

jest.mock('@copilotkit/runtime', () => {
  const stream = jest.fn().mockReturnValue('fixture-stream');
  return { stream, OpenAIAdapter: jest.fn().mockImplementation(() => ({
    openai: { beta: { chat: { completions: { stream } } } },
  })) };
});

it('sets Luna effort none and preserves Copilot streaming tools and options', () => {
  const adapter = createLunaCopilotAdapter();
  const body = { model: 'gpt-6-luna', messages: [], tools: [{ type: 'function', function: { name: 'fixture_tool' } }] };
  const options = { signal: new AbortController().signal };
  expect(adapter.openai.beta.chat.completions.stream(body as any, options)).toBe('fixture-stream');
  expect(jest.requireMock('@copilotkit/runtime').stream).toHaveBeenCalledWith({ ...body, reasoning_effort: 'none' }, options);
  expect(jest.requireMock('@copilotkit/runtime').OpenAIAdapter).toHaveBeenCalledWith({ model: 'gpt-6-luna' });
});
