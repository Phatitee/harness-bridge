import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { GatewayError } from './errors.mjs';

export const PROVIDERS = ['copilot', 'codex', 'agy'];
export function appHome(env = process.env) {
  return path.resolve(env.PROXYUP_HOME || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'proxyup'));
}
export function defaultConfig() {
  return {
    version: 1,
    gateway: { host: '127.0.0.1', port: 8321 },
    backends: {
      copilot: { mode: 'managed', command: 'copilot-proxy-api', url: 'http://127.0.0.1:4141', keyEnv: 'COPILOT_API_KEY' },
      cliproxy: { mode: 'managed', command: 'cliproxyapi', url: 'http://127.0.0.1:8317', keyEnv: 'CLIPROXY_API_KEY' },
    },
    providers: Object.fromEntries(PROVIDERS.map(id => [id, { enabled: false, accountRevision: 0, modelIds: [] }])),
    defaultModel: null,
    requestTimeoutMs: 180000,
  };
}
export function loopbackUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new GatewayError('CONFIG', 'Invalid backend URL.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new GatewayError('CONFIG', 'Backends must use a loopback HTTP origin without credentials or a path.');
  }
  return url;
}
export function validateConfig(config) {
  if (config.version !== 1 || config.gateway?.host !== '127.0.0.1' || !Number.isInteger(config.gateway.port) || config.gateway.port < 1 || config.gateway.port > 65535) throw new GatewayError('CONFIG', 'Expected config version 1 and a loopback gateway with port 1–65535.');
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1000 || config.requestTimeoutMs > 3600000) throw new GatewayError('CONFIG', 'requestTimeoutMs must be between 1000 and 3600000.');
  for (const name of ['copilot', 'cliproxy']) {
    const backend = config.backends?.[name];
    loopbackUrl(backend?.url);
    if (!['managed', 'attach'].includes(backend.mode) || typeof backend.command !== 'string' || !backend.command || !/^[A-Z_][A-Z0-9_]*$/.test(backend.keyEnv)) throw new GatewayError('CONFIG', `Invalid ${name} backend configuration.`);
  }
  for (const id of PROVIDERS) {
    const p = config.providers?.[id];
    if (typeof p?.enabled !== 'boolean' || !Number.isInteger(p.accountRevision) || !Array.isArray(p.modelIds) || p.modelIds.some(x => typeof x !== 'string')) throw new GatewayError('CONFIG', `Invalid provider configuration: ${id}.`);
  }
  if (config.defaultModel !== null && (typeof config.defaultModel !== 'string' || !PROVIDERS.includes(config.defaultModel.split('/')[0]) || !config.defaultModel.split('/')[1])) throw new GatewayError('CONFIG', 'defaultModel must be a namespaced provider/model ID.');
  const urls = Object.values(config.backends).map(b => loopbackUrl(b.url).port || '80');
  if (urls.includes(String(config.gateway.port)) || urls[0] === urls[1]) throw new GatewayError('CONFIG', 'Gateway and backend ports must be distinct.');
  return config;
}
export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(tmp, file);
  await chmod(file, 0o600);
}
export async function readConfig(home) {
  try { return validateConfig(JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return defaultConfig();
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('CONFIG', 'Cannot read config.json; fix its JSON or restore your backup.');
  }
}
export async function saveConfig(home, config) { await atomicJson(path.join(home, 'config.json'), validateConfig(config)); }
export async function ensureSecrets(home) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, 'secrets.json');
  const fresh = { clientKey: randomBytes(32).toString('hex'), backendKey: randomBytes(32).toString('hex') };
  try { await writeFile(file, `${JSON.stringify(fresh)}\n`, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await chmod(file, 0o600);
  const secrets = JSON.parse(await readFile(file, 'utf8'));
  if (!secrets.clientKey || !secrets.backendKey) throw new GatewayError('CONFIG', 'Invalid local secrets file.');
  return secrets;
}
export function backendFor(provider) { return provider === 'copilot' ? 'copilot' : 'cliproxy'; }
export function backendKey(config, secrets, backend, env = process.env) {
  return config.backends[backend].mode === 'managed' ? secrets.backendKey : (env[config.backends[backend].keyEnv] || '');
}
