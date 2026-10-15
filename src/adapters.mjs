import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { GatewayError } from './errors.mjs';

export const cliproxyConfigPath = home => path.join(home, 'cliproxy.yaml');
export function loginCommand(provider, config, home, { device = false, noBrowser = false } = {}) {
  if (provider === 'agy' && device) throw new GatewayError('USAGE', 'AGY does not offer device login through this adapter. Use proxyup login agy --no-browser for a manual browser link.');
  if (provider === 'copilot') {
    if (device || noBrowser) throw new GatewayError('USAGE', 'Copilot already uses a device flow; --device and --no-browser apply to CLIProxy providers only.');
    return { command: config.backends.copilot.command, args: ['auth'] };
  }
  return {
    command: config.backends.cliproxy.command,
    args: ['-config', cliproxyConfigPath(home), provider === 'codex' ? (device ? '-codex-device-login' : '-codex-login') : '-antigravity-login', ...(noBrowser ? ['-no-browser'] : [])],
  };
}
export function backendCommands(config, home, secrets) {
  const out = [];
  if (config.providers.copilot.enabled && config.backends.copilot.mode === 'managed') out.push({
    id: 'copilot', command: config.backends.copilot.command,
    args: ['start', '--port', new URL(config.backends.copilot.url).port || '80', '--api-key', secrets.backendKey],
  });
  if ((config.providers.codex.enabled || config.providers.agy.enabled) && config.backends.cliproxy.mode === 'managed') out.push({
    id: 'cliproxy', command: config.backends.cliproxy.command, args: ['-config', cliproxyConfigPath(home)],
  });
  return out;
}
export async function writeBackendConfig(config, home, secrets) {
  const authDir = path.join(home, 'credentials', 'cliproxy');
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  const port = Number(new URL(config.backends.cliproxy.url).port || 80);
  // JSON string quoting is compatible with YAML quoted scalar values.
  const yaml = `host: "127.0.0.1"\nport: ${port}\nauth-dir: ${JSON.stringify(authDir)}\napi-keys:\n  - ${JSON.stringify(secrets.backendKey)}\nrequest-retry: 0\nlogging-to-file: false\nquota-exceeded:\n  switch-project: false\n  switch-preview-model: false\n`;
  await writeFile(cliproxyConfigPath(home), yaml, { mode: 0o600 });
}
