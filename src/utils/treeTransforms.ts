import type {
  XmlNodeMeta,
  PromptNode,
  TokenCache,
  SizeBasis,
  ModelId,
} from '@/types/models';

type NodeStats = {
  valueChars: number;
  valueTokens?: number; // immediate tokens if known
  totalChars: number; // subtree sum of immediate char counts
  totalTokensApprox: number; // subtree sum using tokens where available else chars as fallback
};

type StatsMap = Map<string, NodeStats>;

const DEFAULTS = {
  aggregationThreshold: 0.0075, // 0.75% of total
  maxVisibleNodes: 2000,
  maxDepth: Number.POSITIVE_INFINITY,
  previewLength: 160,
} as const;

function isOpaqueId(s?: string): boolean {
  if (!s) return false;
  const hexish = /^[a-f0-9]{16,}$/i.test(s);
  const b64ish = /^[A-Za-z0-9+/=]{16,}$/.test(s) && s.length % 4 === 0;
  return hexish || b64ish || s.length > 40;
}

function basename(p?: string): string | undefined {
  if (!p) return undefined;
  const parts = p.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last || p;
}

function firstNonOpaqueAttr(
  attrs: Record<string, string> | undefined,
  keys: string[]
): string | undefined {
  if (!attrs) return undefined;
  for (const k of keys) {
    const v = attrs[k];
    if (v && !isOpaqueId(v)) return v;
  }
  return undefined;
}

function friendlyName(meta: XmlNodeMeta): string {
  const attrs = meta.attrs;
  // Prefer explicit human-readable names or file-ish fields
  const preferred =
    firstNonOpaqueAttr(attrs, ['name', 'title', 'file', 'filepath']) ||
    basename(firstNonOpaqueAttr(attrs, ['path', 'src', 'uri', 'url'])) ||
    (meta.tag && meta.tag.toLowerCase() !== 'promptnode' ? meta.tag : undefined) ||
    (!isOpaqueId(attrs?.id) ? attrs?.id : undefined) ||
    meta.tag ||
    'node';
  return preferred;
}

function groupKey(attrs: Record<string, string> | undefined, path: string, tag: string): string {
  // Try to group by file/module/path-like info first; fall back to path or tag
  const g =
    firstNonOpaqueAttr(attrs, ['file', 'filepath', 'path', 'src', 'source', 'uri', 'url', 'module']) ||
    path ||
    tag;
  return g;
}

/**
 * Escape text for safe HTML display (no rendering of raw XML/HTML).
 */
