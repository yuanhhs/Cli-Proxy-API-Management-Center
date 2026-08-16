import type { ModelPrice } from './usage';

const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const MODELS_DEV_CACHE_KEY = 'cli-proxy-models-dev-official-prices-v2';
export const MODELS_DEV_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const OFFICIAL_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'moonshotai',
  'xiaomi',
  'alibaba',
  'zai',
  'zhipuai',
  'minimax',
  'mistral',
  'cohere',
] as const;

type OfficialProvider = (typeof OFFICIAL_PROVIDERS)[number];
type ProviderCatalog = Record<string, ModelPrice>;

interface OfficialCatalogCache {
  version: 2;
  fetchedAt: number;
  providers: Partial<Record<OfficialProvider, ProviderCatalog>>;
}

export interface OfficialModelPricesResult {
  prices: Record<string, ModelPrice>;
  unmatchedModels: string[];
  fetchedAt: number;
  expiresAt: number;
  source: 'network' | 'cache' | 'stale-cache';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeModelId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^models\//, '');

const modelTail = (value: string) => {
  const normalized = normalizeModelId(value);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const readPrice = (value: unknown): ModelPrice | null => {
  if (!isRecord(value)) return null;
  const input = Number(value.input);
  const output = Number(value.output);
  const cacheRead = Number(value.cache_read);
  const cacheWrite = Number(value.cache_write);
  if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
    return null;
  }
  return {
    prompt: input,
    completion: output,
    cache: Number.isFinite(cacheRead) && cacheRead >= 0 ? cacheRead : input,
    cacheWrite: Number.isFinite(cacheWrite) && cacheWrite >= 0 ? cacheWrite : input,
  };
};

const registerAlias = (catalog: ProviderCatalog, alias: unknown, price: ModelPrice) => {
  if (typeof alias !== 'string') return;
  const normalized = normalizeModelId(alias);
  if (!normalized) return;
  catalog[normalized] = price;
  const tail = modelTail(normalized);
  if (tail && !(tail in catalog)) catalog[tail] = price;
};

const parseOfficialCatalog = (payload: unknown): OfficialCatalogCache['providers'] => {
  if (!isRecord(payload)) throw new Error('Invalid models.dev response');
  const providers: OfficialCatalogCache['providers'] = {};

  OFFICIAL_PROVIDERS.forEach((providerId) => {
    const provider = isRecord(payload[providerId]) ? payload[providerId] : null;
    const models = provider && isRecord(provider.models) ? provider.models : null;
    if (!models) return;

    const catalog: ProviderCatalog = {};
    Object.entries(models).forEach(([modelKey, rawModel]) => {
      const model = isRecord(rawModel) ? rawModel : null;
      const price = readPrice(model?.cost);
      if (!price) return;
      registerAlias(catalog, modelKey, price);
      registerAlias(catalog, model?.id, price);
    });
    providers[providerId] = catalog;
  });

  return providers;
};

const normalizeStoredPrice = (value: unknown): ModelPrice | null => {
  if (!isRecord(value)) return null;
  const prompt = Number(value.prompt);
  const completion = Number(value.completion);
  const cache = Number(value.cache);
  const cacheWrite = Number(value.cacheWrite);
  if (
    !Number.isFinite(prompt) ||
    prompt < 0 ||
    !Number.isFinite(completion) ||
    completion < 0 ||
    !Number.isFinite(cache) ||
    cache < 0
  ) {
    return null;
  }
  return {
    prompt,
    completion,
    cache,
    cacheWrite: Number.isFinite(cacheWrite) && cacheWrite >= 0 ? cacheWrite : prompt,
  };
};

const readCatalogCache = (): OfficialCatalogCache | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const parsed: unknown = JSON.parse(localStorage.getItem(MODELS_DEV_CACHE_KEY) || 'null');
    if (!isRecord(parsed) || parsed.version !== 2) return null;
    const rawProviders = parsed.providers;
    if (!isRecord(rawProviders)) return null;
    const fetchedAt = Number(parsed.fetchedAt);
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;

    const providers: OfficialCatalogCache['providers'] = {};
    OFFICIAL_PROVIDERS.forEach((providerId) => {
      const rawCatalog = isRecord(rawProviders[providerId]) ? rawProviders[providerId] : null;
      if (!rawCatalog) return;
      const catalog: ProviderCatalog = {};
      Object.entries(rawCatalog).forEach(([alias, rawPrice]) => {
        const price = normalizeStoredPrice(rawPrice);
        if (price) catalog[alias] = price;
      });
      providers[providerId] = catalog;
    });
    return { version: 2, fetchedAt, providers };
  } catch {
    return null;
  }
};

