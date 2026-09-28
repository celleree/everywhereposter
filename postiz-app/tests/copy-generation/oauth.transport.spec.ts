jest.mock('uuid', () => ({ v4: () => require('node:crypto').randomUUID() }));
// Disable process-exit hooks only; retain the real MCP protocol/transport.
jest.mock('exit-hook', () => ({ __esModule: true, default: jest.fn(), gracefulExit: jest.fn() }));
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({ MastraService: class MastraService {} }));
import express from 'express';
import { AddressInfo } from 'node:net';
import { startMcp } from '../../libraries/nestjs-libraries/src/chat/start.mcp';

// Real Mastra MCP transport: synthetic grants/services, no real accounts or writes.
describe('OAuth MCP wire contract', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base: string;
  const tokens: Record<string, string> = { pos_read: 'accounts:read', pos_write: 'posts:write', pos_both: 'accounts:read posts:write' };
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://server.test/api';
    process.env.FRONTEND_URL = 'https://server.test';
    const app = express(); app.use(express.json());
    await startMcp({
      get: (provider: any) => {
        if (provider.name === 'MastraService') return { mastra: async () => ({ getAgent: () => ({ listTools: async () => ({}) }) }) };
        if (provider.name === 'OAuthService') return { getOrgByOAuthToken: async (token: string) => tokens[token] ? { id: token, scope: tokens[token], organization: { id: token } } : null };
        return { getIntegrationsList: async (org: string) => [{ id: `${org}-account`, providerIdentifier: 'linkedin', name: 'Account', token: 'secret', disabled: false, refreshNeeded: false, inBetweenSteps: false }] };
      }, use: app.use.bind(app),
    } as any);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((done) => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((done) => server.close(() => done())); });
  async function rpc(token: string, method: string, params: any = {}, session?: string) {
    const response = await fetch(`${base}/mcp-oauth`, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return { data: await response.json(), session: response.headers.get('mcp-session-id') || session };
  }
  async function initialize(token: string) {
    return rpc(token, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  }
  it('discovers scope-specific registries with real file schema and metadata', async () => {
    for (const token of Object.keys(tokens)) {
      const { session } = await initialize(token);
      const { data } = await rpc(token, 'tools/list', {}, session);
      const names = data.result.tools.map((t: any) => t.name);
      if (token === 'pos_read') expect(names).toEqual(['list_connected_accounts']);
      else {
        expect(names).toEqual(expect.arrayContaining(['integrationSchema', 'triggerTool', 'prepare_post', 'publish_post', 'ingest_chatgpt_file']));
        expect(names.includes('list_connected_accounts')).toBe(token === 'pos_both');
        const file = data.result.tools.find((t: any) => t.name === 'ingest_chatgpt_file');
        expect(file._meta['openai/fileParams']).toEqual(['file']);
        expect(file.inputSchema.properties.file.required.sort()).toEqual(['download_url', 'file_id']);
        expect(Object.keys(file.inputSchema.properties.file.properties).sort()).toEqual(['download_url', 'file_id', 'file_name', 'mime_type']);
      }
      expect(names.some((n: string) => /agent|generate|analytics/.test(n))).toBe(false);
    }
  });
  it('executes account listing under the grant and rejects writes from a read session', async () => {
    const { session } = await initialize('pos_read');
    const listed = await rpc('pos_read', 'tools/call', { name: 'list_connected_accounts', arguments: {} }, session);
    expect(JSON.stringify(listed.data)).toContain('pos_read-account');
    expect(JSON.stringify(listed.data)).not.toContain('secret');
    const rejected = await rpc('pos_read', 'tools/call', { name: 'ingest_chatgpt_file', arguments: { file: { download_url: 'https://public.test/a', file_id: 'f' } } }, session);
    expect(rejected.data.result.isError).toBe(true);
  });
  it('does not echo signed URLs on file validation errors', async () => {
    const { session } = await initialize('pos_write');
    const result = await rpc('pos_write', 'tools/call', { name: 'ingest_chatgpt_file', arguments: { file: { download_url: 'https://file.test/a?secret=signature' } } }, session);
    expect(result.data.result.isError).toBe(true);
    expect(JSON.stringify(result.data)).not.toMatch(/secret|signature|download_url/);
  });
});
