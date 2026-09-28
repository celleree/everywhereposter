// Native Node loads the real MCP SDK's ESM dependencies; Jest runs this fixture
// in a child process. Only unrelated agent construction/password hashing is stubbed.
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'bcrypt') return {};
  if (name === '@gitroom/nestjs-libraries/chat/mastra.service') return { MastraService: class MastraService {} };
  return originalLoad.call(this, name, ...args);
};
const express = require('express');
const { startMcp } = require('../../../libraries/nestjs-libraries/src/chat/start.mcp.ts');
const tokens = { pos_read: 'accounts:read', pos_write: 'posts:write', pos_both: 'accounts:read posts:write' };
(async () => {
  const app = express(); app.use(express.json());
  await startMcp({
    get: (provider) => {
      if (provider.name === 'MastraService') return { mastra: async () => ({ getAgent: () => ({ listTools: async () => ({}) }) }) };
      if (provider.name === 'OAuthService') return { getOrgByOAuthToken: async (token) => tokens[token] ? { id: token, scope: tokens[token], organization: { id: token } } : null };
      return { getIntegrationsList: async (org) => [{ id: `${org}-account`, providerIdentifier: 'linkedin', name: 'Account', token: 'secret', disabled: false, refreshNeeded: false, inBetweenSteps: false }] };
    }, use: app.use.bind(app),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function rpc(token, method, params = {}, session) {
    const response = await fetch(`${base}/mcp-oauth`, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return { data: await response.json(), session: response.headers.get('mcp-session-id') || session };
  }
  const initialize = (token) => rpc(token, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  try {
    for (const token of Object.keys(tokens)) {
      const { session } = await initialize(token);
      const { data } = await rpc(token, 'tools/list', {}, session);
      const names = data.result.tools.map((t) => t.name);
      if (token === 'pos_read') assert.deepEqual(names, ['list_connected_accounts']);
      else {
        for (const name of ['integrationSchema', 'triggerTool', 'prepare_post', 'publish_post', 'ingest_chatgpt_file']) assert(names.includes(name));
        assert.equal(names.includes('list_connected_accounts'), token === 'pos_both');
        const file = data.result.tools.find((t) => t.name === 'ingest_chatgpt_file');
        assert.deepEqual(file._meta['openai/fileParams'], ['file']);
        assert.deepEqual(file.inputSchema.properties.file.required.sort(), ['download_url', 'file_id']);
        assert.deepEqual(Object.keys(file.inputSchema.properties.file.properties).sort(), ['download_url', 'file_id', 'file_name', 'mime_type']);
      }
      assert(!names.some((name) => /agent|generate|analytics/.test(name)));
      if (token === 'pos_read') {
        const listed = await rpc(token, 'tools/call', { name: 'list_connected_accounts', arguments: {} }, session);
        assert.match(JSON.stringify(listed.data), /pos_read-account/);
        assert.doesNotMatch(JSON.stringify(listed.data), /secret/);
        const rejected = await rpc(token, 'tools/call', { name: 'ingest_chatgpt_file', arguments: { file: { download_url: 'https://public.test/a', file_id: 'f' } } }, session);
        assert.equal(rejected.data.result.isError, true);
      } else {
        const result = await rpc(token, 'tools/call', { name: 'ingest_chatgpt_file', arguments: { file: { download_url: 'https://file.test/a?secret=signature' } } }, session);
        assert.equal(result.data.result.isError, true);
        assert.doesNotMatch(JSON.stringify(result.data), /secret|signature|download_url/);
      }
    }
    const badCall = { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
      name: 'ingest_chatgpt_file', arguments: { file: { download_url: 'https://file.test/a?secret=signature' } },
    } };
    for (const [contentType, body] of [['application/json', [badCall]], ['application/jsonfoo', badCall]]) {
      const response = await fetch(`${base}/mcp-oauth`, { method: 'POST',
        headers: { Authorization: 'Bearer pos_write', 'Content-Type': contentType }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /secret|signature|download_url/);
    }
    console.log('OAuth MCP wire assertions passed');
  } finally { await new Promise((done) => server.close(done)); }
})().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
