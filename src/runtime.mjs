import { createCatalog } from './catalog.mjs';
import { createHandler, createServer } from './gateway.mjs';
import { startBackends } from './processes.mjs';
import { GatewayError } from './errors.mjs';

export async function startRuntime(config, home, secrets) {
  let handler = async () => new Response('Starting', { status: 503 });
  const server = createServer(request => handler(request));
  // Reserve the gateway port first, so a second launch starts no backends.
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new GatewayError('GATEWAY_PORT', 'The gateway port cannot be opened.', 'Run proxyup status; stop the existing gateway or change gateway.port.')));
    server.listen(config.gateway.port, config.gateway.host, resolve);
  });
  let backends;
  try {
    backends = await startBackends(config, home, secrets);
    const catalog = createCatalog(config, secrets);
    await catalog.refresh({ force: true });
    handler = createHandler(config, secrets, catalog);
    // No unhandled error events from the listening server.
    server.on('error', () => {});
    const close = async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await backends.close();
    };
    return { catalog, server, close, children: backends.children };
  } catch (error) {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (backends) await backends.close(); throw error;
  }
}
export async function fetchGateway(config, secrets, route = '/v1/models') {
  let response;
  try {
    response = await fetch(`http://${config.gateway.host}:${config.gateway.port}${route}`, { headers: { authorization: `Bearer ${secrets.clientKey}` }, signal: AbortSignal.timeout(15000) });
  } catch { throw new GatewayError('GATEWAY_OFFLINE', 'Cannot reach this installation’s gateway.', 'Run proxyup start in another terminal.'); }
  if (!response.ok) { await response.body?.cancel(); throw new GatewayError('GATEWAY_AUTH', 'The listener is not authenticated as this installation.', 'Check PROXYUP_HOME and the configured gateway port.'); }
  return response.json();
}