const saveCatalogCache = (cache: OfficialCatalogCache) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MODELS_DEV_CACHE_KEY, JSON.stringify(cache));
    }
  } catch {
    // A failed cache write should not discard prices already loaded from the network.
  }
};

const inferOfficialProvider = (modelName: string): OfficialProvider | null => {
  const normalized = normalizeModelId(modelName);
  const explicitProvider = normalized.split('/')[0] as OfficialProvider;
  if (OFFICIAL_PROVIDERS.includes(explicitProvider)) return explicitProvider;
  const target = modelTail(normalized);
  if (/^(gpt-|chatgpt-|codex-|o[134](?:-|$))/.test(target)) return 'openai';
  if (/^claude-/.test(target)) return 'anthropic';
  if (/^(gemini-|gemma-|veo-|imagen-|lyria-)/.test(target)) return 'google';
  if (/^grok-/.test(target)) return 'xai';
  if (/^deepseek-/.test(target)) return 'deepseek';
  if (/^(kimi-|moonshot-)/.test(target)) return 'moonshotai';
  if (/^(mimo-|xiaomi-)/.test(target)) return 'xiaomi';
  if (/^(qwen|qwq|wan\d|alibaba-)/.test(target)) return 'alibaba';
  if (/^(glm-|zai-)/.test(target)) return 'zai';
  if (/^minimax-/.test(target)) return 'minimax';
  if (/^(mistral-|codestral-|devstral-|ministral-|pixtral-)/.test(target)) return 'mistral';
  if (/^(command-|embed-|rerank-)/.test(target)) return 'cohere';
  return null;
};

const samePrice = (left: ModelPrice, right: ModelPrice) =>
  left.prompt === right.prompt &&
  left.completion === right.completion &&
  left.cache === right.cache &&
  left.cacheWrite === right.cacheWrite;

const resolveOfficialPrice = (
  modelName: string,
  providers: OfficialCatalogCache['providers']
): ModelPrice | null => {
  const normalized = normalizeModelId(modelName);
  const tail = modelTail(normalized);
  const preferredProvider = inferOfficialProvider(normalized);
  if (preferredProvider) {
    const preferredCatalog = providers[preferredProvider];
    const match = preferredCatalog?.[normalized] ?? preferredCatalog?.[tail];
    if (match) return match;
  }

  const matches = OFFICIAL_PROVIDERS.flatMap((providerId) => {
    const catalog = providers[providerId];
    const price = catalog?.[normalized] ?? catalog?.[tail];
    return price ? [price] : [];
  });
  if (
    matches.length === 1 ||
    (matches.length > 1 && matches.every((price) => samePrice(price, matches[0])))
  ) {
    return matches[0];
  }
  return null;
};

const buildResult = (
  modelNames: string[],
  cache: OfficialCatalogCache,
  source: OfficialModelPricesResult['source']
): OfficialModelPricesResult => {
  const prices: Record<string, ModelPrice> = {};
  const unmatchedModels: string[] = [];
  [...new Set(modelNames.map((name) => name.trim()).filter(Boolean))].forEach((modelName) => {
    const price = resolveOfficialPrice(modelName, cache.providers);
    if (price) prices[modelName] = price;
    else unmatchedModels.push(modelName);
  });
  return {
    prices,
    unmatchedModels,
    fetchedAt: cache.fetchedAt,
    expiresAt: cache.fetchedAt + MODELS_DEV_REFRESH_INTERVAL_MS,
    source,
  };
};

export async function loadOfficialModelPrices(
  modelNames: string[]
): Promise<OfficialModelPricesResult> {
  const cached = readCatalogCache();
  const now = Date.now();
  if (cached && now < cached.fetchedAt + MODELS_DEV_REFRESH_INTERVAL_MS) {
    return buildResult(modelNames, cached, 'cache');
  }

  try {
    const response = await fetch(MODELS_DEV_API_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-cache',
    });
    if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
    const cache: OfficialCatalogCache = {
      version: 2,
      fetchedAt: Date.now(),
      providers: parseOfficialCatalog(await response.json()),
    };
    saveCatalogCache(cache);
    return buildResult(modelNames, cache, 'network');
  } catch (error) {
    if (cached) return buildResult(modelNames, cached, 'stale-cache');
    throw error;
  }
}
