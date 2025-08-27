import * as d3 from 'd3';
import { useEffect, useRef } from 'react';
import type { PromptNode, SizeBasis, ViewMode } from '@/types/models';

/**
 * Color-blind safe Okabe–Ito palette, extended for variety.
 * Reference: https://jfly.uni-koeln.de/color/
 */
const OKABE_ITO = [
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#999999', // grey
];

export interface IcicleOptions {
  width: number;
  height: number;
  sizeBasis: SizeBasis;
  viewMode?: ViewMode; // 'absolute' | 'relative'
  contextLimit?: number; // model context window limit for absolute mode
  enableAnimations?: boolean;
  enableLOD?: boolean;
  maxVisibleNodes?: number;
  aggregationThreshold?: number;
  onNodeClick?: (node: PromptNode) => void;
  onHover?: (node: PromptNode | null) => void;
  onFocusChange?: (focus: { node: PromptNode; ancestors: PromptNode[] }) => void;

  // Debug and error surfacing
  debug?: boolean;
  onError?: (error: unknown, context: { stage: string; width: number; height: number; nodeCount?: number; extra?: any }) => void;
}

export interface IcicleAPI {
  // reserved for future imperative controls
}

/**
 * Calculates the aggregated total of immediate values across the whole tree.
 */
function sumImmediate(root: PromptNode): number {
  let total = 0;
  const stack: PromptNode[] = [root];
  while (stack.length) {
    const n = stack.pop() as PromptNode;
    total += typeof n.value === 'number' ? n.value : 0;
    if (n.children && Array.isArray(n.children) && n.children.length) {
      for (const c of n.children) stack.push(c);
    }
  }
  return total;
}

/**
 * Format a numeric count based on basis.
 */
function formatCount(n: number, basis: SizeBasis): string {
  const s = new Intl.NumberFormat().format(Math.max(0, Math.round(n)));
  return basis === 'tokens' ? `${s} tokens` : `${s} chars`;
}

/**
 * Compute percentages for tooltip based on view mode.
 */
function computePercents(args: {
  nodeSubtreeTotal: number;
  nodeImmediate: number;
  parentSubtreeTotal: number | null;
  globalTotal: number;
  viewMode: ViewMode | undefined;
  contextLimit?: number;
}): { ofParent?: number; ofTotal: number; ofContext?: number } {
  const { nodeSubtreeTotal, parentSubtreeTotal, globalTotal, viewMode, contextLimit } = args;
  const ofParent =
    parentSubtreeTotal && parentSubtreeTotal > 0 ? (nodeSubtreeTotal / parentSubtreeTotal) * 100 : undefined;
  const ofTotal = globalTotal > 0 ? (nodeSubtreeTotal / globalTotal) * 100 : 0;

  if (viewMode === 'absolute' && typeof contextLimit === 'number' && contextLimit > 0) {
    const ofContext = Math.min(100, (nodeSubtreeTotal / contextLimit) * 100);
    return { ofParent, ofTotal, ofContext };
  }
  return { ofParent, ofTotal, ofContext: undefined };
}

/**
 * Create a color accessor for nodes using Okabe–Ito, keyed by top-level ancestor and with depth tint.
 */
function makeColorAccessor(root: d3.HierarchyRectangularNode<PromptNode>) {
  const groupKeyOf = (n: d3.HierarchyRectangularNode<PromptNode>) =>
    ((n.data.attributes as any)?.__group as string) || n.data.name || n.data.id;

  const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

  let groups = root.children ? unique(root.children.map(groupKeyOf)) : [];
  if (groups.length <= 1) {
    const depth2 = root.descendants().filter((d) => d.depth === 2).map(groupKeyOf);
    groups = unique(depth2);
  }
  if (groups.length === 0) groups = [groupKeyOf(root)];

  const base = d3.scaleOrdinal<string, string>().domain(groups).range(OKABE_ITO);

  const cache = new Map<string, string>();

  const colorFor = (d: d3.HierarchyRectangularNode<PromptNode>): string => {
    const key = d.data.id;
    const hit = cache.get(key);
    if (hit) return hit;

    const anc = d.ancestors().reverse();
    const top = anc[1] || anc[0];
    const baseKey = groupKeyOf(top);
    const baseColor = base(baseKey) || OKABE_ITO[0];

    const relDepth = Math.max(0, d.depth - (top.depth || 0));
    const rgb = d3.rgb(baseColor);
    const adjusted = relDepth > 0 ? rgb.brighter(Math.min(1.25, relDepth * 0.25)) : rgb;

    const out = adjusted.formatHex();
    cache.set(key, out);
    return out;
  };

  return colorFor;
}

