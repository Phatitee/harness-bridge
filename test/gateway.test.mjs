import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/config.mjs';
import { createHandler } from '../src/gateway.mjs';

const secrets = { clientKey: 'client', backendKey: 'upstream' };
function fixture(fetchImpl) {
  const config = defaultConfig(); config.providers.copilot.enabled = true;
  const catalog = {
    refresh: async () => [{ id: 'copilot/claude-route-example', provider: 'copilot', upstreamModel: 'example' }],
    status: () => ({ copilot: { state: 'ready', count: 1 } }),
  };
  return createHandler(config, secrets, catalog, { fetchImpl });
}
function request(body, headers = {}) {
  return new Request('http://localhost/v1/messages?beta=true', { method: 'POST', headers: { authorization: 'Bearer client', ...headers }, body: JSON.stringify(body) });
}

test('gateway authenticates before returning a catalog', async () => {
  const handler = fixture();
  assert.equal((await handler(new Request('http://localhost/v1/models'))).status, 401);
  const response = await handler(new Request('http://localhost/v1/models', { headers: { 'x-api-key': 'client' } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.length, 1);
});

test('gateway maps model, replaces auth, preserves tools and SSE without executing tools', async () => {
  const tools = [{ name: 'mcp__test__query', input_schema: { type: 'object', properties: { rows: { type: 'array' } } } }];
  const handler = fixture(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:4141/v1/messages?beta=true');
    assert.equal(options.headers.get('authorization'), 'Bearer upstream');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'example');
    assert.deepEqual(payload.tools, tools);
    return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const response = await handler(request({ model: 'copilot/claude-route-example', tools, stream: true }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /message_stop/);
});

test('unknown models and malformed JSON fail before upstream', async () => {
  const handler = fixture(() => { throw new Error('must not fetch'); });
  assert.equal((await handler(request({ model: 'copilot/claude-route-missing' }))).status, 400);
  const bad = new Request('http://localhost/v1/messages', { method: 'POST', headers: { 'x-api-key': 'client' }, body: '{' });
  assert.equal((await handler(bad)).status, 400);
});

test('health is an authenticated project identity, not just an open port', async () => {
  const handler = fixture();
  const response = await handler(new Request('http://localhost/health', { headers: { 'x-api-key': 'client' } }));
  assert.equal((await response.json()).service, 'claude-provider-gateway');
});

test('upstream errors do not reveal token values or raw dependency exceptions', async () => {
  const response = await fixture(async () => { throw new Error('leaked upstream client secret'); })(request({ model: 'copilot/claude-route-example' }));
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes('secret'), false);
});

test('request cancellation reaches the upstream fetch signal', async () => {
  const controller = new AbortController();
  let reached = false;
  const handler = fixture(async (_url, options) => {
    reached = true;
    controller.abort();
    assert.equal(options.signal.aborted, true);
    throw options.signal.reason;
  });
  const req = new Request('http://localhost/v1/messages', { method: 'POST', headers: { 'x-api-key': 'client' }, body: JSON.stringify({ model: 'copilot/claude-route-example' }), signal: controller.signal });
  assert.equal((await handler(req)).status, 502);
  assert.equal(reached, true);
});
