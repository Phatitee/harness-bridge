import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, writeFile, chmod, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GatewayError } from './errors.mjs';

export function buildClaudeSettings(config, secrets, models, model) {
  return {
    env: {
      ANTHROPIC_BASE_URL: `http://${config.gateway.host}:${config.gateway.port}`,
      ANTHROPIC_AUTH_TOKEN: secrets.clientKey,
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
      // Keep internal aliases/subagents on the selected route as well.
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
    },
    model,
    modelPicker: { replaceBuiltInOptions: true, options: models.map(m => ({ model: m.id, label: m.display_name, description: `From ${m.provider}` })) },
  };
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export async function installLauncher({ remove = false, directory = path.join(os.homedir(), '.local', 'bin') } = {}) {
  if (process.platform === 'win32') throw new GatewayError('PLATFORM', 'Launcher installation currently supports macOS/Linux. Use proxyup run instead.');
  const file = path.join(directory, 'claude-gateway');
  const entry = fileURLToPath(new URL('../bin/proxyup.mjs', import.meta.url));
  const body = `#!/bin/sh\n# managed-by: claude-provider-gateway\nexec ${quote(process.execPath)} ${quote(entry)} run "$@"\n`;
  let old;
  try { old = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (old && !old.includes('# managed-by: claude-provider-gateway')) throw new GatewayError('FILE_EXISTS', 'claude-gateway exists and is not managed by this project.');
  if (remove) { if (old) await unlink(file); return { launcher: file, state: 'removed' }; }
  await mkdir(directory, { recursive: true });
  if (old !== body) await writeFile(file, body, { mode: 0o755 });
  await chmod(file, 0o755);
  return { launcher: file, state: old === body ? 'unchanged' : 'installed', help: 'Add the launcher directory to PATH, then run claude-gateway. Standard claude is unchanged.' };
}
