import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import type { QuotaConfig } from './quotaConfigs';

const inFlightQuotaRequests = new Map<string, Promise<unknown>>();

export function fetchQuotaDeduplicated<TState, TData>(
  config: QuotaConfig<TState, TData>,
  file: AuthFileItem,
  t: TFunction
): Promise<TData> {
  const key = `${config.type}:${file.name}`;
  const existing = inFlightQuotaRequests.get(key);
  if (existing) return existing as Promise<TData>;

  const request = config.fetchQuota(file, t).finally(() => {
    if (inFlightQuotaRequests.get(key) === request) {
      inFlightQuotaRequests.delete(key);
    }
  });
  inFlightQuotaRequests.set(key, request);
  return request;
}
