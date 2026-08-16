import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collectUsageDetails,
  calculateServiceHealthData,
  type ServiceHealthData,
  type UsageTimeRange,
} from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import { HeatmapTooltip } from './HeatmapTooltip';
import { useHeatmapTooltip } from './useHeatmapTooltip';
import styles from '@/pages/UsagePage.module.scss';

const COLOR_STOPS = [
  { r: 239, g: 68, b: 68 }, // #ef4444
  { r: 249, g: 115, b: 22 }, // #f97316
  { r: 250, g: 204, b: 21 }, // #facc15
  { r: 34, g: 197, b: 94 }, // #22c55e
] as const;

function rateToColor(rate: number): string {
  const t = Math.max(0, Math.min(1, rate));
  const scaled = t * (COLOR_STOPS.length - 1);
  const segment = Math.min(Math.floor(scaled), COLOR_STOPS.length - 2);
  const localT = scaled - segment;
  const from = COLOR_STOPS[segment];
  const to = COLOR_STOPS[segment + 1];
  const r = Math.round(from.r + (to.r - from.r) * localT);
  const g = Math.round(from.g + (to.g - from.g) * localT);
  const b = Math.round(from.b + (to.b - from.b) * localT);
  return `rgb(${r}, ${g}, ${b})`;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${h}:${m}`;
}

export interface ServiceHealthCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  timeRange?: UsageTimeRange;
  embedded?: boolean;
}

export function ServiceHealthCard({
  usage,
  loading,
  timeRange = '7d',
  embedded = false,
}: ServiceHealthCardProps) {
  const { t } = useTranslation();
  const {
    activeTooltip,
    gridRef,
    onPointerEnter,
    onPointerLeave,
    onPointerDown,
    onFocus,
    onBlur,
    onKeyDown,
  } = useHeatmapTooltip();

  const healthData: ServiceHealthData = useMemo(() => {
    const details = usage ? collectUsageDetails(usage) : [];
    return calculateServiceHealthData(details, timeRange);
  }, [timeRange, usage]);

  const hasData = healthData.totalSuccess + healthData.totalFailure > 0;

  const rateClass = !hasData
    ? ''
    : healthData.successRate >= 90
      ? styles.healthRateHigh
      : healthData.successRate >= 50
        ? styles.healthRateMedium
        : styles.healthRateLow;

  const content = (
    <>
      <div className={styles.healthHeader}>
        <h3 className={styles.healthTitle}>{t('service_health.title')}</h3>
        <div className={styles.healthMeta}>
          <span className={`${styles.healthRate} ${rateClass}`}>
            {loading ? '--' : hasData ? `${healthData.successRate.toFixed(1)}%` : '--'}
          </span>
        </div>
      </div>
      <div className={styles.healthGridScroller}>
        <div className={styles.healthGrid} ref={gridRef}>
          {healthData.blockDetails.map((detail, idx) => {
            const isIdle = detail.rate === -1;
            const blockStyle = isIdle ? undefined : { backgroundColor: rateToColor(detail.rate) };
            const isActive = activeTooltip?.idx === idx;
            const total = detail.success + detail.failure;
            const timeRangeLabel = `${formatDateTime(detail.startTime)} - ${formatDateTime(detail.endTime)}`;
            const accessibilityLabel =
              total > 0
                ? `${timeRangeLabel}, ${detail.success} ${t('usage_stats.success_requests')}, ${detail.failure} ${t('usage_stats.failed_requests')}`
                : `${timeRangeLabel}, ${t('status_bar.no_requests')}`;

            return (
              <div
                key={idx}
                className={`${styles.healthBlockWrapper} ${isActive ? styles.healthBlockActive : ''}`}
                tabIndex={0}
                role="img"
                aria-label={accessibilityLabel}
                onPointerEnter={(event) => onPointerEnter(event, idx)}
                onPointerLeave={onPointerLeave}
                onPointerDown={(event) => onPointerDown(event, idx)}
                onFocus={(event) => onFocus(idx, event.currentTarget)}
                onBlur={onBlur}
                onKeyDown={onKeyDown}
              >
                <div
                  className={`${styles.healthBlock} ${isIdle ? styles.healthBlockIdle : ''}`}
                  style={blockStyle}
                />
                {isActive && activeTooltip && (
                  <HeatmapTooltip state={activeTooltip}>
                    <span className={styles.healthTooltipTime}>{timeRangeLabel}</span>
                    {total > 0 ? (
                      <>
                        <span className={styles.healthTooltipStats}>
                          <span className={styles.healthTooltipSuccess}>
                            {t('status_bar.success_short')} {detail.success}
                          </span>
                          <span className={styles.healthTooltipFailure}>
                            {t('status_bar.failure_short')} {detail.failure}
                          </span>
                          <span className={styles.healthTooltipRate}>
                            ({(detail.rate * 100).toFixed(1)}%)
                          </span>
                        </span>
                        <div className={styles.healthTooltipModels}>
                          {detail.models.slice(0, 8).map((model) => (
                            <div className={styles.healthTooltipHealthRow} key={model.model}>
                              <span title={model.model}>{model.model}</span>
                              <span className={styles.healthTooltipSuccess}>
                                {t('status_bar.success_short')} {model.success}
                              </span>
                              <span className={styles.healthTooltipFailure}>
                                {t('status_bar.failure_short')} {model.failure}
                              </span>
                              <strong>{(model.rate * 100).toFixed(1)}%</strong>
                            </div>
                          ))}
                          {detail.models.length > 8 && (
                            <span className={styles.healthTooltipMore}>
                              {t('usage_stats.activity_more_models', {
                                count: detail.models.length - 8,
                              })}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className={styles.healthTooltipStats}>{t('status_bar.no_requests')}</span>
                    )}
                  </HeatmapTooltip>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.healthLegend}>
        <span className={styles.healthLegendLabel}>{t('service_health.oldest')}</span>
        <div className={styles.healthLegendColors}>
          <div className={`${styles.healthLegendBlock} ${styles.healthBlockIdle}`} />
          <div className={styles.healthLegendBlock} style={{ backgroundColor: '#ef4444' }} />
          <div className={styles.healthLegendBlock} style={{ backgroundColor: '#f97316' }} />
          <div className={styles.healthLegendBlock} style={{ backgroundColor: '#facc15' }} />
          <div className={styles.healthLegendBlock} style={{ backgroundColor: '#22c55e' }} />
        </div>
        <span className={styles.healthLegendLabel}>{t('service_health.newest')}</span>
      </div>
    </>
  );

  return embedded ? (
    <section className={styles.monitoringSection}>{content}</section>
  ) : (
    <div className={styles.healthCard}>{content}</div>
  );
}
