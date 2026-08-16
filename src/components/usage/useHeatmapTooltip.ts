import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const TOOLTIP_OFFSET = 8;
const TOOLTIP_SAFE_WIDTH = 360;
const TOOLTIP_SAFE_HEIGHT = 320;
const TOOLTIP_OWNER_EVENT = 'cli-proxy:heatmap-tooltip-open';
let tooltipOwnerSequence = 0;

type TooltipHorizontalPosition = 'center' | 'left' | 'right';
type TooltipVerticalPosition = 'above' | 'below';

export interface HeatmapTooltipState {
  idx: number;
  anchorEl: HTMLDivElement;
  horizontal: TooltipHorizontalPosition;
  vertical: TooltipVerticalPosition;
  left: number;
  top: number;
  transform: string;
}

export function useHeatmapTooltip() {
  const [activeTooltip, setActiveTooltip] = useState<HeatmapTooltipState | null>(null);
  const [ownerId] = useState(() => `heatmap-tooltip-${++tooltipOwnerSequence}`);
  const gridRef = useRef<HTMLDivElement>(null);

  const buildTooltipState = useCallback(
    (idx: number, anchorEl: HTMLDivElement | null): HeatmapTooltipState | null => {
      if (!anchorEl?.isConnected) return null;

      const rect = anchorEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      let horizontal: TooltipHorizontalPosition = 'center';
      let left = centerX;

      if (centerX <= TOOLTIP_SAFE_WIDTH / 2) {
        horizontal = 'left';
        left = Math.max(8, rect.left);
      } else if (centerX >= window.innerWidth - TOOLTIP_SAFE_WIDTH / 2) {
        horizontal = 'right';
        left = Math.min(window.innerWidth - 8, rect.right);
      }

      const vertical: TooltipVerticalPosition =
        rect.top <= TOOLTIP_SAFE_HEIGHT && window.innerHeight - rect.bottom > rect.top
          ? 'below'
          : 'above';
      const top = vertical === 'below' ? rect.bottom + TOOLTIP_OFFSET : rect.top - TOOLTIP_OFFSET;
      const translateX = horizontal === 'center' ? '-50%' : horizontal === 'right' ? '-100%' : '0';
      const translateY = vertical === 'below' ? '0' : '-100%';

      return {
        idx,
        anchorEl,
        horizontal,
        vertical,
        left: Math.round(left),
        top: Math.round(top),
        transform: `translate(${translateX}, ${translateY})`,
      };
    },
    []
  );

  const openTooltip = useCallback(
    (idx: number, anchorEl: HTMLDivElement) => {
      document.dispatchEvent(new CustomEvent(TOOLTIP_OWNER_EVENT, { detail: { ownerId } }));
      setActiveTooltip(buildTooltipState(idx, anchorEl));
    },
    [buildTooltipState, ownerId]
  );

  useEffect(() => {
    const closeForOtherGrid = (event: Event) => {
      const customEvent = event as CustomEvent<{ ownerId?: string }>;
      if (customEvent.detail?.ownerId !== ownerId) {
        setActiveTooltip(null);
      }
    };
    document.addEventListener(TOOLTIP_OWNER_EVENT, closeForOtherGrid);
    return () => document.removeEventListener(TOOLTIP_OWNER_EVENT, closeForOtherGrid);
  }, [ownerId]);

  useEffect(() => {
    if (!activeTooltip) return;
    const closeOutside = (event: PointerEvent) => {
      if (gridRef.current && !gridRef.current.contains(event.target as Node)) {
        setActiveTooltip(null);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [activeTooltip]);

  useEffect(() => {
    if (!activeTooltip) return;
    const closeWhenPointerLeavesAnchor = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && !activeTooltip.anchorEl.contains(event.target as Node)) {
        setActiveTooltip((current) =>
          current?.anchorEl === activeTooltip.anchorEl ? null : current
        );
      }
    };
    document.addEventListener('pointermove', closeWhenPointerLeavesAnchor);
    return () => document.removeEventListener('pointermove', closeWhenPointerLeavesAnchor);
  }, [activeTooltip]);

  useEffect(() => {
    if (!activeTooltip) return;
    const updatePosition = () => {
      if (!document.body.contains(activeTooltip.anchorEl)) {
        setActiveTooltip(null);
        return;
      }
      setActiveTooltip(buildTooltipState(activeTooltip.idx, activeTooltip.anchorEl));
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [activeTooltip, buildTooltipState]);

  const onPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, idx: number) => {
      if (event.pointerType === 'mouse') openTooltip(idx, event.currentTarget);
    },
    [openTooltip]
  );

  const onPointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    const anchorEl = event.currentTarget;
    setActiveTooltip((current) => (current?.anchorEl === anchorEl ? null : current));
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, idx: number) => {
      if (event.pointerType !== 'touch') return;
      event.preventDefault();
      const anchorEl = event.currentTarget;
      if (activeTooltip?.anchorEl === anchorEl) {
        setActiveTooltip(null);
        return;
      }
      openTooltip(idx, anchorEl);
    },
    [activeTooltip, openTooltip]
  );

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setActiveTooltip(null);
      event.currentTarget.blur();
    }
  }, []);

  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const anchorEl = event.currentTarget;
    setActiveTooltip((current) => (current?.anchorEl === anchorEl ? null : current));
  }, []);

  return {
    activeTooltip,
    gridRef,
    onPointerEnter,
    onPointerLeave,
    onPointerDown,
    onFocus: openTooltip,
    onBlur,
    onKeyDown,
  };
}
