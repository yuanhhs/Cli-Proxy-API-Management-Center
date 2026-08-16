import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  calculateCostActivityData,
  collectUsageDetails,
  formatCompactNumber,
  formatUsd,
  type ModelPrice,
  type UsageTimeRange,
} from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import { HeatmapTooltip } from './HeatmapTooltip';
import { useHeatmapTooltip } from './useHeatmapTooltip';
import styles from '@/pages/UsagePage.module.scss';

function activityColor(intensity: number): string {
  const normalized = Math.max(0, Math.min(1, intensity));
  const lightness = 90 - normalized * 48;
  return `hsl(43 92% ${lightness}%)`;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}`;
}

export interface CostActivityCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  timeRange: UsageTimeRange;
  modelPrices: Record<string, ModelPrice>;
  embedded?: boolean;
}

export function CostActivityCard({
  usage,
  loading,
  timeRange,
  modelPrices,
  embedded = false,
}: CostActivityCardProps) {
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
  const activityData = useMemo(() => {
    const details = usage ? collectUsageDetails(usage) : [];
    return calculateCostActivityData(details, timeRange, modelPrices);
  }, [modelPrices, timeRange, usage]);

  const hasData = activityData.totalCost > 0;
  const content = (
    <>
      <div className={styles.healthHeader}>
        <h3 className={styles.healthTitle}>{t('usage_stats.cost_activity')}</h3>
        <div className={styles.healthMeta}>
          <span className={styles.healthRate}>
            {loading ? '--' : formatUsd(activityData.totalCost)}
          </span>
        </div>
      </div>

      <div className={styles.healthGridScroller}>
        <div
          className={styles.healthGrid}
          ref={gridRef}
          style={{ gridTemplateRows: `repeat(${activityData.rows}, 10px)` }}
        >
          {activityData.blockDetails.map((detail, index) => {
            const isIdle = detail.cost <= 0;
            const timeRangeLabel = `${formatDateTime(detail.startTime)} - ${formatDateTime(detail.endTime)}`;
            const activityLabel = isIdle
              ? t('usage_stats.cost_activity_no_cost')
              : t('usage_stats.cost_activity_value', { value: formatUsd(detail.cost) });
            const label = `${timeRangeLabel}, ${activityLabel}`;
            const isActive = activeTooltip?.idx === index;

            return (
              <div
                key={index}
                className={`${styles.healthBlockWrapper} ${isActive ? styles.healthBlockActive : ''}`}
                tabIndex={0}
                role="img"
                aria-label={label}
                onPointerEnter={(event) => onPointerEnter(event, index)}
                onPointerLeave={onPointerLeave}
                onPointerDown={(event) => onPointerDown(event, index)}
                onFocus={(event) => onFocus(index, event.currentTarget)}
                onBlur={onBlur}
                onKeyDown={onKeyDown}
              >
                <div
                  className={`${styles.healthBlock} ${isIdle ? styles.healthBlockIdle : ''}`}
                  style={isIdle ? undefined : { backgroundColor: activityColor(detail.intensity) }}
                />
                {isActive && activeTooltip && (
                  <HeatmapTooltip state={activeTooltip}>
                    <span className={styles.healthTooltipTime}>{timeRangeLabel}</span>
                    {isIdle ? (
                      <span className={styles.healthTooltipStats}>
                        {t('usage_stats.cost_activity_no_cost')}
                      </span>
                    ) : (
                      <>
                        <div className={styles.healthTooltipTotal}>
                          <span>{t('usage_stats.cost_activity_total')}</span>
                          <strong>{formatUsd(detail.cost)}</strong>
                        </div>
                        <div className={styles.healthTooltipCostBreakdown}>
                          {[
                            {
                              label: t('usage_stats.cost_input'),
                              tokens: detail.inputTokens,
                              cost: detail.inputCost,
                            },
                            {
                              label: t('usage_stats.cost_output'),
                              tokens: detail.outputTokens,
                              cost: detail.outputCost,
                            },
                            {
                              label: t('usage_stats.cost_cache_read'),
                              tokens: detail.cacheReadTokens,
                              cost: detail.cacheReadCost,
                            },
                            {
                              label: t('usage_stats.cost_cache_write'),
                              tokens: detail.cacheWriteTokens,
                              cost: detail.cacheWriteCost,
                            },
                          ].map((item) => (
                            <div className={styles.healthTooltipCostRow} key={item.label}>
                              <span>{item.label}</span>
                              <span>{formatCompactNumber(item.tokens)} Token</span>
                              <strong>{formatUsd(item.cost)}</strong>
                            </div>
                          ))}
                        </div>
                        <div className={styles.healthTooltipModels}>
                          {detail.models.slice(0, 8).map((model) => (
                            <div className={styles.healthTooltipModelRow} key={model.model}>
                              <span title={model.model}>{model.model}</span>
                              <strong>{formatUsd(model.cost)}</strong>
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
                    )}
                  </HeatmapTooltip>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.healthLegend}>
        <span className={styles.healthLegendLabel}>{t('usage_stats.cost_activity_low')}</span>
        <div className={styles.healthLegendColors}>
          <div className={`${styles.healthLegendBlock} ${styles.healthBlockIdle}`} />
          {[0.2, 0.45, 0.7, 1].map((intensity) => (
            <div
              key={intensity}
              className={styles.healthLegendBlock}
              style={{ backgroundColor: activityColor(intensity) }}
            />
          ))}
        </div>
        <span className={styles.healthLegendLabel}>{t('usage_stats.cost_activity_high')}</span>
        {!hasData && !loading && (
          <span className={styles.healthLegendLabel}>{t('usage_stats.cost_activity_no_cost')}</span>
        )}
      </div>
    </>
  );

  return embedded ? (
    <section className={styles.monitoringSection}>{content}</section>
  ) : (
    <div className={styles.healthCard}>{content}</div>
  );
}
