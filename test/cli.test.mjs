import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function cli(args, home) {
  const child = spawnSync(process.execPath, ['bin/proxyup.mjs', ...args, '--json'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PROXYUP_HOME: home }, encoding: 'utf8', timeout: 10000 });
  return { code: child.status, data: JSON.parse(child.stdout) };
}

test('non-interactive setup is additive, stores no provider tokens, logout only disconnects selected provider', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'proxyup-setup-'));
  assert.equal(cli(['setup', '--providers', 'codex,agy', '--attach', '--no-login'], home).code, 0);
  let config = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'));
  assert.equal(config.providers.codex.enabled, true);
  assert.equal(config.providers.agy.enabled, true);
  assert.equal(config.backends.cliproxy.mode, 'attach');
  assert.equal(JSON.stringify(config).includes('clientKey'), false);
  assert.equal(cli(['logout', 'agy'], home).data.state, 'disconnected');
  config = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'));
  assert.equal(config.providers.codex.enabled, true);
  assert.equal(config.providers.agy.enabled, false);
});

test('missing non-interactive setup provider and inconsistent model fail without state writes', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'proxyup-input-'));
  const home = path.join(parent, 'absent');
  assert.equal(cli(['setup'], home).code, 2);
  assert.equal(cli(['setup', '--providers', 'codex', '--model', 'copilot/claude-route-x', '--no-login'], home).code, 2);
  await assert.rejects(access(home));
});

test('version works without configured providers', () => {
  const result = cli(['--version'], path.join(os.tmpdir(), 'proxyup-unused-version'));
  assert.equal(result.code, 0);
  assert.equal(result.data.version, '0.1.0');
});
