import { create } from 'zustand';
import { usageApi } from '@/services/api';
import type { UsageQueryRange, UsageRevision } from '@/services/api/usage';
import { useAuthStore } from '@/stores/useAuthStore';
import { collectUsageDetails, computeKeyStatsFromDetails, type KeyStats, type UsageDetail } from '@/utils/usage';
import i18n from '@/i18n';

export const USAGE_STATS_STALE_TIME_MS = 240_000;

export type LoadUsageStatsOptions = {
  force?: boolean;
  staleTimeMs?: number;
  silent?: boolean;
  range?: UsageQueryRange;
};

type UsageStatsSnapshot = Record<string, unknown>;

type UsageStatsState = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  revision: UsageRevision | null;
  scopeKey: string;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  checkUsageStats: (range?: UsageQueryRange) => Promise<void>;
  clearUsageStats: () => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

let usageRequestToken = 0;
let inFlightUsageRequest: { id: number; scopeKey: string; promise: Promise<void> } | null = null;

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : i18n.t('usage_stats.loading_error');

const revisionsMatch = (left: UsageRevision | null, right: UsageRevision | null) =>
  left !== null &&
  right !== null &&
  left.latest_id === right.latest_id &&
  left.total_rows === right.total_rows;

/**
 * Background usage refreshes can contain thousands of request details. Let the
 * browser handle that transformation when it has an idle slice so polling does
 * not compete with pointer/keyboard input. The timeout keeps the data fresh in
 * browsers that remain continuously busy.
 */
const runWhenIdle = async <T>(task: () => T): Promise<T> => {
  if (typeof window === 'undefined') {
    return task();
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };

  if (typeof idleWindow.requestIdleCallback === 'function') {
    return new Promise<T>((resolve) => {
      idleWindow.requestIdleCallback(() => resolve(task()), { timeout: 1_000 });
    });
  }

  return new Promise<T>((resolve) => {
    window.setTimeout(() => resolve(task()), 0);
  });
};

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  usage: null,
  keyStats: createEmptyKeyStats(),
  usageDetails: [],
  loading: false,
  error: null,
  lastRefreshedAt: null,
  revision: null,
  scopeKey: '',

  loadUsageStats: async (options = {}) => {
    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? USAGE_STATS_STALE_TIME_MS;
    const range = options.range ?? 'all';
    const { apiBase = '', managementKey = '' } = useAuthStore.getState();
    const scopeKey = `${apiBase}::${managementKey}::${range}`;
    const state = get();
    const scopeChanged = state.scopeKey !== scopeKey;
    const silent = options.silent === true && state.usage !== null && !scopeChanged;

    // 先复用同源 in-flight 请求，避免多个页面同时发起重复 /usage。
    if (inFlightUsageRequest && inFlightUsageRequest.scopeKey === scopeKey) {
      await inFlightUsageRequest.promise;
      return;
    }

    // 连接目标变化时，旧请求结果必须失效。
    if (inFlightUsageRequest && inFlightUsageRequest.scopeKey !== scopeKey) {
      usageRequestToken += 1;
      inFlightUsageRequest = null;
    }

    const fresh =
      !scopeChanged &&
      state.lastRefreshedAt !== null &&
      Date.now() - state.lastRefreshedAt < staleTimeMs;

    if (!force && fresh) {
      return;
    }

    if (scopeChanged) {
      set({
        usage: null,
        keyStats: createEmptyKeyStats(),
        usageDetails: [],
        error: null,
        lastRefreshedAt: null,
        revision: null,
        scopeKey
      });
    }

    const requestId = (usageRequestToken += 1);
    set({ loading: silent ? state.loading : true, error: null, scopeKey });

    const requestPromise = (async () => {
      try {
        const usageResponse = await usageApi.getUsage(range);
        const rawUsage = usageResponse?.usage ?? usageResponse;
        const usage =
          rawUsage && typeof rawUsage === 'object' ? (rawUsage as UsageStatsSnapshot) : null;

        if (requestId !== usageRequestToken) return;

        const applyUsageResponse = () => {
          // A logout, scope switch, or newer request may have invalidated the
          // snapshot while it was waiting for an idle slice.
          if (requestId !== usageRequestToken) return;

          const usageDetails = collectUsageDetails(usage);
          set({
            usage,
            keyStats: computeKeyStatsFromDetails(usageDetails),
            usageDetails,
            loading: false,
            error: null,
            lastRefreshedAt: Date.now(),
            revision: usageResponse?.revision ?? null,
            scopeKey
          });
        };

        if (silent) {
          await runWhenIdle(applyUsageResponse);
        } else {
          applyUsageResponse();
        }
      } catch (error: unknown) {
        if (requestId !== usageRequestToken) return;
        const message = getErrorMessage(error);
        set({
          loading: false,
          error: message,
          scopeKey
        });
        throw new Error(message);
      } finally {
        if (inFlightUsageRequest?.id === requestId) {
          inFlightUsageRequest = null;
        }
      }
    })();

    inFlightUsageRequest = { id: requestId, scopeKey, promise: requestPromise };
    await requestPromise;
  },

  checkUsageStats: async (range = 'all') => {
    const { apiBase = '', managementKey = '' } = useAuthStore.getState();
    const scopeKey = `${apiBase}::${managementKey}::${range}`;
    const state = get();

    if (state.scopeKey !== scopeKey || state.usage === null) {
      await state.loadUsageStats({ force: true, staleTimeMs: 0, range });
      return;
    }

    const revision = await usageApi.getUsageRevision();
    const current = get();
    if (current.scopeKey !== scopeKey) {
      return;
    }
    if (!revisionsMatch(current.revision, revision)) {
      await current.loadUsageStats({ force: true, staleTimeMs: 0, silent: true, range });
    }
  },

  clearUsageStats: () => {
    usageRequestToken += 1;
    inFlightUsageRequest = null;
    set({
      usage: null,
      keyStats: createEmptyKeyStats(),
      usageDetails: [],
      loading: false,
      error: null,
      lastRefreshedAt: null,
      revision: null,
      scopeKey: ''
    });
  }
}));
