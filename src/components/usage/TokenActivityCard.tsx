import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  calculateTokenActivityData,
  collectUsageDetails,
  formatCompactNumber,
  type UsageTimeRange,
} from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import { HeatmapTooltip } from './HeatmapTooltip';
import { useHeatmapTooltip } from './useHeatmapTooltip';
import styles from '@/pages/UsagePage.module.scss';

function activityColor(intensity: number): string {
  const normalized = Math.max(0, Math.min(1, intensity));
  const lightness = 88 - normalized * 48;
  return `hsl(178 70% ${lightness}%)`;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}`;
}

export interface TokenActivityCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  timeRange: UsageTimeRange;
  embedded?: boolean;
}

export function TokenActivityCard({
  usage,
  loading,
  timeRange,
  embedded = false,
}: TokenActivityCardProps) {
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
    return calculateTokenActivityData(details, timeRange);
  }, [timeRange, usage]);

  const hasData = activityData.totalTokens > 0;

  const content = (
    <>
      <div className={styles.healthHeader}>
        <h3 className={styles.healthTitle}>{t('usage_stats.token_activity')}</h3>
        <div className={styles.healthMeta}>
          <span className={styles.healthRate}>
            {loading ? '--' : formatCompactNumber(activityData.totalTokens)}
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
            const isIdle = detail.tokens <= 0;
            const timeRangeLabel = `${formatDateTime(detail.startTime)} - ${formatDateTime(detail.endTime)}`;
            const activityLabel = isIdle
              ? t('usage_stats.token_activity_no_tokens')
              : t('usage_stats.token_activity_tokens', {
                  value: formatCompactNumber(detail.tokens),
                });
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
                        {t('usage_stats.token_activity_no_tokens')}
                      </span>
                    ) : (
                      <>
                        <div className={styles.healthTooltipTotal}>
                          <span>{t('usage_stats.total_tokens')}</span>
                          <strong>{formatCompactNumber(detail.tokens)}</strong>
                        </div>
                        <div className={styles.healthTooltipTokenBreakdown}>
                          {[
                            { label: t('usage_stats.input_tokens'), tokens: detail.inputTokens },
                            { label: t('usage_stats.output_tokens'), tokens: detail.outputTokens },
                            { label: t('usage_stats.reasoning_tokens'), tokens: detail.reasoningTokens },
                            { label: t('usage_stats.cost_cache_read'), tokens: detail.cacheReadTokens },
                            { label: t('usage_stats.cost_cache_write'), tokens: detail.cacheWriteTokens },
                          ].map((item) => (
                            <div className={styles.healthTooltipTokenRow} key={item.label}>
                              <span>{item.label}</span>
                              <strong>{formatCompactNumber(item.tokens)} Token</strong>
                            </div>
                          ))}
                        </div>
                        <div className={styles.healthTooltipModels}>
                          {detail.models.slice(0, 8).map((model) => (
                            <div className={styles.healthTooltipModelRow} key={model.model}>
                              <span title={model.model}>{model.model}</span>
                              <strong>{formatCompactNumber(model.tokens)}</strong>
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
        <span className={styles.healthLegendLabel}>{t('usage_stats.token_activity_low')}</span>
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
        <span className={styles.healthLegendLabel}>{t('usage_stats.token_activity_high')}</span>
        {!hasData && !loading && (
          <span className={styles.healthLegendLabel}>
            {t('usage_stats.token_activity_no_tokens')}
          </span>
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