/**
 * Validate PromptNode tree structure to catch malformed data early.
 */
function validateTree(root: PromptNode) {
  let nodes = 0;
  let missingId = 0;
  let missingName = 0;
  let invalidValue = 0;
  let nonArrayChildren = 0;

  const stack: PromptNode[] = [root];
  while (stack.length) {
    const n = stack.pop() as PromptNode;
    nodes++;
    if (!('id' in n) || typeof n.id !== 'string') missingId++;
    if (!('name' in n) || typeof n.name !== 'string') missingName++;
    if ('value' in n && n.value !== undefined && typeof n.value !== 'number') invalidValue++;
    if ('children' in n && n.children !== undefined) {
      if (!Array.isArray(n.children)) {
        nonArrayChildren++;
      } else {
        for (const c of n.children) stack.push(c);
      }
    }
  }

  return { nodes, missingId, missingName, invalidValue, nonArrayChildren };
}

/**
 * Main D3 hook that renders a zoomable icicle (rectangular partition) inside the given SVG.
 * Orientation: root on the left; depth increases to the right; size maps to height.
 */
export function useIcicleD3(
  svgRef: React.RefObject<SVGSVGElement>,
  data: PromptNode | undefined,
  opts: IcicleOptions
): IcicleAPI {
  const initializedRef = useRef(false);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const focusedNodeIdRef = useRef<string | null>(null);
  const rootIdRef = useRef<string | null>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const {
      width,
      height,
      sizeBasis,
      viewMode,
      contextLimit,
      enableAnimations,
      enableLOD,
      maxVisibleNodes,
      aggregationThreshold,
      onNodeClick,
      onHover,
      onFocusChange,
      onError,
    } = opts;

    const DEBUG =
      opts.debug ??
      (typeof import.meta !== 'undefined' && (import.meta as any).env
        ? (import.meta as any).env.MODE !== 'production'
        : false);

    const log = (...args: any[]) => {
      if (DEBUG) console.log('[useIcicleD3]', ...args);
    };
    const warn = (...args: any[]) => {
      if (DEBUG) console.warn('[useIcicleD3]', ...args);
    };
    const errLog = (stage: string, error: unknown, extra?: any) => {
      // Always log errors
      console.error('[useIcicleD3]', `Error at stage: ${stage}`, error, extra);
      try {
        if (onError) onError(error, { stage, width, height, extra });
      } catch (cbErr) {
        console.error('[useIcicleD3] onError callback threw:', cbErr);
      }
    };

    // Reset focus tracking when the data root changes
    try {
      const currentRootId = (data as any)?.id as string | undefined;
      if (currentRootId && rootIdRef.current !== currentRootId) {
        rootIdRef.current = currentRootId;
        focusedNodeIdRef.current = null;
      }
    } catch (e) {
      // ignore
    }

    // Guard for missing data or invalid size
    if (!data || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      log('Bailing render due to invalid params', { hasData: !!data, width, height });
      d3.select(svgEl).selectAll('*').remove();
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
      return;
    }

    console.groupCollapsed('[useIcicleD3] render', { width, height });
    try {
      // Validate data early
      try {
        const stats = validateTree(data);
        log('Data validation', stats);
        if (stats.missingId || stats.nonArrayChildren || stats.invalidValue) {
          warn('Potentially malformed data', stats);
        }
      } catch (e) {
        errLog('validate-data', e);
      }

      const animDuration = enableAnimations === false ? 0 : 300;

      // Build hierarchy and rectangular partition
      let root: d3.HierarchyRectangularNode<PromptNode>;
      try {
        const h = d3
          .hierarchy<PromptNode>(data)
          .sum((d) => Math.max(0, typeof d.value === 'number' ? d.value : 0))
          .sort((a, b) => (b.value || 0) - (a.value || 0));

        log('Hierarchy constructed', { hasChildren: !!h.children, depth: h.height, value: h.value });

        root = d3.partition<PromptNode>().size([height, width])(h);
        log('Partition computed', {
          root: { x0: root.x0, x1: root.x1, y0: root.y0, y1: root.y1 },
          descendants: root.descendants().length,
        });
      } catch (e) {
        errLog('hierarchy/partition', e, { dataPreview: { id: (data as any)?.id, name: (data as any)?.name } });
        // Clear and abort this render pass
        d3.select(svgEl).selectAll('*').remove();
        if (tooltipRef.current) {
          tooltipRef.current.remove();
          tooltipRef.current = null;
        }
        return;
      }

      // Helpful totals
      const globalTotalImmediate = root.value || sumImmediate(data);

      // Color accessor
      const colorFor = makeColorAccessor(root);

      // Prepare SVG scaffold
      let svg = d3.select(svgEl);
      try {
        svg = svg
          .attr('viewBox', `0 0 ${width} ${height}`)
          .attr('role', 'img')
          .attr('aria-label', 'Icicle chart')
          .attr('tabindex', 0)
          .style('cursor', 'default');

        svg.on('keydown', (event: any) => {
          if (event.key === 'Escape') {
            try {
              zoomToRoot();
            } catch (e) {
              errLog('keydown/zoomToRoot', e);
            }
          }
        });
      } catch (e) {
        errLog('svg-setup', e);
      }

      // Groups
      let gRoot = svg.select<SVGGElement>('g.icicle-root');
      if (gRoot.empty()) {
        gRoot = svg.append('g').attr('class', 'icicle-root');
      }

      let gCells = gRoot.select<SVGGElement>('g.cells');
      if (gCells.empty()) {
        gCells = gRoot.append('g').attr('class', 'cells');
      }

      let gHeader = gRoot.select<SVGGElement>('g.header');
      if (gHeader.empty()) {
        gHeader = gRoot.append('g').attr('class', 'header');
      }

      // Tooltip
      if (!tooltipRef.current) {
        try {
          const tip = document.createElement('div');
          tip.style.position = 'fixed';
          tip.style.pointerEvents = 'none';
          tip.style.opacity = '0';
          tip.style.transition = 'opacity 120ms ease';
          tip.style.background = 'rgba(0,0,0,0.85)';
          tip.style.color = 'white';
          tip.style.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
          tip.style.padding = '6px 8px';
          tip.style.borderRadius = '6px';
          tip.style.zIndex = '1000';
          document.body.appendChild(tip);
          tooltipRef.current = tip;
        } catch (e) {
          errLog('tooltip-init', e);
        }
      }

      // Visibility predicate
      function rectVisible(d: d3.HierarchyRectangularNode<PromptNode>): boolean {
        return d.y1 > d.y0 && d.x1 > d.x0 && d.y0 >= 0 && d.y1 <= width && d.x0 >= 0 && d.x1 <= height;
      }

      // Build node list (exclude root to mimic Sunburst behavior)
      let nodes = root.descendants().filter((d) => d.depth > 0);

      // LOD limiting by node count
      if (enableLOD && typeof maxVisibleNodes === 'number' && nodes.length > maxVisibleNodes) {
        const before = nodes.length;
        nodes = nodes
          .slice()
          .sort((a, b) => (b.value || 0) - (a.value || 0))
          .slice(0, maxVisibleNodes);
        log('LOD limiting nodes', { before, after: nodes.length, limit: maxVisibleNodes });
      }

      // Data binding for rectangles
      let join: d3.Selection<SVGRectElement, d3.HierarchyRectangularNode<PromptNode>, any, any>;
      try {
        // Remove stale event handlers to prevent old closures from firing
        gCells
          .selectAll<SVGRectElement, d3.HierarchyRectangularNode<PromptNode>>('rect.cell')
          .on('click', null)
          .on('keydown', null)
          .on('mousemove', null)
          .on('mouseleave', null)
          .on('mouseover', null)
          .on('mouseout', null);

        join = gCells
          .selectAll<SVGRectElement, d3.HierarchyRectangularNode<PromptNode>>('rect.cell')
          .data(nodes, (d: any) => d.data.id);
      } catch (e) {
        errLog('data-join', e, { nodesLen: nodes.length });
        return;
      }

      // EXIT
      try {
        join
          .exit()
          .transition()
          .duration(animDuration)
          .style('opacity', 0)
          .remove();
      } catch (e) {
        errLog('exit-transition', e);
      }

      // ENTER
      let enter: d3.Selection<SVGRectElement, d3.HierarchyRectangularNode<PromptNode>, any, any>;
      try {
        enter = join
          .enter()
          .append('rect')
          .attr('class', 'cell')
          .attr('x', (d) => d.y0)
          .attr('y', (d) => (initializedRef.current ? d.x0 : (d.x0 + d.x1) / 2))
          .attr('width', (d) => (initializedRef.current ? Math.max(0.5, d.y1 - d.y0) : 0))
          .attr('height', (d) => (initializedRef.current ? Math.max(0.5, d.x1 - d.x0) : 0))
          .attr('fill', (d) => {
            try {
              return makeColorAccessor(root)(d);
            } catch (e) {
              errLog('color-access', e, { nodeId: d.data.id });
              return OKABE_ITO[0];
            }
          })
          .attr('stroke', 'white')
          .attr('stroke-width', 0.5)
          .attr('aria-label', (d) => `${d.data.name}: ${formatCount(d.data.value || 0, sizeBasis)}`)
          .attr('role', 'treeitem')
          .attr('tabindex', 0)
          .on('click', (_event, d) => {
            try {
              clicked(d);
              if (onNodeClick) onNodeClick(d.data);
            } catch (e) {
              errLog('event/click', e, { nodeId: d?.data?.id });
            }
          })
          .on('keydown', (event: any, d) => {
            try {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                clicked(d);
                if (onNodeClick) onNodeClick(d.data);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                zoomToRoot();
              }
            } catch (e) {
              errLog('event/keydown', e, { key: event?.key, nodeId: d?.data?.id });
            }
          })
          .on('mousemove', (event, d) => {
            try {
              showTooltip(event as MouseEvent, d);
            } catch (e) {
              errLog('event/mousemove', e);
            }
          })
          .on('mouseleave', (_event, _d) => {
            try {
              hideTooltip();
            } catch (e) {
              errLog('event/mouseleave', e);
            }
          })
          .on('mouseover', (_event, d) => {
            try {
              if (onHover) onHover(d.data);
            } catch (e) {
              errLog('event/mouseover', e);
            }
          })
          .on('mouseout', (_event, _d) => {
            try {
              if (onHover) onHover(null);
            } catch (e) {
              errLog('event/mouseout', e);
            }
          })
          .style('cursor', 'pointer');
      } catch (e) {
        errLog('enter-selection', e);
        return;
      }

      // ENTER + UPDATE
      try {
        const merged = enter.merge(join as any);
        merged
          .transition()
          .duration(animDuration)
          .attrTween('x', function (d: any) {
            const i = d3.interpolate((this as any).__y0 ?? d.y0, d.y0);
            return (t) => {
              const v = i(t);
              (this as any).__y0 = v;
              return String(v);
            };
          })
          .attrTween('y', function (d: any) {
            const i = d3.interpolate((this as any).__x0 ?? d.x0, d.x0);
            return (t) => {
              const v = i(t);
              (this as any).__x0 = v;
              return String(v);
            };
          })
          .attrTween('width', function (d: any) {
            const i = d3.interpolate((this as any).__y1 ?? d.y1, d.y1);
            return (t) => {
              const v = i(t);
              (this as any).__y1 = v;
              const w = Math.max(0.5, v - ((this as any).__y0 ?? d.y0));
              return String(w);
            };
          })
          .attrTween('height', function (d: any) {
            const i = d3.interpolate((this as any).__x1 ?? d.x1, d.x1);
            return (t) => {
              const v = i(t);
              (this as any).__x1 = v;
              const h = Math.max(0.5, v - ((this as any).__x0 ?? d.x0));
              return String(h);
            };
          })
          .attr('fill', (d) => colorFor(d))
          .attr('opacity', (d) => (rectVisible(d) ? 1 : 0));

        // Rebind event handlers on all cells to refresh closures
        merged
          .on('click', (_event, d) => {
            try {
              clicked(d);
              if (onNodeClick) onNodeClick(d.data);
            } catch (e) {
              errLog('event/click(rebind)', e, { nodeId: d?.data?.id });
            }
          })
          .on('keydown', (event: any, d) => {
            try {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                clicked(d);
                if (onNodeClick) onNodeClick(d.data);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                zoomToRoot();
              }
            } catch (e) {
              errLog('event/keydown(rebind)', e, { key: event?.key, nodeId: d?.data?.id });
            }
          })
          .on('mousemove', (event, d) => {
            try {
              showTooltip(event as MouseEvent, d);
            } catch (e) {
              errLog('event/mousemove(rebind)', e);
            }
          })
          .on('mouseleave', (_event, _d) => {
            try {
              hideTooltip();
            } catch (e) {
              errLog('event/mouseleave(rebind)', e);
            }
          })
          .on('mouseover', (_event, d) => {
            try {
              if (onHover) onHover(d.data);
            } catch (e) {
              errLog('event/mouseover(rebind)', e);
            }
          })
          .on('mouseout', (_event, _d) => {
            try {
              if (onHover) onHover(null);
            } catch (e) {
              errLog('event/mouseout(rebind)', e);
            }
          });
      } catch (e) {
        errLog('enter+update-transition', e);
      }

      // HEADER: focus title and stats (top-left)
      try {
        const focusTotals = root.value || globalTotalImmediate;
        const percentForAbsolute =
          viewMode === 'absolute' && typeof contextLimit === 'number' && contextLimit > 0
            ? Math.min(100, (focusTotals / contextLimit) * 100)
            : undefined;
        const statsText =
          percentForAbsolute !== undefined
            ? `${formatCount(focusTotals, sizeBasis)} • ${percentForAbsolute.toFixed(1)}% of context`
            : `${formatCount(focusTotals, sizeBasis)}`;

        let headerTitle = gHeader.select<SVGTextElement>('text.header-title');
        if (headerTitle.empty()) {
          headerTitle = gHeader
            .append('text')
            .attr('class', 'header-title')
            .attr('x', 8)
            .attr('y', 16)
            .attr('font-weight', 600)
            .attr('font-size', Math.max(10, Math.round(height * 0.04)))
            .text(data.name || 'Total');
        } else {
          headerTitle
            .transition()
            .duration(animDuration)
            .attr('font-size', Math.max(10, Math.round(height * 0.04)))
            .tween('text', () => {
              const target = data.name || 'Total';
              return (t) => {
                if (t === 1) headerTitle.text(target);
              };
            });
        }

        let headerStats = gHeader.select<SVGTextElement>('text.header-stats');
        if (headerStats.empty()) {
          headerStats = gHeader
            .append('text')
            .attr('class', 'header-stats')
            .attr('x', 8)
            .attr('y', 32)
            .attr('font-size', Math.max(10, Math.round(height * 0.03)))
            .attr('fill', '#555')
            .text(statsText);
        } else {
          headerStats
            .transition()
            .duration(animDuration)
            .attr('font-size', Math.max(10, Math.round(height * 0.03)))
            .tween('text', () => {
              return () => {
                headerStats.text(statsText);
              };
            });
        }
      } catch (e) {
        errLog('header-render', e);
      }

      // Accessibility: focus change initial broadcast (only once per dataset)
      try {
        if (onFocusChange && focusedNodeIdRef.current === null) {
          const ancestors = root.ancestors().map((a) => a.data);
          onFocusChange({ node: root.data, ancestors });
          focusedNodeIdRef.current = root.data.id;
        }
      } catch (e) {
        errLog('focus-change-initial', e);
      }

      initializedRef.current = true;

      // Tooltip handlers
      function showTooltip(evt: MouseEvent, d: d3.HierarchyRectangularNode<PromptNode>) {
        try {
          const tip = tooltipRef.current;
          if (!tip) return;

          const parent = d.parent;
          const nodeImmediate = d.data.value || 0;
          const nodeSubtreeTotal = d.value || nodeImmediate;
          const parentSubtreeTotal = parent ? parent.value || null : null;

          const { ofParent, ofTotal, ofContext } = computePercents({
            nodeSubtreeTotal,
            nodeImmediate,
            parentSubtreeTotal,
            globalTotal: globalTotalImmediate,
            viewMode,
            contextLimit,
          });

          // Identification details
          const attrs = d.data.attributes || {};
          const esc = (v: any) =>
            String(v ?? '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');

          const tag = (attrs as any)['__tag'] || '';
          const title = esc(d.data.name || '');
          const tagSuffix = tag && tag !== d.data.name ? ` <span style="opacity:0.8">(${esc(tag)})</span>` : '';
          const primary = `${title}${tagSuffix}`;

          const fileLike =
            (attrs as any).file ||
            (attrs as any).filepath ||
            (attrs as any).path ||
            d.data.path ||
            (attrs as any).src ||
            (attrs as any).url ||
            '';

          const shorten = (s: string, max = 64) =>
            s && s.length > max ? `${s.slice(0, Math.floor(max / 2) - 2)}…${s.slice(-Math.floor(max / 2) + 1)}` : s;

          const secondary = esc(shorten(String(fileLike)));

          // Key attributes first, then any others (skip our internal __-prefixed helpers)
          const keys = ['id', 'name', 'type', 'class'] as const;
          const keyAttrs: string[] = [];
          for (const k of keys) {
            const v = (attrs as any)[k];
            if (v !== undefined && v !== null && String(v).length) {
              keyAttrs.push(`${k}="${esc(v)}"`);
            }
          }
          const otherAttrs: string[] = [];
          for (const k in attrs) {
            if (Object.prototype.hasOwnProperty.call(attrs, k) && !keys.includes(k as any) && !k.startsWith('__')) {
              const v = (attrs as any)[k];
              if (v !== undefined && v !== null && String(v).length) {
                otherAttrs.push(`${esc(k)}="${esc(v)}"`);
              }
            }
          }
          const attrLine =
            keyAttrs.length || otherAttrs.length
              ? `<div style="margin-top:2px"><span style="opacity:0.85">Attributes:</span> ${[...keyAttrs, ...otherAttrs].join(' • ')}</div>`
              : '';

          tip.innerHTML = `
            <div style="font-weight:600;margin-bottom:2px">${primary}</div>
            ${secondary ? `<div style="font-size:11px;color:#ccc;max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${secondary}</div>` : ''}
            ${attrLine}
            <div style="border-top:1px solid rgba(255,255,255,0.18);margin:6px 0"></div>
            <div>Subtree: ${formatCount(nodeSubtreeTotal, sizeBasis)}${ofParent !== undefined ? ` • ${ofParent.toFixed(1)}% of parent` : ''} • ${ofTotal.toFixed(1)}% of total</div>
            <div>Node: ${formatCount(nodeImmediate, sizeBasis)}</div>
            ${ofContext !== undefined ? `<div>${ofContext.toFixed(1)}% of context</div>` : ''}
          `.trim();

          tip.style.opacity = '1';
          tip.style.left = `${evt.clientX + 10}px`;
          tip.style.top = `${evt.clientY + 10}px`;
        } catch (e) {
          errLog('tooltip/show', e);
        }
      }

      function hideTooltip() {
        try {
          const tip = tooltipRef.current;
          if (!tip) return;
          tip.style.opacity = '0';
        } catch (e) {
          errLog('tooltip/hide', e);
        }
      }

      // Zoom mechanics for icicle
      function clicked(p: d3.HierarchyRectangularNode<PromptNode>) {
        try {
          // Guard: validate the clicked node; if missing partition props, try resolving by id
          const isRectNode = (n: any): n is d3.HierarchyRectangularNode<PromptNode> =>
            n && typeof n.x0 === 'number' && typeof n.x1 === 'number' && typeof n.y0 === 'number' && typeof n.y1 === 'number';

          let pNode: d3.HierarchyRectangularNode<PromptNode> | undefined = isRectNode(p) ? p : undefined;
          if (!pNode) {
            const pid = (p as any)?.data?.id ?? (p as any)?.id;
            if (pid) {
              pNode = root.descendants().find((d) => d.data.id === pid);
            }
          }
          if (!pNode || !isRectNode(pNode)) {
            warn('clicked received invalid or stale node; ignoring', { node: (p as any)?.data?.id ?? (p as any)?.id });
            return;
          }

          const heightSpan = Math.max(1e-6, pNode.x1 - pNode.x0);
          root.each((d) => {
            (d as any).target = {
              // Vertical (size) dimension re-scales to clicked node's extent
              x0: ((d.x0 - pNode.x0) / heightSpan) * height,
              x1: ((d.x1 - pNode.x0) / heightSpan) * height,
              // Horizontal (depth) dimension shifts left so clicked starts at 0
              y0: Math.max(0, d.y0 - pNode.y0),
              y1: Math.max(0, d.y1 - pNode.y0),
            };
          });

          const t = gCells.transition().duration(animDuration);

          (gCells.selectAll<SVGRectElement, d3.HierarchyRectangularNode<PromptNode>>('rect.cell') as d3.Selection<
            SVGRectElement,
            d3.HierarchyRectangularNode<PromptNode>,
            any,
            any
          >)
            .transition(t as any)
            .tween('data', (d: any) => {
              if (!d || typeof d.x0 !== 'number' || !(d as any).target) {
                return () => {}; // no-op tween if data is invalid
              }
              const i = d3.interpolate({ x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 }, (d as any).target);
              return (t2: number) => {
                const v = i(t2);
                d.x0 = v.x0;
                d.x1 = v.x1;
                d.y0 = v.y0;
                d.y1 = v.y1;
              };
            })
            .attrTween('x', function (d: any) {
              return () => String(d?.y0 ?? 0);
            })
            .attrTween('y', function (d: any) {
              return () => String(d?.x0 ?? 0);
            })
            .attrTween('width', function (d: any) {
              return () => String(d ? Math.max(0.5, d.y1 - d.y0) : 0);
            })
            .attrTween('height', function (d: any) {
              return () => String(d ? Math.max(0.5, d.x1 - d.x0) : 0);
            })
            .attr('opacity', (d) => (rectVisible(d) ? 1 : 0));

          // Update header labels
          const focusTotal = pNode.value || pNode.data.value || 0;
          const absPct =
            viewMode === 'absolute' && typeof contextLimit === 'number' && contextLimit > 0
              ? Math.min(100, (focusTotal / contextLimit) * 100)
              : undefined;
          const txt =
            absPct !== undefined
              ? `${formatCount(focusTotal, sizeBasis)} • ${absPct.toFixed(1)}% of context`
              : `${formatCount(focusTotal, sizeBasis)}`;

          gHeader.select<SVGTextElement>('text.header-title').text(pNode.data.name || 'Total');
          gHeader.select<SVGTextElement>('text.header-stats').text(txt);

          if (onFocusChange) {
            const newId = pNode.data.id;
            if (focusedNodeIdRef.current !== newId) {
              const ancestors = pNode.ancestors().reverse().map((a) => a.data);
              onFocusChange({ node: pNode.data, ancestors });
              focusedNodeIdRef.current = newId;
            }
          }
        } catch (e) {
          errLog('zoom/clicked', e, { nodeId: p?.data?.id });
        }
      }

      function zoomToRoot() {
        try {
          clicked(root);
        } catch (e) {
          errLog('zoom/zoomToRoot', e);
        }
      }

      // Cleanup for this render pass
      return () => {
        try {
          gCells
            .selectAll<SVGRectElement, d3.HierarchyRectangularNode<PromptNode>>('rect.cell')
            .on('click', null)
            .on('keydown', null)
            .on('mousemove', null)
            .on('mouseleave', null)
            .on('mouseover', null)
            .on('mouseout', null);
        } catch (e) {
          // ignore
        }
        try {
          // Remove svg keydown handler to prevent stale closures
          d3.select(svgEl).on('keydown', null as any);
        } catch (e) {
          // ignore
        }
        // tooltip cleanup handled on unmount in separate effect
      };
    } catch (e) {
      errLog('effect', e);
      try {
        d3.select(svgEl).selectAll('*').remove();
      } catch (clearErr) {
        console.error('[useIcicleD3] failed to clear svg after error', clearErr);
      }
      try {
        if (tooltipRef.current) {
          tooltipRef.current.remove();
          tooltipRef.current = null;
        }
      } catch (tipErr) {
        console.error('[useIcicleD3] tooltip cleanup after effect error failed', tipErr);
      }
      return;
    } finally {
      console.groupEnd();
    }
  }, [
    svgRef,
    data,
    opts.width,
    opts.height,
    opts.sizeBasis,
    opts.viewMode,
    opts.contextLimit,
    opts.enableAnimations,
    opts.enableLOD,
    opts.maxVisibleNodes,
    opts.aggregationThreshold,
    opts.onNodeClick,
    opts.onHover,
    opts.onFocusChange,
    opts.onError,
    opts.debug,
  ]);

  useEffect(() => {
    return () => {
      try {
        if (tooltipRef.current) {
          tooltipRef.current.remove();
          tooltipRef.current = null;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[useIcicleD3] tooltip cleanup failed', e);
      }
    };
  }, []);

  return {};
}

export default useIcicleD3;