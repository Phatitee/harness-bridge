import { parseArgs } from 'node:util';
import { PROVIDERS } from './config.mjs';
import { usage } from './errors.mjs';

const string = { type: 'string' }; const boolean = { type: 'boolean' };
const flags = {
  setup: { providers: string, attach: boolean, 'no-login': boolean, model: string, integrate: boolean },
  login: { device: boolean, 'no-browser': boolean },
  logout: {}, accounts: {}, start: {}, status: {}, doctor: {}, models: { refresh: boolean },
  run: { provider: string, model: string }, integrate: { remove: boolean },
};
export function parseCommand(argv) {
  const command = !argv.length || argv[0].startsWith('-') ? 'start' : argv[0];
  if (!Object.hasOwn(flags, command)) throw usage(`Unknown command: ${command}`);
  const options = { ...flags[command], help: boolean, version: boolean, json: boolean };
  let parsed;
  try { parsed = parseArgs({ args: argv[0] === command ? argv.slice(1) : argv, options, strict: true, allowPositionals: true }); }
  catch (error) { throw usage(`${error.message} Valid flags for ${command}: ${Object.keys(options).map(x => '--' + x).join(', ')}`); }
  const [provider, ...extra] = parsed.positionals;
  const providerCommands = ['login', 'logout', 'models'];
  if (extra.length || (provider && !providerCommands.includes(command))) throw usage(`Unexpected argument for ${command}.`);
  if (provider && !PROVIDERS.includes(provider)) throw usage(`Unknown provider: ${provider}. Choose ${PROVIDERS.join(', ')}.`);
  if (parsed.values.provider && !PROVIDERS.includes(parsed.values.provider)) throw usage('Invalid --provider. Choose copilot, codex or agy.');
  if (parsed.values.model && !/^(copilot|codex|agy)\/.+/.test(parsed.values.model)) throw usage('--model requires a namespaced provider/model ID.');
  if (parsed.values.model && parsed.values.provider && !parsed.values.model.startsWith(parsed.values.provider + '/')) throw usage('--model and --provider disagree.');
  if (parsed.values.providers && parsed.values.providers.split(',').some(x => !PROVIDERS.includes(x))) throw usage('--providers expects a comma-separated subset of copilot,codex,agy.');
  if (parsed.values.providers && parsed.values.model && !parsed.values.providers.split(',').includes(parsed.values.model.split('/')[0])) throw usage('--model must belong to one of the selected --providers.');
  return { command, provider, values: parsed.values };
}
export function help(command) {
  const examples = {
    setup: 'proxyup setup --providers copilot,codex\nproxyup setup --providers agy --attach --no-login',
    login: 'proxyup login copilot\nproxyup login codex --device\nproxyup login agy --no-browser',
    logout: 'proxyup logout agy', models: 'proxyup models\nproxyup models codex --refresh',
    run: 'proxyup run\nproxyup run --provider codex\nproxyup run --model copilot/claude-route-MODEL_ID',
    integrate: 'proxyup integrate\nproxyup integrate --remove',
  };
  return {
    description: 'Local provider gateway for Claude Code. Start runs in the foreground; Ctrl-C stops owned processes.',
    commands: Object.keys(flags).join(', '),
    command,
    flags: Object.keys({ ...flags[command], help: boolean, version: boolean, json: boolean }).map(x => '--' + x).join(', '),
    examples: examples[command] || `proxyup ${command}`,
  };
}
