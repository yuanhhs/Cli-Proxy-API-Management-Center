import { apiClient } from './client';

export interface OpenCodeQuotaRequest {
  name: string;
}

export interface OpenCodeQuotaWindow {
  used_percent: number;
  remaining_percent: number;
  status: string;
  reset_in_seconds: number;
}

export interface OpenCodeQuotaResponse {
  rolling: OpenCodeQuotaWindow;
  weekly: OpenCodeQuotaWindow;
  monthly: OpenCodeQuotaWindow;
  fetched_at: string;
}

export const openCodeQuotaApi = {
  fetch: (request: OpenCodeQuotaRequest) =>
    apiClient.post<OpenCodeQuotaResponse>('/opencode/quota', request),
};
