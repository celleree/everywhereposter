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
const tokens = { pos_read: 'accounts:read', pos_write: 'posts:write', pos_both: 'accounts:read posts:write',
  pos_analytics: 'analytics:read', pos_read_analytics: 'analytics:read accounts:read',
  pos_write_analytics: 'posts:write analytics:read', pos_all: 'posts:write analytics:read accounts:read' };
(async () => {
  const app = express(); app.use(express.json());
  await startMcp({
    get: (provider) => {
      if (provider.name === 'MastraService') return { mastra: async () => ({ getAgent: () => ({ listTools: async () => ({}) }) }) };
      if (provider.name === 'OAuthService') return { getOrgByOAuthToken: async (token) => tokens[token] ? { id: token, scope: tokens[token], organization: { id: token } } : null };
      const analytics = (org) => ({ status: 'available', account: { id: `${org}-account`, displayName: 'Account', platform: 'instagram' },
        metrics: [{ label: 'Views', seriesType: 'total_value', summaryType: 'latest', data: [{ total: 0, date: '2026-10-19' }] }] });
      if (provider.name === 'IntegrationService') return {
        getIntegrationById: async (org, id) => id === `${org}-account` ? { id, name: 'Account', providerIdentifier: 'instagram' } : null,
        getIntegrationsList: async (org) => [{ id: `${org}-account`, providerIdentifier: 'linkedin', name: 'Account', token: 'secret', disabled: false, refreshNeeded: false, inBetweenSteps: false }],
        checkAnalytics: async (org, id, period, options) => {
          assert.equal(options.readOnly, true); assert.equal(period, '30');
          if (id !== `${org.id}-account`) throw new Error('provider-secret');
          return analytics(org.id);
        },
      };
      if (provider.name === 'PostsService') return {
        checkPostAnalytics: async (org, id, period, options) => {
          assert.equal(options.readOnly, true);
          if (id !== `${org}-post`) throw new Error('provider-secret');
          return { ...analytics(org), post: { id, publishedAt: '2026-10-19T00:00:00Z' } };
        },
        listPublishedPostsForAnalytics: async (org) => [{ id: `${org}-post`, publishDate: new Date('2026-10-19') }],
      };
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
      const scopes = tokens[token].split(' ');
      const hasRead = scopes.includes('accounts:read'), hasWrite = scopes.includes('posts:write'), hasAnalytics = scopes.includes('analytics:read');
      const analyticsNames = ['get_analytics', 'get_post_analytics', 'list_published_posts'];
      assert.deepEqual(names.sort(), [
        ...(hasRead ? ['list_connected_accounts'] : []),
        ...(hasWrite ? ['integrationSchema', 'triggerTool', 'prepare_post', 'publish_post', 'ingest_chatgpt_file'] : []),
        ...(hasAnalytics ? analyticsNames : []),
      ].sort());
      if (hasWrite) {
        for (const name of ['integrationSchema', 'triggerTool', 'prepare_post', 'publish_post', 'ingest_chatgpt_file']) assert(names.includes(name));
        assert.equal(names.includes('list_connected_accounts'), hasRead);
        const file = data.result.tools.find((t) => t.name === 'ingest_chatgpt_file');
        assert.deepEqual(file._meta['openai/fileParams'], ['file']);
        assert.deepEqual(file.inputSchema.properties.file.required.sort(), ['download_url', 'file_id']);
        assert.deepEqual(Object.keys(file.inputSchema.properties.file.properties).sort(), ['download_url', 'file_id', 'file_name', 'mime_type']);
      }
      assert(!names.some((name) => /agent|generate/.test(name)));
      for (const name of analyticsNames) assert.equal(names.includes(name), hasAnalytics);
      if (hasAnalytics) {
        for (const name of analyticsNames) {
          const tool = data.result.tools.find((t) => t.name === name);
          assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['analytics:read'] }]);
          assert.equal(tool.annotations.readOnlyHint, true);
          const result = await rpc(token, 'tools/call', { name, arguments: name === 'get_post_analytics' ? { postId: `${token}-post` } : { integrationId: `${token}-account` } }, session);
          assert.notEqual(result.data.result.isError, true, JSON.stringify(result.data));
          assert.doesNotMatch(JSON.stringify(result.data), /secret|tokenExpiration|refreshToken/);
        }
        for (const args of [{ integrationId: 'foreign' }, { integrationId: `${token}-account`, period: 31, organizationId: 'unrelated-secret' }]) {
          const rejected = await rpc(token, 'tools/call', { name: 'get_analytics', arguments: args }, session);
          assert.equal(rejected.data.result.isError, true);
          assert.doesNotMatch(JSON.stringify(rejected.data), /provider-secret|unrelated-secret/);
        }
      } else {
        const rejected = await rpc(token, 'tools/call', { name: 'get_analytics', arguments: { integrationId: `${token}-account` } }, session);
        assert.equal(rejected.data.result.isError, true);
      }
      if (!hasRead) {
        const rejected = await rpc(token, 'tools/call', { name: 'list_connected_accounts', arguments: {} }, session);
        assert.equal(rejected.data.result.isError, true);
      }
      if (hasRead) {
        const listed = await rpc(token, 'tools/call', { name: 'list_connected_accounts', arguments: {} }, session);
        assert.match(JSON.stringify(listed.data), new RegExp(`${token}-account`));
        assert.doesNotMatch(JSON.stringify(listed.data), /secret/);
      }
      if (!hasWrite) {
        for (const name of ['integrationSchema', 'triggerTool', 'ingest_chatgpt_file', 'prepare_post', 'publish_post']) {
          const rejected = await rpc(token, 'tools/call', { name, arguments: {} }, session);
          assert.equal(rejected.data.result.isError, true);
        }
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
