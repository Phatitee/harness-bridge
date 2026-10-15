import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultConfig } from '../src/config.mjs';
import { createCatalog, classifyModel } from '../src/catalog.mjs';
import { installLauncher } from '../src/claude.mjs';
import { loginCommand, writeBackendConfig } from '../src/adapters.mjs';
import { runProcess, stopChildren } from '../src/processes.mjs';
import { createServer, createHandler } from '../src/gateway.mjs';

test('unclassified shared models are excluded unless explicitly assigned', () => {
  const c = defaultConfig();
  assert.equal(classifyModel({ id: 'ambiguous' }, c), null);
  c.providers.agy.modelIds.push('ambiguous');
  assert.equal(classifyModel({ id: 'ambiguous' }, c), 'agy');
  c.providers.codex.modelIds.push('ambiguous');
  assert.equal(classifyModel({ id: 'ambiguous' }, c), null);
});

test('catalog retains stale data but marks provider unavailable', async () => {
  const c = defaultConfig(); c.providers.copilot.enabled = true;
  let fail = false;
  const catalog = createCatalog(c, { backendKey: 's' }, { fetchImpl: async () => {
    if (fail) throw new Error('secret');
    return new Response(JSON.stringify({ data: [{ id: 'example' }] }));
  } });
  await catalog.refresh(); fail = true;
  assert.equal((await catalog.refresh({ force: true })).length, 1);
  assert.deepEqual(catalog.status().copilot, { state: 'unavailable', count: 1, stale: true });
});

test('launcher is idempotent and never overwrites an unrelated file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'proxyup-launcher-'));
  await installLauncher({ directory });
  assert.equal((await installLauncher({ directory })).state, 'unchanged');
  await installLauncher({ directory, remove: true });
  await writeFile(path.join(directory, 'claude-gateway'), 'belongs to someone else');
  await assert.rejects(installLauncher({ directory }), { code: 'FILE_EXISTS' });
  assert.equal(await readFile(path.join(directory, 'claude-gateway'), 'utf8'), 'belongs to someone else');
});

test('managed CLIProxy uses a private auth directory and zero nested retries', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'proxyup-adapter-'));
  await writeBackendConfig(defaultConfig(), home, { backendKey: 'test-key' });
  const yaml = await readFile(path.join(home, 'cliproxy.yaml'), 'utf8');
  assert.ok(yaml.includes(JSON.stringify(path.join(home, 'credentials', 'cliproxy'))));
  assert.ok(yaml.includes('request-retry: 0'));
});

test('AGY rejects a device flag that its adapter cannot implement', () => {
  assert.throws(() => loginCommand('agy', defaultConfig(), '/tmp/test', { device: true }), { code: 'USAGE' });
});

test('a child that failed to spawn does not hang cleanup', async () => {
  const child = new EventEmitter();
  child.pid = undefined; child.exitCode = null; child.signalCode = null; child.kill = () => false;
  const result = await Promise.race([stopChildren([child]).then(() => 'closed'), new Promise(resolve => setTimeout(() => resolve('hung'), 40))]);
  assert.equal(result, 'closed');
});

test('process runner reports missing executable and bounded failure', async () => {
  await assert.rejects(runProcess('/not/a/real/proxyup-executable', [], { timeoutMs: 100 }), { code: 'EXECUTABLE' });
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }), { code: 'PROCESS_FAILED' });
});

test('unknown CLI flags have no state-writing side effects', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'proxyup-cli-'));
  const home = path.join(base, 'not-created');
  const result = spawnSync(process.execPath, ['bin/proxyup.mjs', 'setup', '--provders', 'codex', '--json'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PROXYUP_HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error, 'USAGE');
  await assert.rejects(access(home));
});

test('HTTP bridge serves authenticated requests over loopback', async t => {
  const config = defaultConfig();
  const catalog = { refresh: async () => [], status: () => ({}) };
  const server = createServer(createHandler(config, { clientKey: 'key' }, catalog));
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Environment does not allow loopback listeners.'); return; }
    throw error;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`, { headers: { 'x-api-key': 'key' } });
    assert.equal((await response.json()).service, 'claude-provider-gateway');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
