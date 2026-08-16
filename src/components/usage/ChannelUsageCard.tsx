import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { IconChevronDown } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types/authFile';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  formatCompactNumber,
  formatUsd,
  normalizeAuthIndex,
  normalizeUsageSourceId,
  type ModelPrice,
  type UsageDetail,
} from '@/utils/usage';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

interface UsageMetrics {
  requests: number;
  success: number;
  failure: number;
  tokens: number;
  cost: number;
}

interface MutableModel extends UsageMetrics {
  key: string;
  label: string;
}

interface MutableAccount extends UsageMetrics {
  key: string;
  label: string;
  models: Map<string, MutableModel>;
}

interface MutableChannel extends UsageMetrics {
  key: string;
  label: string;
  type: string;
  accounts: Map<string, MutableAccount>;
  models: Map<string, MutableModel>;
}

interface AccountInfo extends CredentialInfo {
  key: string;
}

export interface ChannelUsageCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  authFiles: AuthFileItem[];
  modelPrices: Record<string, ModelPrice>;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
}

const PROVIDER_LABELS: Record<string, string> = {
  antigravity: 'ANTIGRAVITY',
  anthropic: 'Claude',
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
  openai: 'OpenAI',
  qwen: 'Qwen',
  kimi: 'Kimi',
  xai: 'xAI',
  iflow: 'iFlow',
  aistudio: 'AI Studio',
  vertex: 'Vertex',
};

const emptyMetrics = (): UsageMetrics => ({
  requests: 0,
  success: 0,
  failure: 0,
  tokens: 0,
  cost: 0,
});

const readAuthFileText = (file: AuthFileItem, key: string): string => {
  const value = file[key];
  return typeof value === 'string' ? value.trim() : '';
};

const canonicalProviderType = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  return normalized === 'anthropic' ? 'claude' : normalized;
};

