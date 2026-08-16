import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi, providersApi } from '@/services/api';
import { useConfigStore } from '@/stores';
import type { OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import {
  StatCards,
  ApiDetailsCard,
  ModelStatsCard,
  PriceSettingsCard,
  CredentialStatsCard,
  ChannelUsageCard,
  RequestEventsDetailsCard,
  ServiceHealthCard,
  TokenActivityCard,
  CostActivityCard,
  useUsageData,
  useSparklines,
} from '@/components/usage';
import {
  getModelNamesFromUsage,
  getApiStats,
  getModelStats,
  filterUsageByTimeRange,
  type UsageTimeRange,
} from '@/utils/usage';
import styles from './UsagePage.module.scss';

// Register Chart.js components
ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const DEFAULT_TIME_RANGE: UsageTimeRange = '24h';
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: '30d', labelKey: 'usage_stats.range_30d' },
  { value: 'all', labelKey: 'usage_stats.range_all' },
];
const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '24h' || value === '7d' || value === '30d' || value === 'all';

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

export function UsagePage() {
  const { t } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const openaiCompatibilityConfig = config?.openaiCompatibility;
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [openaiProvidersWithAuthIndex, setOpenaiProvidersWithAuthIndex] = useState<{
    source: OpenAIProviderConfig[] | undefined;
    providers: OpenAIProviderConfig[];
  } | null>(null);
  const [authFiles, setAuthFiles] = useState<AuthFileItem[]>([]);
  const [authFilesLoading, setAuthFilesLoading] = useState(true);

  // Data hook
  const {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    setModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  } = useUsageData(timeRange);

  // Keep polling responsive: expensive usage-card calculations follow the
  // latest snapshot at a lower priority and can be interrupted by input.
  const deferredUsage = useDeferredValue(usage);
  const deferredNowMs = useDeferredValue(lastRefreshedAt?.getTime() ?? 0);

  useHeaderRefresh(loadUsage);

  useEffect(() => {
    let cancelled = false;
    const source = openaiCompatibilityConfig;

    providersApi
      .getOpenAIProviders()
      .then((providers) => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex({ source, providers: providers || [] });
      })
      .catch(() => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex(null);
      });

    return () => {
      cancelled = true;
    };
  }, [openaiCompatibilityConfig]);

  useEffect(() => {
    let cancelled = false;

    authFilesApi
      .list()
      .then((response) => {
        if (cancelled) return;
        setAuthFiles(Array.isArray(response.files) ? response.files : []);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthFiles([]);
      })
      .finally(() => {
        if (!cancelled) setAuthFilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const openaiProviderState = openaiProvidersWithAuthIndex;
  const openaiProvidersForUsage =
    openaiProviderState && openaiProviderState.source === openaiCompatibilityConfig
      ? openaiProviderState.providers
      : (openaiCompatibilityConfig ?? []);

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey),
      })),
    [t]
  );

  const filteredUsage = useMemo(
    () => (deferredUsage ? filterUsageByTimeRange(deferredUsage, timeRange) : null),
    [deferredUsage, timeRange]
  );
  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  const nowMs = deferredNowMs;

  // Sparklines hook
  const {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline,
    cacheRateSparkline,
  } = useSparklines({ usage: filteredUsage, loading, nowMs });

  // Derived data
  const modelNames = useMemo(() => getModelNamesFromUsage(deferredUsage), [deferredUsage]);
  const apiStats = useMemo(
    () => getApiStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );
  const modelStats = useMemo(
    () => getModelStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );
  const hasPrices = Object.keys(modelPrices).length > 0;

  return (
    <div className={styles.container}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
            <Select
              value={timeRange}
              options={timeRangeOptions}
              onChange={(value) => setTimeRange(value as UsageTimeRange)}
              className={styles.timeRangeSelectControl}
              ariaLabel={t('usage_stats.range_filter')}
              fullWidth={false}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {/* Stats Overview Cards */}
      <StatCards
        usage={filteredUsage}
        loading={loading}
        modelPrices={modelPrices}
        nowMs={nowMs}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline,
          cacheRate: cacheRateSparkline,
        }}
      />

      {/* Service Health and Token Activity */}
      <div className={`${styles.healthCard} ${styles.combinedMonitoringCard}`}>
        <ServiceHealthCard usage={filteredUsage} loading={loading} timeRange={timeRange} embedded />
        <div className={styles.monitoringDivider} />
        <TokenActivityCard usage={filteredUsage} loading={loading} timeRange={timeRange} embedded />
        <div className={styles.monitoringDivider} />
        <CostActivityCard
          usage={filteredUsage}
          loading={loading}
          timeRange={timeRange}
          modelPrices={modelPrices}
          embedded
        />
      </div>

      {/* Usage by channel, credential account, and model */}
      <ChannelUsageCard
        usage={filteredUsage}
        loading={loading || authFilesLoading}
        authFiles={authFiles}
        modelPrices={modelPrices}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />

      {/* Details Grid */}
      <div className={styles.detailsGrid}>
        <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
        <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
      </div>

      <RequestEventsDetailsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />

      {/* Credential Stats */}
      <CredentialStatsCard
        usage={filteredUsage}
        loading={loading || authFilesLoading}
        authFiles={authFiles}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />

      {/* Price Settings */}
      <PriceSettingsCard
        modelNames={modelNames}
        modelPrices={modelPrices}
        onPricesChange={setModelPrices}
      />
    </div>
  );
}
