import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.filter(e => !['.git', 'node_modules'].includes(e.name)).map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name)))).flat();
}
const files = await walk('.');
for (const file of files) {
  if (file.endsWith('.mjs')) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1);
  }
  if (!file.startsWith('scripts' + path.sep)) {
    const text = await readFile(file, 'utf8');
    if (/\/Users\/[A-Za-z0-9_.-]+\/|(?:ghp_|sk-proj-)[A-Za-z0-9]{20,}/.test(text)) throw new Error(`Personal path or token-like value in ${file}`);
  }
}
console.log(`Checked ${files.length} files: syntax and personal-path/token guards passed.`);
