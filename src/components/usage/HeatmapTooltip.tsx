import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '@/pages/UsagePage.module.scss';
import type { HeatmapTooltipState } from './useHeatmapTooltip';

export function HeatmapTooltip({
  state,
  children,
}: {
  state: HeatmapTooltipState;
  children: ReactNode;
}) {
  const horizontalClass =
    state.horizontal === 'left'
      ? styles.healthTooltipLeft
      : state.horizontal === 'right'
        ? styles.healthTooltipRight
        : '';
  const verticalClass = state.vertical === 'below' ? styles.healthTooltipBelow : '';
  const tooltip = (
    <div
      className={`${styles.healthTooltip} ${horizontalClass} ${verticalClass}`}
      style={{
        position: 'fixed',
        left: `${state.left}px`,
        top: `${state.top}px`,
        bottom: 'auto',
        right: 'auto',
        transform: state.transform,
      }}
      role="tooltip"
    >
      {children}
    </div>
  );

  return typeof document === 'undefined' ? tooltip : createPortal(tooltip, document.body);
}