const providerLabel = (type: string): string => {
  const normalized = canonicalProviderType(type);
  if (PROVIDER_LABELS[normalized]) return PROVIDER_LABELS[normalized];
  if (!normalized) return 'OAuth';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const addDetailMetrics = (
  metrics: UsageMetrics,
  detail: UsageDetail,
  modelPrices: Record<string, ModelPrice>
) => {
  metrics.requests += 1;
  if (detail.failed) {
    metrics.failure += 1;
  } else {
    metrics.success += 1;
  }
  metrics.tokens += Math.max(0, extractTotalTokens(detail));
  metrics.cost += Math.max(0, calculateCost(detail, modelPrices));
};

const addModelDetail = (
  models: Map<string, MutableModel>,
  detail: UsageDetail,
  modelPrices: Record<string, ModelPrice>
) => {
  const label = detail.__modelName?.trim() || '-';
  const model =
    models.get(label) ??
    ({ key: label, label, ...emptyMetrics() } satisfies MutableModel);
  addDetailMetrics(model, detail, modelPrices);
  models.set(label, model);
};

const sortByUsage = <T extends UsageMetrics & { label: string }>(items: T[]): T[] =>
  items.sort(
    (left, right) =>
      right.tokens - left.tokens ||
      right.requests - left.requests ||
      left.label.localeCompare(right.label)
  );

const registerUnique = (
  map: Map<string, AccountInfo | null>,
  key: string,
  account: AccountInfo
) => {
  if (!key) return;
  const current = map.get(key);
  if (current === undefined || current?.key === account.key) {
    map.set(key, account);
  } else {
    map.set(key, null);
  }
};

export function ChannelUsageCard({
  usage,
  loading,
  authFiles,
  modelPrices,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
}: ChannelUsageCardProps) {
  const { t } = useTranslation();
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const showCost = Object.keys(modelPrices).length > 0;

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const { authFileMap, authFileSourceMap } = useMemo(() => {
    const byIndex = new Map<string, AccountInfo | null>();
    const bySource = new Map<string, AccountInfo | null>();

    authFiles.forEach((file) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      const type = canonicalProviderType(String(file.type || file.provider || ''));
      const label =
        readAuthFileText(file, 'email') ||
        readAuthFileText(file, 'account') ||
        readAuthFileText(file, 'label') ||
        file.name ||
        authIndex ||
        '-';
      const key = authIndex ? `auth:${authIndex}` : `auth-file:${file.name}`;
      const account: AccountInfo = { key, name: label, type };

      if (authIndex) registerUnique(byIndex, authIndex, account);
      [file.name, label, readAuthFileText(file, 'email'), readAuthFileText(file, 'account')]
        .map((candidate) => normalizeUsageSourceId(candidate))
        .filter(Boolean)
        .forEach((candidate) => registerUnique(bySource, candidate, account));
    });

    return { authFileMap: byIndex, authFileSourceMap: bySource };
  }, [authFiles]);

  const sourceDisplayAuthFileMap = useMemo(() => {
    const map = new Map<string, CredentialInfo>();
    authFileMap.forEach((account, key) => {
      if (account) map.set(key, account);
    });
    return map;
  }, [authFileMap]);

  const channels = useMemo(() => {
    const channelMap = new Map<string, MutableChannel>();

    collectUsageDetails(usage).forEach((detail) => {
      const authIndex = normalizeAuthIndex(detail.auth_index);
      const authAccount =
        (authIndex ? authFileMap.get(authIndex) : null) ??
        authFileSourceMap.get(detail.source || '') ??
        authFileSourceMap.get(normalizeUsageSourceId(detail.source)) ??
        null;
      const sourceInfo = resolveSourceDisplay(
        detail.source || '',
        detail.auth_index,
        sourceInfoMap,
        sourceDisplayAuthFileMap
      );

      const channelType = authAccount?.type || canonicalProviderType(sourceInfo.type);
      const channelKey = authAccount
        ? `auth-provider:${channelType || 'oauth'}`
        : sourceInfo.identityKey || `source:${sourceInfo.displayName}`;
      const channelLabel = authAccount
        ? providerLabel(channelType)
        : sourceInfo.displayName || providerLabel(channelType);
      const channel =
        channelMap.get(channelKey) ??
        ({
          key: channelKey,
          label: channelLabel,
          type: channelType,
          accounts: new Map<string, MutableAccount>(),
          models: new Map<string, MutableModel>(),
          ...emptyMetrics(),
        } satisfies MutableChannel);

      addDetailMetrics(channel, detail, modelPrices);
      if (authAccount) {
        const account =
          channel.accounts.get(authAccount.key) ??
          ({
            key: authAccount.key,
            label: authAccount.name,
            models: new Map<string, MutableModel>(),
            ...emptyMetrics(),
          } satisfies MutableAccount);
        addDetailMetrics(account, detail, modelPrices);
        addModelDetail(account.models, detail, modelPrices);
        channel.accounts.set(account.key, account);
      } else {
        addModelDetail(channel.models, detail, modelPrices);
      }
      channelMap.set(channel.key, channel);
    });

    return sortByUsage(Array.from(channelMap.values())).map((channel) => ({
      ...channel,
      accounts: sortByUsage(Array.from(channel.accounts.values())).map((account) => ({
        ...account,
        models: sortByUsage(Array.from(account.models.values())),
      })),
      models: sortByUsage(Array.from(channel.models.values())),
    }));
  }, [authFileMap, authFileSourceMap, modelPrices, sourceDisplayAuthFileMap, sourceInfoMap, usage]);

  const toggleSetValue = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    key: string
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const metricCells = (metrics: UsageMetrics) => {
    const successRate = metrics.requests > 0 ? (metrics.success / metrics.requests) * 100 : 100;
    return (
      <>
        <span className={styles.channelUsageMetric}>
          <strong>{metrics.requests.toLocaleString()}</strong>
          <small
            title={t('usage_stats.channel_usage_request_breakdown', {
              success: metrics.success,
              failure: metrics.failure,
            })}
          >
            {metrics.success}/{metrics.failure}
          </small>
        </span>
        <span className={styles.channelUsageMetric}>
          <strong>{formatCompactNumber(metrics.tokens)}</strong>
        </span>
        <span className={styles.channelUsageMetric}>
          <strong>{successRate.toFixed(1)}%</strong>
        </span>
        {showCost && (
          <span className={styles.channelUsageMetric}>
            <strong>{formatUsd(metrics.cost)}</strong>
          </span>
        )}
      </>
    );
  };

  return (
    <Card title={t('usage_stats.channel_usage_title')}>
      {loading && !usage ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : channels.length > 0 ? (
        <div className={styles.channelUsageScroller}>
          <div className={styles.channelUsageTable}>
            <div
              className={`${styles.channelUsageHeader} ${showCost ? '' : styles.channelUsageWithoutCost}`}
            >
              <span>{t('usage_stats.channel_usage_item')}</span>
              <span>{t('usage_stats.requests_count')}</span>
              <span>{t('usage_stats.tokens_count')}</span>
              <span>{t('usage_stats.success_rate')}</span>
              {showCost && <span>{t('usage_stats.total_cost')}</span>}
            </div>
            {channels.map((channel, channelIndex) => {
              const channelOpen = expandedChannels.has(channel.key);
              const channelPanelId = `channel-usage-${channelIndex}`;
              const hasAccounts = channel.accounts.length > 0;
              const childModels = hasAccounts ? [] : channel.models;
              return (
                <div className={styles.channelUsageGroup} key={channel.key}>
                  <button
                    type="button"
                    className={`${styles.channelUsageRow} ${styles.channelUsageChannelRow} ${showCost ? '' : styles.channelUsageWithoutCost}`}
                    onClick={() => toggleSetValue(setExpandedChannels, channel.key)}
                    aria-expanded={channelOpen}
                    aria-controls={channelPanelId}
                  >
                    <span className={styles.channelUsageName}>
                      <IconChevronDown
                        size={16}
                        className={`${styles.channelUsageChevron} ${channelOpen ? styles.channelUsageChevronOpen : ''}`}
                      />
                      <strong>{channel.label}</strong>
                      {hasAccounts && (
                        <small className={styles.channelUsageBadge}>
                          {t('usage_stats.channel_usage_accounts', {
                            count: channel.accounts.length,
                          })}
                        </small>
                      )}
                    </span>
                    {metricCells(channel)}
                  </button>
                  {channelOpen && (
                    <div id={channelPanelId}>
                      {channel.accounts.map((account, accountIndex) => {
                        const accountCompositeKey = `${channel.key}:${account.key}`;
                        const accountOpen = expandedAccounts.has(accountCompositeKey);
                        const accountPanelId = `${channelPanelId}-account-${accountIndex}`;
                        return (
                          <div key={account.key}>
                            <button
                              type="button"
                              className={`${styles.channelUsageRow} ${styles.channelUsageAccountRow} ${showCost ? '' : styles.channelUsageWithoutCost}`}
                              onClick={() =>
                                toggleSetValue(setExpandedAccounts, accountCompositeKey)
                              }
                              aria-expanded={accountOpen}
                              aria-controls={accountPanelId}
                            >
                              <span className={styles.channelUsageName}>
                                <IconChevronDown
                                  size={15}
                                  className={`${styles.channelUsageChevron} ${accountOpen ? styles.channelUsageChevronOpen : ''}`}
                                />
                                <span>{account.label}</span>
                              </span>
                              {metricCells(account)}
                            </button>
                            {accountOpen && (
                              <div id={accountPanelId}>
                                {account.models.map((model) => (
                                  <div
                                    className={`${styles.channelUsageRow} ${styles.channelUsageModelRow} ${showCost ? '' : styles.channelUsageWithoutCost}`}
                                    key={model.key}
                                  >
                                    <span className={styles.channelUsageName}>
                                      <span>{model.label}</span>
                                    </span>
                                    {metricCells(model)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {childModels.map((model) => (
                        <div
                          className={`${styles.channelUsageRow} ${styles.channelUsageModelRow} ${styles.channelUsageDirectModelRow} ${showCost ? '' : styles.channelUsageWithoutCost}`}
                          key={model.key}
                        >
                          <span className={styles.channelUsageName}>
                            <span>{model.label}</span>
                          </span>
                          {metricCells(model)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