function escapeHTML(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Attempt to extract a raw text content field if present on the XmlNodeMeta object.
 * Parsers in this project generally omit full text content for memory, but we
 * defensively check common field names ("content" or "text").
 */
function extractNodeText(meta: XmlNodeMeta): string | undefined {
  const anyNode = meta as any;
  if (typeof anyNode.content === 'string') return anyNode.content;
  if (typeof anyNode.text === 'string') return anyNode.text;
  return undefined;
}

/**
 * Create a trimmed, escaped preview for a node's content.
 */
function makePreview(meta: XmlNodeMeta, previewLength: number): string | undefined {
  const raw = extractNodeText(meta);
  if (!raw || raw.length === 0) return undefined;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const truncated = normalized.length > previewLength ? normalized.slice(0, previewLength) + '…' : normalized;
  return escapeHTML(truncated);
}

/**
 * Get immediate token count for a node from the cache (or XmlNodeMeta.tokenCount fallback).
 */
function getImmediateTokens(meta: XmlNodeMeta, modelId: ModelId, tokenCache: TokenCache): number | undefined {
  const key: `${string}:${ModelId}` = `${meta.hash}:${modelId}`;
  const cached = tokenCache[key];
  if (typeof cached === 'number' && !Number.isNaN(cached)) return cached;
  if (typeof meta.tokenCount === 'number' && !Number.isNaN(meta.tokenCount)) {
    // Note: tokenCount on XmlNodeMeta is not model-scoped by type; treat only as a fallback.
    return meta.tokenCount;
  }
  return undefined;
}

/**
 * Precompute per-node subtree totals (chars and tokens-with-fallback) in one DFS pass.
 */
function precomputeStats(
  meta: XmlNodeMeta,
  modelId: ModelId,
  tokenCache: TokenCache,
  stats: StatsMap
): NodeStats {
  const valueChars = meta.charCount || 0;
  const valueTokens = getImmediateTokens(meta, modelId, tokenCache);

  let totalChars = valueChars;
  let totalTokensApprox = typeof valueTokens === 'number' ? valueTokens : valueChars;

  if (meta.children && meta.children.length) {
    for (const child of meta.children) {
      const cs = precomputeStats(child, modelId, tokenCache, stats);
      totalChars += cs.totalChars;
      totalTokensApprox += cs.totalTokensApprox;
    }
  }

  const nodeStats: NodeStats = {
    valueChars,
    valueTokens,
    totalChars,
    totalTokensApprox,
  };
  stats.set(meta.id, nodeStats);
  return nodeStats;
}

/**
 * Build the PromptNode tree with aggregation + LOD options.
 */
function buildPromptNode(
  meta: XmlNodeMeta,
  stats: StatsMap,
  rootTotalBasis: number,
  basis: SizeBasis,
  modelId: ModelId,
  tokenCache: TokenCache,
  state: {
    aggregationThreshold: number;
    maxVisibleNodes: number;
    maxDepth: number;
    previewLength: number;
    visibleCount: number;
  },
  depth: number
): PromptNode {
  // Mark this node as visible
  state.visibleCount += 1;

  const s = stats.get(meta.id)!;

  // Immediate and total values in selected basis (with token fallback -> chars)
  const immediateValue =
    basis === 'tokens'
      ? (typeof s.valueTokens === 'number' ? s.valueTokens : s.valueChars)
      : s.valueChars;

  const totalInBasis = basis === 'tokens' ? s.totalTokensApprox : s.totalChars;

  // Construct the node shell
  const label = friendlyName(meta);
  const attrsOut: Record<string, string> = meta.attrs ? { ...meta.attrs } : {};
  attrsOut['__tag'] = meta.tag;
  attrsOut['__group'] = groupKey(meta.attrs, meta.path, meta.tag);

  const node: PromptNode = {
    id: meta.id,
    name: label,
    value: immediateValue,
    totalValue: totalInBasis,
    path: meta.path,
    content: makePreview(meta, state.previewLength),
    attributes: attrsOut,
    children: [],
  };

  // LOD: depth limit or visible node budget – if exceeded, do not expand children
  const canExpandDepth = depth < state.maxDepth;
  const canExpandBudget = state.visibleCount < state.maxVisibleNodes;

  if (!meta.children || meta.children.length === 0 || !canExpandDepth || !canExpandBudget) {
    // No expansion; children remain empty. totalValue already includes descendants.
    return node;
  }

  // Prepare children entries with their totals in the current basis
  const childEntries = meta.children.map((child) => {
    const cs = stats.get(child.id)!;
    const cTotal = basis === 'tokens' ? cs.totalTokensApprox : cs.totalChars;
    return { meta: child, total: cTotal };
  });

  // Sort children by descending total contribution
  childEntries.sort((a, b) => b.total - a.total);

  // Aggregation decision relative to ROOT total
  const smallThreshold = state.aggregationThreshold * rootTotalBasis;

  let keep: Array<{ meta: XmlNodeMeta; total: number }> = [];
  let aggregate: Array<{ meta: XmlNodeMeta; total: number }> = [];

  for (const entry of childEntries) {
    if (entry.total < smallThreshold) aggregate.push(entry);
    else keep.push(entry);
  }

  // Budget management for visible nodes at this level
  // Remaining slots for child nodes
  const remainingBudget = Math.max(0, state.maxVisibleNodes - state.visibleCount);
  if (remainingBudget <= 0) {
    // Cannot render any children
    return node;
  }

  // If we will show an aggregate node, reserve 1 slot for it.
  let willHaveAggregateNode = aggregate.length > 0;
  let allowedKeep = willHaveAggregateNode ? Math.max(0, remainingBudget - 1) : remainingBudget;

  // If keep exceeds allowed slots, move the smallest keep entries to aggregate
  if (keep.length > allowedKeep) {
    const excess = keep.length - allowedKeep;
    const moved = keep.splice(keep.length - excess, excess);
    aggregate = aggregate.concat(moved);
    willHaveAggregateNode = true;
    allowedKeep = Math.max(0, remainingBudget - 1);
  }

  // If no aggregate by threshold, but still too many children for budget, aggregate the overflow
  if (!willHaveAggregateNode && keep.length > remainingBudget) {
    const overflow = keep.splice(remainingBudget, keep.length - remainingBudget);
    aggregate = aggregate.concat(overflow);
    willHaveAggregateNode = true;
    allowedKeep = Math.max(0, remainingBudget - 1);
  }

  // Build kept children recursively
  for (const entry of keep) {
    if (state.visibleCount >= state.maxVisibleNodes) break;
    const childNode = buildPromptNode(
      entry.meta,
      stats,
      rootTotalBasis,
      basis,
      modelId,
      tokenCache,
      state,
      depth + 1
    );
    node.children.push(childNode);
  }

  // Add an "Other (n items)" node if we have anything aggregated and room for it
  if (aggregate.length > 0 && state.visibleCount < state.maxVisibleNodes) {
    // Sum totals of aggregated children for display/weighting
    let aggTotalInBasis = 0;
    for (const e of aggregate) aggTotalInBasis += e.total;

    const count = aggregate.length;
    const otherNode: PromptNode = {
      id: `${meta.id}::other`,
      name: `Other (${count} item${count === 1 ? '' : 's'})`,
      value: aggTotalInBasis, // represent collapsed subtree as a leaf with this weight
      totalValue: aggTotalInBasis,
      path: `${meta.path}/other`,
      content: undefined,
      attributes: {},
      children: [], // deferred; expanded on zoom by rebuilding at a deeper level
    };

    state.visibleCount += 1;
    node.children.push(otherNode);
  }

  return node;
}

/**
 * Public API: transform XmlNodeMeta → PromptNode with aggregation, LOD, totals, and previews.
 */
export function toPromptNode(
  rootMeta: XmlNodeMeta,
  sizeBasis: SizeBasis,
  modelId: ModelId,
  tokenCache: TokenCache,
  opts?: {
    aggregationThreshold?: number;
    maxVisibleNodes?: number;
    maxDepth?: number;
    previewLength?: number;
  }
): {
  tree: PromptNode;
  totals: { totalTokens: number; totalChars: number };
} {
  const aggregationThreshold =
    typeof opts?.aggregationThreshold === 'number' ? opts.aggregationThreshold : DEFAULTS.aggregationThreshold;
  const maxVisibleNodes =
    typeof opts?.maxVisibleNodes === 'number' ? opts.maxVisibleNodes : DEFAULTS.maxVisibleNodes;
  const maxDepth = typeof opts?.maxDepth === 'number' ? opts.maxDepth : DEFAULTS.maxDepth;
  const previewLength =
    typeof opts?.previewLength === 'number' ? opts.previewLength : DEFAULTS.previewLength;

  // Pass 1: compute subtree totals using token cache with char fallback
  const stats: StatsMap = new Map();
  const rootStats = precomputeStats(rootMeta, modelId, tokenCache, stats);

  // Root totals across full tree
  const totalChars = rootStats.totalChars;
  const totalTokens = rootStats.totalTokensApprox;

  // Size basis total used for thresholding tiny slices (relative to global)
  const rootTotalBasis = sizeBasis === 'tokens' ? totalTokens : totalChars;

  // Pass 2: build PromptNode tree with aggregation and LOD
  const state = {
    aggregationThreshold,
    maxVisibleNodes,
    maxDepth,
    previewLength,
    visibleCount: 0,
  };

  const tree = buildPromptNode(
    rootMeta,
    stats,
    rootTotalBasis,
    sizeBasis,
    modelId,
    tokenCache,
    state,
    0
  );

  return {
    tree,
    totals: { totalTokens, totalChars },
  };
}