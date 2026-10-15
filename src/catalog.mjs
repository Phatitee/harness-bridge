import { backendFor, backendKey, PROVIDERS } from './config.mjs';
import { GatewayError } from './errors.mjs';

export function normalizeModels(provider, models) {
  const unique = new Map();
  for (const model of models) {
    if (typeof model?.id !== 'string' || !model.id || /embedding|(?:^|[-_])image(?:[-_]|$)|trajectory-compaction|auto-review/i.test(model.id)) continue;
    const alias = model.id.startsWith('claude-') ? model.id : `claude-route-${model.id}`;
    unique.set(model.id, { id: `${provider}/${alias}`, object: 'model', provider, upstreamModel: model.id, display_name: `[${provider}] ${model.display_name || model.name || model.id}`, capability: 'unknown' });
  }
  return [...unique.values()];
}
export function classifyModel(model, config) {
  const explicit = ['codex', 'agy'].filter(id => config.providers[id].modelIds.includes(model.id));
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) return null;
  const owner = String(model.provider || model.owned_by || '').toLowerCase();
  if (['codex', 'openai'].includes(owner)) return 'codex';
  if (['agy', 'antigravity', 'google', 'anthropic'].includes(owner)) return 'agy';
  return null;
}
export function resolveRoute(id, models, config) {
  const provider = typeof id === 'string' ? id.split('/')[0] : '';
  if (!PROVIDERS.includes(provider)) throw new GatewayError('INVALID_MODEL', 'A namespaced provider/model is required.');
  if (!config.providers[provider].enabled) throw new GatewayError('PROVIDER_DISABLED', `Provider ${provider} is disabled.`, `Run proxyup login ${provider}.`);
  const model = models.find(m => m.id === id);
  if (!model) throw new GatewayError('MODEL_UNAVAILABLE', 'The requested model is not in the current catalog.', 'Run proxyup models --refresh and choose an available ID.');
  return model;
}
export function createCatalog(config, secrets, { fetchImpl = fetch, now = Date.now, env = process.env, ttlMs = 60000 } = {}) {
  let updatedAt = 0; let inflight; let models = [];
  const status = Object.fromEntries(PROVIDERS.map(id => [id, { state: config.providers[id].enabled ? 'unavailable' : 'disabled', count: 0 }]));
  async function refresh({ force = false } = {}) {
    if (inflight) return inflight;
    if (!force && updatedAt && now() - updatedAt < ttlMs) return models;
    inflight = (async () => {
      const wanted = [...new Set(PROVIDERS.filter(id => config.providers[id].enabled).map(backendFor))];
      await Promise.all(wanted.map(async backend => {
        const ids = PROVIDERS.filter(id => config.providers[id].enabled && backendFor(id) === backend);
        try {
          const key = backendKey(config, secrets, backend, env);
          const response = await fetchImpl(`${config.backends[backend].url}/v1/models`, { headers: key ? { authorization: `Bearer ${key}`, 'x-api-key': key } : {}, signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new GatewayError(response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED' : 'BACKEND_UNAVAILABLE', 'Catalog unavailable.');
          const data = (await response.json()).data;
          if (!Array.isArray(data)) throw new Error('Invalid catalog');
          models = models.filter(m => !ids.includes(m.provider));
          for (const id of ids) {
            const subset = backend === 'copilot' ? data : data.filter(m => classifyModel(m, config) === id);
            const normalized = normalizeModels(id, subset);
            models.push(...normalized);
            status[id] = { state: normalized.length ? 'ready' : 'catalog-empty', count: normalized.length, stale: false };
          }
        } catch (error) {
          for (const id of ids) status[id] = { state: error.code === 'AUTH_REQUIRED' ? 'needs-login' : 'unavailable', count: models.filter(m => m.provider === id).length, stale: models.some(m => m.provider === id) };
        }
      }));
      updatedAt = now();
      return models.slice().sort((a, b) => a.id.localeCompare(b.id));
    })();
    try { return await inflight; } finally { inflight = null; }
  }
  return { refresh, status: () => structuredClone(status), invalidate: () => { updatedAt = 0; } };
}
