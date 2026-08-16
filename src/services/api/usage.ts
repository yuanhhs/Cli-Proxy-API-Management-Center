/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export type UsageQueryRange = '24h' | '7d' | '30d' | 'all';

export interface UsageRevision {
  latest_id: number;
  total_rows: number;
}

export interface UsageResponse {
  usage?: Record<string, unknown>;
  failed_requests?: number;
  revision?: UsageRevision;
  [key: string]: unknown;
}

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: (range: UsageQueryRange = 'all') =>
    apiClient.get<UsageResponse>('/usage', {
      timeout: USAGE_TIMEOUT_MS,
      params: range === 'all' ? undefined : { range },
    }),

  /**
   * 获取轻量版本标记，仅在数据变化后重新拉取完整统计
   */
  getUsageRevision: () =>
    apiClient.get<UsageRevision>('/usage/revision', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS });
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  }
};
