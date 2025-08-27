import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PromptNode, SizeBasis, ViewMode, ModelId } from '@/types/models';
import { MODELS } from '@/types/models';
import useSunburstD3, { SunburstOptions } from './useSunburstD3';
import { Breadcrumbs } from './Breadcrumbs';

type SunburstChartProps = {
  data?: PromptNode;
  sizeBasis: SizeBasis;
  viewMode?: ViewMode;
  modelId?: ModelId;
  className?: string;
  style?: React.CSSProperties;
  onNodeClick?: (node: PromptNode) => void;
  onHover?: (node: PromptNode | null) => void;
  enableAnimations?: boolean;
};

export function SunburstChart({
  data,
  sizeBasis,
  viewMode = 'relative',
  modelId = 'gpt-5-400k',
  className,
  style,
  onNodeClick,
  onHover,
  enableAnimations = true,
}: SunburstChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number }>({ width: 640, height: 480 });
  const [focusTrail, setFocusTrail] = useState<Array<{ id: string; name: string }>>([]);

  // Responsive sizing: use ResizeObserver on container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        const w = Math.max(240, Math.round(cr.width));
        const h = Math.max(240, Math.round(cr.height));
        setDims({ width: w, height: h });
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const contextLimit = useMemo(() => {
    const cfg = MODELS[modelId];
    return cfg?.contextLimit;
  }, [modelId]);

  // Wire up D3 hook
  const api = useSunburstD3(svgRef, data, {
    width: dims.width,
    height: dims.height,
    sizeBasis,
    viewMode,
    contextLimit,
    enableAnimations,
    onNodeClick,
    onHover,
    onFocusChange: ({ ancestors }) => {
      const items = ancestors.map((a) => ({ id: a.id, name: a.name }));
      setFocusTrail(items);
    },
  } as SunburstOptions);

  // Keyboard support at container level: Escape zoom-out is handled in hook via center circle;
  // here we just forward focus to SVG on mount.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const t = setTimeout(() => {
      svg.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [dims.width, dims.height]);

  // Breadcrumb navigation: clicking an ancestor should instruct the hook to zoom. For now, we trigger onNodeClick
  // and rely on D3 click handlers. Without a direct API to programmatically zoom to arbitrary ancestor,
  // we can dispatch a synthetic click on the closest arc if available. As a simpler fallback,
  // we just update the center labels via focus (the hook exposes onFocusChange only).
  // Note: For MVP, we can still provide breadcrumb UI and rely on click/hover for navigation.
  const onBreadcrumbSelect = (_index: number, _item: { id: string; name: string }) => {
    // This could be enhanced to programmatically zoom to the ancestor if the arc path element is retrievable by data-id.
    // Kept as no-op for now as the hook manages zoom on click directly.
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 280,
        ...style,
      }}
      aria-label="Sunburst Chart Container"
    >
      <svg
        ref={svgRef}
        width={dims.width}
        height={dims.height}
        role="img"
        aria-label="Sunburst chart"
        style={{ display: 'block', width: '100%', height: '100%', outline: 'none' }}
      />
      <div
        style={{
          position: 'absolute',
          left: 8,
          top: 8,
          right: 8,
          pointerEvents: 'auto',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Breadcrumbs items={focusTrail} onSelect={onBreadcrumbSelect} />
      </div>
    </div>
  );
}

export default SunburstChart;