// A small TOON encoder for CLI objects, scalar arrays and uniform scalar tables.
// No decoder or general-purpose serialization API is exposed.
const scalar = value => JSON.stringify(value ?? null);
export function toon(object, depth = 0) {
  const pad = '  '.repeat(depth);
  return Object.entries(object).map(([key, value]) => {
    const name = /^[A-Za-z_][\w-]*$/.test(key) ? key : scalar(key);
    if (Array.isArray(value)) {
      if (!value.length) return `${pad}${name}[0]:`;
      if (value.every(v => v === null || typeof v !== 'object')) return `${pad}${name}[${value.length}]: ${value.map(scalar).join(',')}`;
      const keys = Object.keys(value[0]);
      if (value.every(v => v && !Array.isArray(v) && Object.keys(v).join() === keys.join() && Object.values(v).every(x => x === null || typeof x !== 'object'))) {
        return `${pad}${name}[${value.length}]{${keys.join(',')}}:\n${value.map(v => `${pad}  ${keys.map(k => scalar(v[k])).join(',')}`).join('\n')}`;
      }
      return `${pad}${name}[${value.length}]:\n${value.map(v => `${pad}  -\n${toon(v, depth + 2)}`).join('\n')}`;
    }
    if (value && typeof value === 'object') return `${pad}${name}:\n${toon(value, depth + 1)}`;
    return `${pad}${name}: ${scalar(value)}`;
  }).join('\n');
}
export function output(value, json = false) { process.stdout.write((json ? JSON.stringify(value, null, 2) : toon(value)) + '\n'); }
