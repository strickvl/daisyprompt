import * as d3 from 'd3';
import { useEffect, useRef } from 'react';
import type { PromptNode, SizeBasis, ViewMode, RepoPromptElementType } from '@/types/models';
import { SEMANTIC_PALETTE } from '@/utils/semantic';

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

/**
 * Options for the sunburst hook
 */
export interface SunburstOptions {
  width: number;
  height: number;
  sizeBasis: SizeBasis;
  viewMode?: ViewMode; // 'absolute' | 'relative'
  contextLimit?: number; // model context window limit for absolute mode
  enableAnimations?: boolean;
  onNodeClick?: (node: PromptNode) => void;
  onHover?: (node: PromptNode | null) => void;
  onFocusChange?: (focus: { node: PromptNode; ancestors: PromptNode[] }) => void;
}

/**
 * Public API returned by the hook
 */
export interface SunburstAPI {
  // noop for now; API reserved for future imperative controls
}

/**
 * Calculates the aggregated total of immediate values across the whole tree.
 * This is used for relative percentages and center totals.
 */
function sumImmediate(root: PromptNode): number {
  let total = 0;
  const stack: PromptNode[] = [root];
  while (stack.length) {
    const n = stack.pop() as PromptNode;
    total += typeof n.value === 'number' ? n.value : 0;
    if (n.children && n.children.length) {
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
  const { nodeSubtreeTotal, nodeImmediate, parentSubtreeTotal, globalTotal, viewMode, contextLimit } = args;
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
 * Create a color accessor for nodes using Okabe–Ito, keyed by stable group (file/module) with depth fallback.
 */
function makeColorAccessor(root: d3.HierarchyRectangularNode<PromptNode>) {
  const groupKeyOf = (n: d3.HierarchyRectangularNode<PromptNode>) =>
    ((n.data.attributes as any)?.__group as string) || n.data.name || n.data.id;

  // Prepare group-based ordinal scale (fallback path)
  const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

  let groups = root.children ? unique(root.children.map(groupKeyOf)) : [];
  if (groups.length <= 1) {
    const depth2 = root.descendants().filter((d) => d.depth === 2).map(groupKeyOf);
    groups = unique(depth2);
  }
  if (groups.length === 0) groups = [groupKeyOf(root)];

  const groupScale = d3.scaleOrdinal<string, string>().domain(groups).range(OKABE_ITO);

  // Build a robust resolver from arbitrary sem strings to palette keys:
  // - Accept values from attributes.__semType, attributes.semanticType, attributes.type, data.semanticType, data.type
  // - Normalize case, whitespace, hyphens/underscores
  // - Recognize common aliases (file -> files, instruction -> instructions, etc.)
  // - Only return keys that actually exist in SEMANTIC_PALETTE; unknowns return undefined to trigger group fallback
  const palette = SEMANTIC_PALETTE as Record<string, string>;
  const paletteIndex = new Map<string, string>();
  const paletteKeys = Object.keys(palette || {});
  // Precompute a tolerant lookup for palette keys
  for (const k of paletteKeys) {
    const lower = k.toLowerCase();
    const unders = lower.replace(/[\s-]+/g, '_');
    const dashy = lower.replace(/[\s_]+/g, '-');
    const simple = lower.replace(/[\s_-]+/g, '');
    paletteIndex.set(lower, k);
    paletteIndex.set(unders, k);
    paletteIndex.set(dashy, k);
    paletteIndex.set(simple, k);
    // Add a few helpful aliases mapping to this key
    if (lower === 'files') {
      paletteIndex.set('file', k);
      paletteIndex.set('repo_files', k);
      paletteIndex.set('source', k);
      paletteIndex.set('sources', k);
      paletteIndex.set('documents', k);
      paletteIndex.set('document', k);
    }
    if (lower === 'file_tree' || lower === 'file-tree') {
      paletteIndex.set('filetree', k);
      paletteIndex.set('tree', k);
    }
    if (lower === 'codemap' || lower === 'code_map') {
      paletteIndex.set('code_map', k);
      paletteIndex.set('codemap', k);
      paletteIndex.set('code', k);
      paletteIndex.set('code-map', k);
    }
    if (lower === 'meta_prompt' || lower === 'meta-prompt') {
      paletteIndex.set('metaprompt', k);
      paletteIndex.set('meta', k);
    }
    if (lower === 'instructions') {
      paletteIndex.set('instruction', k);
      paletteIndex.set('prompt', k);
    }
    if (lower === 'references') {
      paletteIndex.set('reference', k);
      paletteIndex.set('context', k);
      paletteIndex.set('citations', k);
    }
    if (lower === 'suggestions') {
      paletteIndex.set('suggestion', k);
      paletteIndex.set('hints', k);
    }
    if (lower === 'other') {
      paletteIndex.set('misc', k);
      paletteIndex.set('unknown', k);
      paletteIndex.set('none', k);
    }
  }

  const resolveSemKey = (raw: any): string | undefined => {
    if (raw === null || raw === undefined) return undefined;
    const s0 = String(raw).trim();
    if (!s0) return undefined;
    const s = s0.toLowerCase();
    const unders = s.replace(/[\s-]+/g, '_');
    const dashy = s.replace(/[\s_]+/g, '-');
    const simple = s.replace(/[\s_-]+/g, '');
    return paletteIndex.get(s) ?? paletteIndex.get(unders) ?? paletteIndex.get(dashy) ?? paletteIndex.get(simple);
  };

  const directSemKey = (n: d3.HierarchyRectangularNode<PromptNode>): string | undefined => {
    const attrs = (n.data.attributes as any) || {};
    // Prefer attribute-driven semantics over data fields to avoid default 'other' overriding specific tags
    const candidates = [
      attrs.__semType,
      attrs.semanticType,
      attrs.type,
      n.data.semanticType,
      (n.data as any)?.type,
    ];
    for (const c of candidates) {
      const k = resolveSemKey(c);
      if (k) return k;
    }
    return undefined;
  };

  const ancestorSemKey = (n: d3.HierarchyRectangularNode<PromptNode>): string | undefined => {
    // Walk up to find the nearest ancestor with a specific (non-'other') semantic category
    let a = n.parent || null;
    while (a) {
      const k = directSemKey(a);
      if (k && k.toLowerCase() !== 'other') return k;
      a = a.parent || null;
    }
    return undefined;
  };

  // Semantic helpers: prefer specific node semantics; if absent or 'other', inherit a non-'other' ancestor if available
  const getSemType = (n: d3.HierarchyRectangularNode<PromptNode>): RepoPromptElementType | undefined => {
    const k = directSemKey(n);
    if (k && k.toLowerCase() !== 'other') return k as RepoPromptElementType;
    const ancestor = ancestorSemKey(n);
    if (!k && ancestor) return ancestor as RepoPromptElementType;
    if (k && k.toLowerCase() === 'other') {
      const otherKey = paletteIndex.get('other') || 'other';
      return (ancestor || otherKey) as RepoPromptElementType;
    }
    return undefined;
  };

  // Find the highest ancestor that shares the same semantic type for relative depth shading
  const findCategoryRoot = (n: d3.HierarchyRectangularNode<PromptNode>): d3.HierarchyRectangularNode<PromptNode> => {
    const t = getSemType(n);
    if (!t) {
      // If no semantic type could be resolved, stick to the immediate ring ancestor for stable fallback behaviour
      const anc = n.ancestors().reverse();
      return anc[1] || anc[0];
    }
    let a: d3.HierarchyRectangularNode<PromptNode> = n;
    while (a.parent && getSemType(a.parent) === t) a = a.parent;
    return a;
  };

  // Shade the base color by relative depth within the semantic category.
  // Light bases are darkened, dark bases are lightened to improve perceptual separation while retaining category identity.
  const shadeWithinCategory = (baseHex: string, relDepth: number): string => {
    const c = d3.hsl(baseHex);
    const isLight = c.l >= 0.7;
    const delta = Math.min(0.28, Math.max(0, relDepth) * 0.08);
    c.l = isLight ? Math.max(0.25, c.l - delta) : Math.min(0.95, c.l + delta);
    return c.formatHex();
  };

  // Cache per-node computed colors to avoid repeated work on interactive transitions
  const cache = new Map<string, string>();

  const colorFor = (d: d3.HierarchyRectangularNode<PromptNode>): string => {
    const key = d.data.id;
    const hit = cache.get(key);
    if (hit) return hit;

    // Semantic-category colouring if resolvable
    const sem = getSemType(d);
    if (sem) {
      const baseHex = (SEMANTIC_PALETTE as any)[sem] || OKABE_ITO[0];
      const rootOfType = findCategoryRoot(d);
      const relDepth = Math.max(0, d.depth - rootOfType.depth);
      const out = shadeWithinCategory(baseHex, relDepth);
      cache.set(key, out);
      return out;
    }

    // Fallback: group-based colour using Okabe–Ito palette keyed by top ancestor group
    const anc = d.ancestors().reverse();
    const top = anc[1] || anc[0];
    const baseKey = groupKeyOf(top);
    const baseHex = groupScale(baseKey) || OKABE_ITO[0];

    const relDepth = Math.max(0, d.depth - (top.depth || 0));
    const rgb = d3.rgb(baseHex);
    const adjusted = relDepth > 0 ? rgb.brighter(Math.min(1.25, relDepth * 0.25)) : rgb;

    const out = adjusted.formatHex();
    cache.set(key, out);
    return out;
  };

  return colorFor;
}

/**
 * Main D3 hook that renders a zoomable sunburst inside the given SVG.
 */
export function useSunburstD3(svgRef: React.RefObject<SVGSVGElement>, data: PromptNode | undefined, opts: SunburstOptions): SunburstAPI {
  const initializedRef = useRef(false);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const focusedNodeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const { width, height, sizeBasis, viewMode, contextLimit } = opts;
    // If a new dataset is provided (different root id), reset the focus sentinel so we announce once for the new tree.
    if (data && focusedNodeIdRef.current && focusedNodeIdRef.current !== data.id) {
      focusedNodeIdRef.current = null;
    }
    if (!data) {
      // Clear if no data
      d3.select(svgEl).selectAll('*').remove();
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
      return;
    }

    const enableAnimations = opts.enableAnimations !== false;
    const duration = enableAnimations ? 300 : 0;

    const radius = Math.max(1, Math.min(width, height) / 2);

    // First, build the hierarchy to calculate totals
    const hierarchy = d3
      .hierarchy<PromptNode>(data)
      .sum((d) => Math.max(0, typeof d.value === 'number' ? d.value : 0)) // size by immediate node.value (not totalValue)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // Calculate the total tokens before partitioning
    const globalTotalImmediate = hierarchy.value || sumImmediate(data);

    // Calculate the angular extent based on viewMode
    // In absolute mode, scale the chart based on actual usage vs context limit
    // In relative mode, always use the full circle
    const angularExtent = (() => {
      if (opts.viewMode === 'absolute' && opts.contextLimit && opts.contextLimit > 0) {
        // Calculate what proportion of the context window is being used
        const proportion = Math.min(1.0, globalTotalImmediate / opts.contextLimit);
        // Scale the angular extent accordingly
        return 2 * Math.PI * proportion;
      }
      // Relative mode or no context limit: use full circle
      return 2 * Math.PI;
    })();

    // Build partition with scaled angular extent
    const root: d3.HierarchyRectangularNode<PromptNode> = d3
      .partition<PromptNode>()
      .size([angularExtent, radius])(hierarchy);

    // Accessors
    const arc = d3
      .arc<d3.HierarchyRectangularNode<PromptNode>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => d.y1)
      .cornerRadius(1);

    const colorFor = makeColorAccessor(root);

    // Prepare SVG scaffold only once; subsequent renders rebind data
    const svg = d3
      .select(svgEl)
      .attr('viewBox', `${-width / 2} ${-height / 2} ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'Sunburst chart')
      .attr('tabindex', 0)
      .style('cursor', 'default');

    let gRoot = svg.select<SVGGElement>('g.sunburst-root');
    if (gRoot.empty()) {
      gRoot = svg.append('g').attr('class', 'sunburst-root');
    }

    // Add background arc group for absolute mode
    let gBackground = gRoot.select<SVGGElement>('g.background');
    if (gBackground.empty()) {
      gBackground = gRoot.append('g').attr('class', 'background');
    }

    let gArcs = gRoot.select<SVGGElement>('g.arcs');
    if (gArcs.empty()) {
      gArcs = gRoot.append('g').attr('class', 'arcs');
    }

    let gCenter = gRoot.select<SVGGElement>('g.center');
    if (gCenter.empty()) {
      gCenter = gRoot.append('g').attr('class', 'center');
    }

    // Tooltip (single persistent div)
    if (!tooltipRef.current) {
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
    }

    // Visibility predicate for current zoom/focus
    function arcVisible(d: d3.HierarchyRectangularNode<PromptNode>): boolean {
      return d.y1 <= radius && d.y0 >= 0 && d.x1 > d.x0;
    }

    // Render background arc in absolute mode to show unused context
    if (opts.viewMode === 'absolute' && opts.contextLimit && opts.contextLimit > 0 && angularExtent < 2 * Math.PI) {
      const backgroundArc = d3
        .arc()
        .innerRadius(0)
        .outerRadius(radius)
        .startAngle(0)
        .endAngle(2 * Math.PI);

      // Create or update background arc
      let bgPath = gBackground.select<SVGPathElement>('path.context-background');
      if (bgPath.empty()) {
        bgPath = gBackground
          .append('path')
          .attr('class', 'context-background')
          .attr('fill', 'var(--dp-context-bg, #f3f4f6)')
          .attr('fill-opacity', 0.3)
          .attr('stroke', 'var(--dp-context-stroke, #d1d5db)')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.5)
          .attr('stroke-dasharray', '4 2');
      }
      
      bgPath
        .transition()
        .duration(duration)
        .attr('d', backgroundArc as any);
    } else {
      // Remove background arc in relative mode
      gBackground.select('path.context-background')
        .transition()
        .duration(duration)
        .style('opacity', 0)
        .remove();
    }

    // Build node list (exclude root ring)
    const nodes: Array<d3.HierarchyRectangularNode<PromptNode>> = root.descendants().filter((d) => d.depth > 0);

    // Data binding with event handler cleanup to prevent stale closures
    gArcs
      .selectAll<SVGPathElement, d3.HierarchyRectangularNode<PromptNode>>('path.slice')
      .on('click', null)
      .on('keydown', null)
      .on('mousemove', null)
      .on('mouseleave', null)
      .on('mouseover', null)
      .on('mouseout', null);

    const join = gArcs
      .selectAll<SVGPathElement, d3.HierarchyRectangularNode<PromptNode>>('path.slice')
      .data(nodes, (d: any) => d.data.id);

    // EXIT
    join
      .exit()
      .transition()
      .duration(duration)
      .style('opacity', 0)
      .remove();

    // ENTER
    const enter = join
      .enter()
      .append('path')
      .attr('class', 'slice')
      .attr('fill', (d) => colorFor(d))
      .attr('d', (d) => {
        // Blossom effect: start collapsed near center on first render
        if (!initializedRef.current) {
          const init = { ...d };
          (init as any).y0 = 0;
          (init as any).y1 = 0;
          return arc(init as any);
        }
        return arc(d);
      })
      .attr('fill-opacity', (d) => (arcVisible(d) ? 1 : 0))
      .attr('aria-label', (d) => `${d.data.name}: ${formatCount(d.data.value || 0, sizeBasis)}`)
      .attr('role', 'treeitem')
      .attr('tabindex', 0)
      .on('click', (_event, d) => {
        clicked(d);
        if (opts.onNodeClick) opts.onNodeClick(d.data);
      })
      .on('focus', (_event, _d) => {
        // no-op; focus styling handled by browser, tooltip on hover only
      })
      .on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          clicked(d);
          if (opts.onNodeClick) opts.onNodeClick(d.data);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          zoomToParent();
        }
      })
      .on('mousemove', (event, d) => showTooltip(event as MouseEvent, d))
      .on('mouseleave', (_event, _d) => hideTooltip())
      .on('mouseover', (_event, d) => {
        if (opts.onHover) opts.onHover(d.data);
      })
      .on('mouseout', (_event, _d) => {
        if (opts.onHover) opts.onHover(null);
      })
      .style('cursor', 'pointer');

    // ENTER + UPDATE
    const merged = enter.merge(join as any);

    merged
      .transition()
      .duration(duration)
      .attrTween('d', function (d) {
        // Animate blossom on first render; otherwise smooth position/angle updates
        const i = d3.interpolate(
          initializedRef.current
            ? { x0: (this as any).__x0 || d.x0, x1: (this as any).__x1 || d.x1, y0: (this as any).__y0 || d.y0, y1: (this as any).__y1 || d.y1 }
            : { x0: d.x0, x1: d.x1, y0: 0, y1: 0 },
          { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 }
        );
        return (t) => {
          const v = i(t);
          (this as any).__x0 = v.x0;
          (this as any).__x1 = v.x1;
          (this as any).__y0 = v.y0;
          (this as any).__y1 = v.y1;
          return arc(v as any) || '';
        };
      })
      .attr('fill', (d) => colorFor(d))
      .attr('fill-opacity', (d) => (arcVisible(d) ? 1 : 0));

    // Rebind event handlers on all slices to refresh closures and avoid stale handlers
    merged
      .on('click', (_event, d) => {
        clicked(d);
        if (opts.onNodeClick) opts.onNodeClick(d.data);
      })
      .on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          clicked(d);
          if (opts.onNodeClick) opts.onNodeClick(d.data);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          zoomToParent();
        }
      })
      .on('mousemove', (event, d) => showTooltip(event as MouseEvent, d))
      .on('mouseleave', (_event, _d) => hideTooltip())
      .on('mouseover', (_event, d) => {
        if (opts.onHover) opts.onHover(d.data);
      })
      .on('mouseout', (_event, _d) => {
        if (opts.onHover) opts.onHover(null);
      });

    // CENTER: circle + labels
    const centerRadius = Math.max(16, radius * 0.26);

    let centerCircle = gCenter.select<SVGCircleElement>('circle.core');
    if (centerCircle.empty()) {
      centerCircle = gCenter
        .append('circle')
        .attr('class', 'core')
        .attr('r', centerRadius)
        .attr('fill', 'var(--dp-center-fill, #f9fafb)')
        .attr('stroke', 'var(--dp-center-stroke, #d1d5db)')
        .attr('stroke-width', 1)
        .attr('role', 'button')
        .attr('tabindex', 0)
        .attr('aria-label', 'Zoom out')
        .on('click', () => zoomToParent())
        .on('keydown', (event: any) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            zoomToParent();
          }
        })
        .style('cursor', 'pointer');
    } else {
      centerCircle.transition().duration(duration).attr('r', centerRadius);
    }

    let centerTitle = gCenter.select<SVGTextElement>('text.center-title');
    if (centerTitle.empty()) {
      centerTitle = gCenter
        .append('text')
        .attr('class', 'center-title')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('y', -8)
        .attr('font-weight', 600)
        .attr('font-size', Math.max(10, Math.round(radius * 0.08)))
        .text(data.name || 'Total');
    } else {
      centerTitle
        .transition()
        .duration(duration)
        .attr('font-size', Math.max(10, Math.round(radius * 0.08)))
        .tween('text', () => {
          const target = data.name || 'Total';
          return (t) => {
            if (t === 1) centerTitle.text(target);
          };
        });
    }

    let centerStats = gCenter.select<SVGTextElement>('text.center-stats');
    const focusTotals = root.value || globalTotalImmediate;
    const percentForAbsolute =
      viewMode === 'absolute' && typeof contextLimit === 'number' && contextLimit > 0
        ? Math.min(100, (focusTotals / contextLimit) * 100)
        : undefined;

    const statsText =
      percentForAbsolute !== undefined
        ? `${formatCount(focusTotals, sizeBasis)} • ${percentForAbsolute.toFixed(1)}% of context`
        : `${formatCount(focusTotals, sizeBasis)}`;

    if (centerStats.empty()) {
      centerStats = gCenter
        .append('text')
        .attr('class', 'center-stats')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('y', 12)
        .attr('font-size', Math.max(10, Math.round(radius * 0.06)))
        .attr('fill', '#555')
        .text(statsText);
    } else {
      centerStats
        .transition()
        .duration(duration)
        .attr('font-size', Math.max(10, Math.round(radius * 0.06)))
        .tween('text', () => {
          return () => {
            centerStats.text(statsText);
          };
        });
    }

    // Accessibility: announce focus exactly once on initial mount (or after dataset change)
    if (opts.onFocusChange && focusedNodeIdRef.current === null) {
      const ancestors = root.ancestors().map((a) => a.data);
      try {
        opts.onFocusChange({ node: root.data, ancestors });
      } finally {
        focusedNodeIdRef.current = root.data.id;
      }
    }

    initializedRef.current = true;

    // Helper: Tooltip handlers
    function showTooltip(evt: MouseEvent, d: d3.HierarchyRectangularNode<PromptNode>) {
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

      // Key attributes first, then any others
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
    }

    function hideTooltip() {
      const tip = tooltipRef.current;
      if (!tip) return;
      tip.style.opacity = '0';
    }

    // Zoom mechanics adapted from Observable's Zoomable Sunburst
    function clicked(p: d3.HierarchyRectangularNode<PromptNode>) {
      // Guard: ensure the clicked node has the required partition props. If not, try to resolve from current root.
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
        console.warn('[useSunburstD3] clicked called with invalid or stale node; ignoring.');
        return;
      }

      root.each((d) => {
        (d as any).target = {
          x0: Math.max(0, Math.min(2 * Math.PI, d.x0 + (pNode.x0 - root.x0))),
          x1: Math.max(0, Math.min(2 * Math.PI, d.x1 + (pNode.x0 - root.x0))),
          y0: Math.max(0, d.y0 - pNode.y0),
          y1: Math.max(0, d.y1 - pNode.y0),
        };
      });

      const t = gArcs.transition().duration(duration);

      // Select all slices fresh to avoid stale references
      (gArcs.selectAll<SVGPathElement, d3.HierarchyRectangularNode<PromptNode>>('path.slice') as d3.Selection<SVGPathElement, d3.HierarchyRectangularNode<PromptNode>, any, any>)
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
        .attrTween('d', function (d: any) {
          return () => d ? (arc(d as any) || '') : '';
        })
        .attr('fill-opacity', (d) => (arcVisible(d) ? 1 : 0));

      // Update center labels to reflect new focus subtree totals
      const focusTotal = pNode.value || pNode.data.value || 0;
      const absPct =
        viewMode === 'absolute' && typeof contextLimit === 'number' && contextLimit > 0
          ? Math.min(100, (focusTotal / contextLimit) * 100)
          : undefined;
      const txt =
        absPct !== undefined
          ? `${formatCount(focusTotal, sizeBasis)} • ${absPct.toFixed(1)}% of context`
          : `${formatCount(focusTotal, sizeBasis)}`;

      gCenter.select<SVGTextElement>('text.center-title').text(pNode.data.name || 'Total');
      gCenter.select<SVGTextElement>('text.center-stats').text(txt);

      if (opts.onFocusChange) {
        const newId = pNode.data.id;
        if (focusedNodeIdRef.current !== newId) {
          const ancestors = pNode.ancestors().reverse().map((a) => a.data);
          opts.onFocusChange({ node: pNode.data, ancestors });
          focusedNodeIdRef.current = newId;
        }
      }
    }

    function zoomToParent() {
      // Simplified: zoom back to the root
      clicked(root);
    }

    // Cleanup
    return () => {
      try {
        gArcs
          .selectAll<SVGPathElement, d3.HierarchyRectangularNode<PromptNode>>('path.slice')
          .on('click', null)
          .on('keydown', null)
          .on('mousemove', null)
          .on('mouseleave', null)
          .on('mouseover', null)
          .on('mouseout', null);
        gCenter.select<SVGCircleElement>('circle.core').on('click', null).on('keydown', null);
      } catch {
        // no-op
      }
    };
  }, [
    svgRef,
    data,
    opts.width,
    opts.height,
    opts.sizeBasis,
    opts.viewMode,
    opts.contextLimit,
    opts.enableAnimations,
    opts.onNodeClick,
    opts.onHover,
    opts.onFocusChange,
  ]);

  useEffect(() => {
    return () => {
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
    };
  }, []);

  return {};
}

export default useSunburstD3;