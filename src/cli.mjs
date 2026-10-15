import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { readFile, mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCommand, help } from './args.mjs';
import { appHome, readConfig, saveConfig, ensureSecrets, PROVIDERS, backendFor } from './config.mjs';
import { GatewayError, usage } from './errors.mjs';
import { loginCommand, writeBackendConfig } from './adapters.mjs';
import { runProcess } from './processes.mjs';
import { startRuntime, fetchGateway } from './runtime.mjs';
import { createCatalog, resolveRoute } from './catalog.mjs';
import { buildClaudeSettings, installLauncher } from './claude.mjs';
import { output } from './output.mjs';

async function ask(message) {
  if (!stdin.isTTY || !stderr.isTTY) throw usage('Interactive input is unavailable; specify all required arguments/flags.');
  const rl = createInterface({ input: stdin, output: stderr });
  try { return (await rl.question(message)).trim(); } finally { rl.close(); }
}
async function chooseProvider() {
  const answer = await ask('Provider (copilot/codex/agy): ');
  if (!PROVIDERS.includes(answer)) throw usage('Choose copilot, codex or agy.');
  return answer;
}
async function login(provider, config, home, secrets, values) {
  const backend = backendFor(provider);
  if (config.backends[backend].mode === 'attach' && provider !== 'copilot') throw new GatewayError('EXTERNAL_AUTH', 'Attached CLIProxy credentials are managed by its existing installation.', 'Login using that installation, then run proxyup models --refresh.');
  const spec = loginCommand(provider, config, home, { device: values.device, noBrowser: values['no-browser'] });
  if (backend === 'cliproxy') await writeBackendConfig(config, home, secrets);
  process.stderr.write(`Starting ${provider} login. Browser/device interaction is handled by its adapter.\n`);
  await runProcess(spec.command, spec.args, { stdio: ['inherit', 2, 2] });
  config.providers[provider].enabled = true;
  config.providers[provider].accountRevision++;
  await saveConfig(home, config);
}
async function availableBinary(command) {
  const candidates = command.includes(path.sep) ? [command] : (process.env.PATH || '').split(path.delimiter).map(p => path.join(p, command));
  for (const file of candidates) { try { await access(file, 1); return true; } catch {} }
  return false;
}
async function loadSecrets(home) {
  try { return JSON.parse(await readFile(path.join(home, 'secrets.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { clientKey: '', backendKey: '' }; throw error; }
}
export async function main(argv) {
  const { command, provider: positional, values } = parseCommand(argv);
  if (values.version) { output({ version: '0.1.0' }, values.json); return; }
  if (values.help) { output(help(command), values.json); return; }
  const home = appHome(); const config = await readConfig(home);
  const report = value => output(value, values.json);
  if (command === 'integrate') { report(await installLauncher({ remove: values.remove })); return; }
  if (['status', 'doctor', 'accounts'].includes(command)) {
    const secrets = await loadSecrets(home);
    const catalog = createCatalog(config, secrets); await catalog.refresh({ force: true });
    const state = catalog.status();
    const providers = PROVIDERS.map(id => ({ provider: id, status: state[id].state, models: state[id].count, revision: config.providers[id].accountRevision }));
    const result = { home, providers };
    if (command === 'doctor') result.executables = await Promise.all(['copilot', 'cliproxy'].map(async name => ({ backend: name, command: config.backends[name].command, available: await availableBinary(config.backends[name].command) })));
    result.help = 'proxyup setup --providers copilot,codex,agy; proxyup start; proxyup run';
    report(result); return;
  }
  if (command === 'logout') {
    const provider = positional || await chooseProvider();
    config.providers[provider].enabled = false; config.providers[provider].accountRevision++;
    if (config.defaultModel?.startsWith(provider + '/')) config.defaultModel = null;
    await saveConfig(home, config);
    report({ provider, state: 'disconnected', help: 'Restart proxyup to apply. Adapter credentials are retained; this does not revoke the provider account.' }); return;
  }
  if (command === 'models') {
    const secrets = await loadSecrets(home);
    const catalog = createCatalog(config, secrets);
    const rows = await catalog.refresh({ force: true });
    report({ models: rows.filter(m => !positional || m.provider === positional).map(m => ({ id: m.id, name: m.display_name, capability: m.capability })), providers: catalog.status(), help: 'Use proxyup run --model <id>. Empty catalogs require a running backend and an authorized account.' }); return;
  }
  if (command === 'setup') {
    const ids = values.providers ? [...new Set(values.providers.split(','))] : [await chooseProvider()];
    // setup is additive; providers not selected retain their configuration.
    for (const id of ids) {
      config.providers[id].enabled = true;
      if (values.attach) config.backends[backendFor(id)].mode = 'attach';
    }
    const secrets = await ensureSecrets(home);
    if (!values['no-login']) for (const id of ids) await login(id, config, home, secrets, {});
    await saveConfig(home, config);
    if (values['no-login']) {
      if (values.model) config.defaultModel = values.model;
      await saveConfig(home, config);
      report({ state: 'configured-unverified', providers: ids, help: 'Run proxyup login <provider> if needed, then proxyup start and proxyup run.' });
    } else {
      const runtime = await startRuntime(config, home, secrets);
      try {
        const rows = await runtime.catalog.refresh();
        if (!rows.length) throw new GatewayError('CATALOG_EMPTY', 'Login finished, but no routable models were discovered.', 'Run proxyup doctor; inspect backend metadata and provider modelIds overrides.');
        let selected = values.model;
        if (!selected) {
          rows.forEach((m, i) => stderr.write(`${i + 1}. ${m.display_name}\n`));
          const number = Number(await ask('Default model number: '));
          if (!Number.isInteger(number) || number < 1 || number > rows.length) throw usage('Invalid model number.');
          selected = rows[number - 1].id;
        }
        resolveRoute(selected, rows, config); config.defaultModel = selected; await saveConfig(home, config);
        report({ state: 'ready', model: selected, help: 'Run proxyup start, then proxyup run in another terminal.' });
      } finally { await runtime.close(); }
    }
    if (values.integrate) report(await installLauncher());
    return;
  }
  if (command === 'login') {
    const provider = positional || await chooseProvider();
    // Validate incompatible flags before creating local state.
    loginCommand(provider, config, home, { device: values.device, noBrowser: values['no-browser'] });
    const secrets = await ensureSecrets(home);
    await login(provider, config, home, secrets, values);
    report({ provider, state: 'authenticated-awaiting-validation', revision: config.providers[provider].accountRevision, help: 'Restart proxyup, then run proxyup models --refresh to validate access.' }); return;
  }
  if (!PROVIDERS.some(id => config.providers[id].enabled)) throw new GatewayError('NOT_CONFIGURED', 'No providers are enabled.', 'Run proxyup setup --providers copilot,codex,agy.');
  if (command === 'start') {
    const secrets = await ensureSecrets(home);
    const runtime = await startRuntime(config, home, secrets);
    report({ state: 'listening', url: `http://${config.gateway.host}:${config.gateway.port}`, providers: runtime.catalog.status(), help: 'Run proxyup run in another terminal. Ctrl-C stops this gateway and its owned backends.' });
    await new Promise(resolve => {
      const finish = () => { process.removeListener('SIGINT', finish); process.removeListener('SIGTERM', finish); resolve(); };
      process.once('SIGINT', finish); process.once('SIGTERM', finish);
      for (const child of runtime.children) child.once('exit', finish);
    });
    await runtime.close(); return;
  }
  if (command === 'run') {
    const secrets = await loadSecrets(home);
    let health = await fetchGateway(config, secrets, '/health');
    if (health.service !== 'claude-provider-gateway') throw new GatewayError('GATEWAY_IDENTITY', 'The endpoint is not this project’s gateway.');
    let rows = (await fetchGateway(config, secrets)).data;
    health = await fetchGateway(config, secrets, '/health');
    // Never offer a stale/unready provider as a new selection.
    rows = rows.filter(m => health.providers[m.provider]?.state === 'ready');
    if (values.provider) rows = rows.filter(m => m.provider === values.provider);
    if (!rows.length) throw new GatewayError('CATALOG_EMPTY', 'No ready models are available.', 'Run proxyup models --refresh and proxyup doctor.');
    let model = values.model || (config.defaultModel && rows.some(m => m.id === config.defaultModel) ? config.defaultModel : null);
    if (!model) {
      if (config.defaultModel && !values.provider) throw new GatewayError('MODEL_UNAVAILABLE', 'The saved default model is unavailable.', 'Run proxyup run --model <available-id>.');
      rows.forEach((m, i) => stderr.write(`${i + 1}. ${m.display_name}\n`));
      const number = Number(await ask('Model number: '));
      if (!Number.isInteger(number) || number < 1 || number > rows.length) throw usage('Invalid model number.');
      model = rows[number - 1].id;
    }
    resolveRoute(model, rows, config);
    // Picker includes all ready providers, even when --provider selects the startup default.
    const all = (await fetchGateway(config, secrets)).data.filter(m => health.providers[m.provider]?.state === 'ready');
    const settings = buildClaudeSettings(config, secrets, all, model);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'proxyup-claude-'));
    const file = path.join(dir, 'settings.json');
    try {
      await writeFile(file, JSON.stringify(settings), { mode: 0o600 });
      await runProcess('claude', ['--settings', file, '--model', model], { timeoutMs: 86400000, env: { ...process.env, ...settings.env } });
    } finally { await rm(dir, { recursive: true, force: true }); }
    return;
  }
}
