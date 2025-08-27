import React, { useEffect, useRef, useState } from 'react';
import useIcicleD3 from './useIcicleD3';
import { useStore } from '@/state/useStore';
import { MODELS } from '@/types/models';
import ErrorBoundary from '@/components/ErrorBoundary';

interface IcicleChartProps {
  className?: string;
  width?: number;
  height?: number;
}

export default function IcicleChart({ className, width: propWidth, height: propHeight }: IcicleChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: propWidth ?? 640, height: propHeight ?? 400 });

  const {
    promptTree,
    modelId,
    sizeBasis,
    viewMode,
    performanceConfig,
    actions,
  } = useStore((s) => ({
    promptTree: s.promptTree,
    modelId: s.modelId,
    sizeBasis: s.sizeBasis,
    viewMode: s.viewMode,
    performanceConfig: s.performanceConfig,
    actions: s.actions,
  }));

  const model = MODELS[modelId];
  const contextLimit = model?.contextLimit;

  useEffect(() => {
    if (typeof propWidth === 'number' && typeof propHeight === 'number') {
      setSize({ width: propWidth, height: propHeight });
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const cr = el.getBoundingClientRect();
      const w = Math.max(100, Math.floor(cr.width));
      const h = Math.max(120, Math.floor(cr.height));
      if (w > 0 && h > 0) {
        setSize({ width: w, height: h });
      }
    };

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        const w = Math.max(100, Math.floor(cr.width));
        const h = Math.max(120, Math.floor(cr.height));
        if (w > 0 && h > 0) {
          setSize({ width: w, height: h });
        }
      }
    });
    ro.observe(el);

    // Trigger an initial measurement synchronously and on the next frame
    measure();
    const raf = requestAnimationFrame(measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [propWidth, propHeight]);

  useIcicleD3(svgRef, promptTree, {
    width: size.width || 640,
    height: size.height || 400,
    sizeBasis,
    viewMode,
    contextLimit,
    enableAnimations: performanceConfig.enableAnimations,
    enableLOD: performanceConfig.enableLOD,
    maxVisibleNodes: performanceConfig.maxVisibleNodes,
    aggregationThreshold: performanceConfig.aggregationThreshold,
    onNodeClick: (node) => {
      try {
        if (actions && typeof actions.setSelectedNode === 'function') {
          actions.setSelectedNode(node.id);
        }
      } catch (e) {
        console.error('[IcicleChart] onNodeClick handler failed', e);
      }
    },
    onHover: (node) => {
      try {
        if (actions && typeof actions.setHoveredNode === 'function') {
          actions.setHoveredNode(node ? node.id : undefined);
        }
      } catch (e) {
        console.error('[IcicleChart] onHover handler failed', e);
      }
    },
    onFocusChange: ({ node, ancestors }) => {
      try {
        // Update breadcrumbs using names (best-effort)
        if (actions && typeof actions.zoomToNode === 'function') {
          const path = ancestors.map((a) => a.name).filter(Boolean);
          actions.zoomToNode(path);
        }
      } catch (e) {
        console.error('[IcicleChart] onFocusChange handler failed', e);
      }
    },
    debug: true,
    onError: (error, context) => {
      console.error('[IcicleChart] Hook reported an error', error, context);
    },
  });

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: propWidth ? undefined : '100%',
        height: propHeight ? undefined : '100%',
        position: 'relative',
        minWidth: propWidth ? undefined : 200,
        minHeight: propHeight ? undefined : 200,
      }}
    >
      <ErrorBoundary>
        <>
          <svg
            ref={svgRef}
            width={propWidth ? propWidth : '100%'}
            height={propHeight ? propHeight : '100%'}
            aria-hidden={!promptTree ? 'true' : 'false'}
          />
          
          {!promptTree && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                color: '#6b7280',
                fontSize: 14,
                fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
              }}
            >
              No data to visualize
            </div>
          )}
        </>
      </ErrorBoundary>
    </div>
  );
}