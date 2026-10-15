import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { timingSafeEqual } from 'node:crypto';
import { backendFor, backendKey } from './config.mjs';
import { resolveRoute } from './catalog.mjs';
import { GatewayError } from './errors.mjs';
import { withToolManual } from './tool-manual.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function equal(a, b) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
const LIMIT = 16 * 1024 * 1024;
export function createHandler(config, secrets, catalog, { fetchImpl = fetch, env = process.env } = {}) {
  return async request => {
    const url = new URL(request.url);
    const supplied = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!secrets.clientKey || !equal(supplied, secrets.clientKey)) return json({ error: { type: 'authentication_error', message: 'Missing or invalid local gateway key.' } }, 401);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ service: 'claude-provider-gateway', version: '0.1.0', providers: catalog.status() });
      if (request.method === 'GET' && url.pathname === '/v1/models') return json({ object: 'list', data: (await catalog.refresh()).map(({ upstreamModel, ...m }) => m) });
      if (request.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(url.pathname)) return json({ error: { message: 'Route not found.' } }, 404);
      const body = await request.text();
      if (Buffer.byteLength(body) > LIMIT) return json({ error: { message: 'Request exceeds 16 MiB.' } }, 413);
      let payload;
      try { payload = JSON.parse(body); } catch { throw new GatewayError('INVALID_JSON', 'Request body must be valid JSON.'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new GatewayError('INVALID_JSON', 'Expected a JSON object.');
      const models = await catalog.refresh();
      const target = resolveRoute(payload.model, models, config);
      if (catalog.status()[target.provider]?.state !== 'ready') throw new GatewayError('PROVIDER_UNAVAILABLE', 'Provider is not ready.', `Run proxyup login ${target.provider}, then proxyup models --refresh.`, 503);
      const backend = backendFor(target.provider);
      const key = backendKey(config, secrets, backend, env);
      const headers = new Headers();
      for (const name of ['anthropic-version', 'anthropic-beta', 'x-client-request-id', 'accept']) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
      headers.set('content-type', 'application/json');
      if (key) { headers.set('authorization', `Bearer ${key}`); headers.set('x-api-key', key); }
      const upstreamPayload = withToolManual({ ...payload, model: target.upstreamModel }, config, target.upstreamModel);
      const upstreamBody = JSON.stringify(upstreamPayload);
      if (Buffer.byteLength(upstreamBody) > LIMIT) return json({ error: { message: 'Request plus tool manual exceeds 16 MiB. Reduce context or set toolManual.mode to off.' } }, 413);
      const upstream = await fetchImpl(`${config.backends[backend].url}${url.pathname}${url.search}`, {
        method: 'POST', headers, body: upstreamBody,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(config.requestTimeoutMs)]),
      });
      const responseHeaders = new Headers();
      for (const name of ['content-type', 'retry-after', 'request-id', 'x-request-id']) if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name));
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      const known = error instanceof GatewayError;
      return json({ error: { type: known ? error.code : 'UPSTREAM_ERROR', message: known ? error.message : 'The upstream connection failed or timed out.', ...(known && error.hint ? { hint: error.hint } : {}) } }, known ? error.status : 502);
    }
  };
}
export function createServer(handler) {
  return http.createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.once('aborted', () => controller.abort());
    outgoing.once('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > LIMIT) { outgoing.writeHead(413); outgoing.end('Request too large.'); return; }
        chunks.push(chunk);
      }
      const request = new Request(`http://127.0.0.1${incoming.url}`, { method: incoming.method, headers: incoming.headers, signal: controller.signal, ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) });
      const response = await handler(request);
      if (outgoing.destroyed) { await response.body?.cancel(); return; }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
      else outgoing.end();
    } catch {
      controller.abort();
      if (outgoing.headersSent || outgoing.destroyed) outgoing.destroy();
      else { outgoing.writeHead(502, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ error: { message: 'Connection closed or stream failed.' } })); }
    }
  });
}
