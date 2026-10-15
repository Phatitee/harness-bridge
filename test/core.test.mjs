import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig, saveConfig, readConfig, ensureSecrets, validateConfig } from '../src/config.mjs';
import { parseCommand } from '../src/args.mjs';
import { normalizeModels, resolveRoute, createCatalog } from '../src/catalog.mjs';
import { loginCommand, backendCommands } from '../src/adapters.mjs';
import { buildClaudeSettings } from '../src/claude.mjs';

test('private config persists without machine-specific defaults or inline secrets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'proxyup-test-'));
  const config = defaultConfig();
  assert.equal(config.gateway.host, '127.0.0.1');
  assert.equal(config.providers.copilot.enabled, false);
  await saveConfig(dir, config);
  assert.deepEqual(await readConfig(dir), config);
  const secrets = await ensureSecrets(dir);
  assert.equal(secrets.clientKey.length, 64);
  assert.equal((await stat(path.join(dir, 'secrets.json'))).mode & 0o777, 0o600);
  assert.equal((await readFile(path.join(dir, 'config.json'), 'utf8')).includes(secrets.clientKey), false);
});

test('config rejects remote upstreams, bad ports and unknown provider defaults', () => {
  for (const change of [
    c => { c.gateway.host = '0.0.0.0'; },
    c => { c.gateway.port = 0; },
    c => { c.backends.copilot.url = 'http://evil.example:4141'; },
    c => { c.defaultModel = 'unknown/model'; },
  ]) {
    const config = defaultConfig(); change(config);
    assert.throws(() => validateConfig(config));
  }
});

test('CLI rejects unknown commands, flags and missing values before execution', () => {
  assert.equal(parseCommand(['login', 'agy', '--no-browser']).provider, 'agy');
  assert.equal(parseCommand([]).command, 'start');
  for (const args of [['oops'], ['models', '--provder', 'codex'], ['login', 'bad'], ['run', '--model'], ['status', '--attach']]) {
    assert.throws(() => parseCommand(args), { code: 'USAGE' });
  }
});

test('provider auth uses argument arrays and respects supported login modes', () => {
  const c = defaultConfig();
  assert.deepEqual(loginCommand('copilot', c, '/tmp/test').args, ['auth']);
  assert.ok(loginCommand('codex', c, '/tmp/test', { device: true }).args.includes('-codex-device-login'));
  assert.ok(loginCommand('agy', c, '/tmp/test', { noBrowser: true }).args.includes('-antigravity-login'));
  assert.throws(() => loginCommand('copilot', c, '/tmp/test', { noBrowser: true }));
  c.providers.codex.enabled = true; c.providers.agy.enabled = true;
  assert.equal(backendCommands(c, '/tmp/test', { backendKey: 'secret' }).length, 1);
});

test('model aliases preserve provenance and cannot route disabled providers', () => {
  const rows = normalizeModels('copilot', [{ id: 'gpt-example', name: 'GPT' }, { id: 'gpt-example' }, { id: 'text-embedding-3-small' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'copilot/claude-route-gpt-example');
  const config = defaultConfig();
  assert.throws(() => resolveRoute(rows[0].id, rows, config), { code: 'PROVIDER_DISABLED' });
  config.providers.copilot.enabled = true;
  assert.equal(resolveRoute(rows[0].id, rows, config).upstreamModel, 'gpt-example');
  assert.throws(() => resolveRoute('copilot/claude-route-invented', rows, config), { code: 'MODEL_UNAVAILABLE' });
});

test('catalog partitions metadata first, caches, and never invents AGY variants', async () => {
  const config = defaultConfig(); config.providers.codex.enabled = true; config.providers.agy.enabled = true;
  let calls = 0;
  const catalog = createCatalog(config, { backendKey: 's' }, { fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ data: [{ id: 'gpt-example', owned_by: 'openai' }, { id: 'gemini-example', owned_by: 'google' }] }));
  } });
  const models = await catalog.refresh();
  assert.equal(calls, 1);
  assert.deepEqual(models.map(x => x.provider).sort(), ['agy', 'codex']);
  await catalog.refresh(); assert.equal(calls, 1);
  await catalog.refresh({ force: true }); assert.equal(calls, 2);
});

test('Claude settings expose all discovered models while routing every request through gateway', () => {
  const config = defaultConfig();
  const settings = buildClaudeSettings(config, { clientKey: 'local' }, [{ id: 'codex/claude-route-gpt-example', display_name: '[codex] GPT' }], 'codex/claude-route-gpt-example');
  assert.equal(settings.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:8321');
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'local');
  assert.equal(settings.modelPicker.replaceBuiltInOptions, true);
  assert.equal(settings.modelPicker.options.length, 1);
  assert.equal(settings.model, 'codex/claude-route-gpt-example');
  assert.equal(settings.permissions, undefined);
});
