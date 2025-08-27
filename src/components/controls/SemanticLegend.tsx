import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSemanticLegendEntries } from '@/utils/semantic';

type LegendVariant = 'popover' | 'floating';

export interface SemanticLegendProps {
  variant?: LegendVariant;
  className?: string;
  dense?: boolean;
  pinned?: boolean;
  onRequestPinChange?: (next: boolean) => void;
}

function cx(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(' ');
}

function LegendIcon({ className }: { className?: string }) {
  // Minimal "palette" icon to suggest legend/colours
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 2a8 8 0 00-8 8 6 6 0 006 6h4a4 4 0 004-4 3 3 0 00-3-3H9a1 1 0 110-2h3a1 1 0 100-2H9a3 3 0 100 6h4a1 1 0 010 2H8a8 8 0 002-15z" />
      <circle cx="6" cy="6" r="1.5" />
      <circle cx="14" cy="6" r="1.5" />
      <circle cx="6" cy="14" r="1.5" />
    </svg>
  );
}

function LegendList({ dense = true }: { dense?: boolean }) {
  const entries = useMemo(() => getSemanticLegendEntries(), []);
  const baseItem =
    'flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100';
  const grid = dense ? 'grid grid-cols-2 gap-x-3 gap-y-1' : 'grid grid-cols-2 gap-2';

  return (
    <ul className={grid} role="list" aria-label="Semantic colour legend">
      {entries.map((e) => (
        <li key={e.key} className={baseItem} role="listitem">
          <span
            className="h-3 w-3 rounded-sm border border-black/20 dark:border-white/20"
            aria-hidden="true"
            style={{ backgroundColor: e.color }}
          />
          <span className="truncate">{e.label}</span>
        </li>
      ))}
    </ul>
  );
}

function PopoverLegend({
  className,
  dense,
  onRequestPinChange,
}: {
  className?: string;
  dense?: boolean;
  onRequestPinChange?: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Compute the best-fit position. Prefer left alignment to avoid overlapping the token display on the right.
  const updatePosition = () => {
    const anchor = rootRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportW = window.innerWidth || document.documentElement.clientWidth;
    const margin = 8; // viewport margin
    const gap = 6; // space below the button
    const assumedWidth = 224; // ~ w-56 for initial measure
    const measuredWidth = panelRef.current?.offsetWidth || assumedWidth;

    // Prefer aligning left edge with the button; flip to right-align if overflow on the right.
    let left = rect.left;
    if (left + measuredWidth + margin > viewportW) {
      left = Math.max(margin, rect.right - measuredWidth);
    }
    left = Math.max(margin, left);

    // Fixed coordinates; include page scroll offsets
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const top = rect.bottom + gap + scrollY;

    setPosition({ top, left: left + scrollX });
  };

  // Reposition when opened and on layout changes
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();

    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    const id = window.setTimeout(updatePosition, 0); // remeasure after paint for accurate width
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Close on outside click or Escape. Include the portal panel in the containment check.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!open) return;
      const target = e.target as Node | null;
      const inAnchor = rootRef.current && target ? rootRef.current.contains(target) : false;
      const inPanel = panelRef.current && target ? panelRef.current.contains(target) : false;
      if (!inAnchor && !inPanel) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="semantic-legend-popover"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
      >
        <LegendIcon className="h-4 w-4" />
        <span>Legend</span>
        <svg className="ml-0.5 h-4 w-4 opacity-70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.188l3.71-3.958a.75.75 0 011.08 1.04l-4.24 4.523a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
        </svg>
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              id="semantic-legend-popover"
              role="dialog"
              className="fixed z-50 w-56 rounded-md border border-gray-200 bg-white p-2 shadow-lg ring-1 ring-black/5 dark:border-gray-700 dark:bg-gray-800"
              style={{ top: `${position.top}px`, left: `${position.left}px` }}
            >
              <LegendList dense={dense} />
              <div className="mt-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => onRequestPinChange?.(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M12.9 3.1a1 1 0 00-1.4 0L7 7.59V10h2.41l4.49-4.49a1 1 0 000-1.41l-1-1zM6 12v2h2l7.3-7.3a3 3 0 00-4.24-4.24L6 9.76V12z" />
                  </svg>
                  Pin to chart
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function FloatingLegend({
  className,
  dense,
  pinned,
  onRequestPinChange,
}: {
  className?: string;
  dense?: boolean;
  pinned?: boolean;
  onRequestPinChange?: (next: boolean) => void;
}) {
  return (
    <div
      className={cx(
        'rounded-md border border-gray-200 bg-white/90 p-2 shadow-sm backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/90',
        className
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">Legend</span>
        <div className="flex items-center gap-1">
          {pinned ? (
            <button
              type="button"
              aria-label="Unpin legend"
              title="Unpin legend"
              onClick={() => onRequestPinChange?.(false)}
              className="rounded p-1 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      <LegendList dense={dense} />
    </div>
  );
}

/**
 * SemanticLegend
 * - Popover variant: a small button that shows a dropdown panel with the legend and a "Pin to chart" action.
 * - Floating variant: a compact panel suitable for overlaying in the chart container; shows an "Unpin" control when pinned.
 * The actual pinned state is controlled by the host via the onRequestPinChange callback.
 */
export default function SemanticLegend({
  variant = 'popover',
  className,
  dense = true,
  pinned,
  onRequestPinChange,
}: SemanticLegendProps) {
  if (variant === 'floating') {
    return (
      <FloatingLegend
        className={className}
        dense={dense}
        pinned={pinned}
        onRequestPinChange={onRequestPinChange}
      />
    );
  }
  return <PopoverLegend className={className} dense={dense} onRequestPinChange={onRequestPinChange} />;
}