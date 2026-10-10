import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';

it.each([['gpt-6.1-sol', 'medium'], ['gpt-6-luna', 'low']])('routes %s tool requests through Responses with supported reasoning', async (model, effort) => {
  const transport = jest.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 'fixture', object: 'response', status: 'completed', created_at: 0, model,
    output: [{ id: 'message-fixture', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'fixture answer', annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  }), { headers: { 'content-type': 'application/json' } }));
  const client = new ChatOpenAI({ apiKey: 'fixture', model, useResponsesApi: true,
    modelKwargs: { reasoning: { effort } }, configuration: { fetch: transport } });
  await client.bindTools([{ type: 'function', function: { name: 'fixture_tool', description: 'fixture', parameters: { type: 'object', properties: {} } } }]).invoke('fixture question');
  const [url, init] = transport.mock.calls[0];
  expect(String(url)).toBe('https://api.openai.com/v1/responses');
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ model, reasoning: { effort }, tools: [{ type: 'function', name: 'fixture_tool' }] });
  expect(body.temperature).toBeUndefined();
});

it('preserves LangChain structured output parsing through Responses', async () => {
  const transport = jest.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 'fixture', object: 'response', status: 'completed', created_at: 0, model: 'gpt-6.1-sol',
    output: [{ id: 'message-fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"value":"fixture"}', annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  }), { headers: { 'content-type': 'application/json' } }));
  const client = new ChatOpenAI({ apiKey: 'fixture', model: 'gpt-6.1-sol', useResponsesApi: true,
    modelKwargs: { reasoning: { effort: 'medium' } }, configuration: { fetch: transport } });
  await expect(client.withStructuredOutput(z.object({ value: z.string() }), { name: 'fixture_extract' }).invoke('fixture')).resolves.toEqual({ value: 'fixture' });
});
