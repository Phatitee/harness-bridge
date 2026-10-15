import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFile, mkdir, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { backendCommands, writeBackendConfig } from './adapters.mjs';
import { backendKey } from './config.mjs';
import { GatewayError } from './errors.mjs';

export function runProcess(command, args, { env = process.env, timeoutMs = 600000, stdio = ['inherit', 'inherit', 'inherit'] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio, shell: false });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    const killTimer = setTimeout(() => child.kill('SIGKILL'), timeoutMs + 3000);
    child.once('error', () => { clearTimeout(timer); clearTimeout(killTimer); reject(new GatewayError('EXECUTABLE', 'Cannot start the requested executable.', 'Run proxyup doctor and check the configured commands.')); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (code === 0) resolve(0);
      else reject(new GatewayError(timedOut ? 'TIMEOUT' : 'PROCESS_FAILED', timedOut ? 'The operation timed out.' : `The command exited unsuccessfully${signal ? ` (${signal})` : ''}.`, 'Run proxyup doctor or retry proxyup login <provider>.'));
    });
  });
}
export async function portOccupied(url) {
  const target = new URL(url);
  return new Promise(resolve => {
    const socket = net.createConnection({ host: target.hostname.replace(/^\[|\]$/g, ''), port: Number(target.port || 80) });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false));
  });
}
export async function stopChildren(children) {
  await Promise.all(children.map(child => new Promise(resolve => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  })));
}
export async function startBackends(config, home, secrets) {
  const specs = backendCommands(config, home, secrets);
  const children = []; const files = [];
  try {
    // Preflight every port before starting any child, never adopt an arbitrary listener.
    for (const spec of specs) {
      if (await portOccupied(config.backends[spec.id].url)) throw new GatewayError('PORT_IN_USE', `Managed ${spec.id} port is occupied.`, 'Stop that existing service or select attach mode in proxyup setup.');
      if (spec.id === 'copilot') {
        let token = '';
        try { token = await readFile(path.join(os.homedir(), '.local', 'share', 'copilot-proxy-api', 'github_token'), 'utf8'); } catch {}
        if (!token.trim()) throw new GatewayError('AUTH_REQUIRED', 'Copilot login is required before startup.', 'Run proxyup login copilot.');
      }
    }
    if (specs.some(x => x.id === 'cliproxy')) await writeBackendConfig(config, home, secrets);
    for (const spec of specs) {
      await mkdir(path.join(home, 'logs'), { recursive: true, mode: 0o700 });
      const log = await open(path.join(home, 'logs', `${spec.id}.log`), 'a', 0o600); files.push(log);
      const child = spawn(spec.command, spec.args, { shell: false, stdio: ['ignore', log.fd, log.fd] });
      children.push(child);
      let failed = false; child.once('error', () => { failed = true; });
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        if (failed || child.exitCode !== null || child.signalCode !== null) break;
        try {
          const key = backendKey(config, secrets, spec.id);
          const response = await fetch(`${config.backends[spec.id].url}/v1/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(1000) });
          await response.body?.cancel();
          if (response.ok) { ready = true; break; }
        } catch {}
        await delay(250);
      }
      if (!ready) throw new GatewayError('BACKEND_START', `The ${spec.id} backend did not become ready.`, 'Run proxyup doctor; inspect private logs in PROXYUP_HOME/logs.');
      process.stderr.write(`${spec.id}: ready; log ${path.join(home, 'logs', `${spec.id}.log`)}\n`);
    }
    return { children, close: async () => { await stopChildren(children); await Promise.all(files.map(f => f.close())); } };
  } catch (error) {
    await stopChildren(children); await Promise.all(files.map(f => f.close())); throw error;
  }
}
