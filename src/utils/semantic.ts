import type { RepoPromptElementType } from '@/types/models';

/**
 * Color-blind safe base palette mapping per RepoPrompt semantic type.
 * Colors are from the Okabe–Ito palette to maximize accessibility.
 *
 * Note: Variation (shading) is applied elsewhere (e.g., D3 layer) based on depth.
 */
export const SEMANTIC_PALETTE: Record<RepoPromptElementType, string> = {
  files: '#0072B2',        // blue
  instructions: '#D55E00', // vermillion
  meta_prompt: '#CC79A7',  // reddish purple
  file_tree: '#56B4E9',    // sky blue
  codemap: '#009E73',      // bluish green
  references: '#F0E442',   // yellow
  suggestions: '#E69F00',  // orange
  other: '#999999',        // grey
};

/**
 * Display order for semantic types in the legend.
 * This order prioritizes the most commonly scanned categories.
 */
export const SEMANTIC_ORDER: RepoPromptElementType[] = [
  'files',
  'file_tree',
  'codemap',
  'instructions',
  'meta_prompt',
  'references',
  'suggestions',
  'other',
];

/**
 * Human-friendly labels for each semantic type.
 * Keep labels short for compact header/overlay rendering.
 */
export const SEMANTIC_LABELS: Record<RepoPromptElementType, string> = {
  files: 'Files',
  instructions: 'Instructions',
  meta_prompt: 'Meta Prompt',
  file_tree: 'File Tree',
  codemap: 'Code Map',
  references: 'References',
  suggestions: 'Suggestions',
  other: 'Other',
};

export type SemanticLegendEntry = {
  key: RepoPromptElementType;
  label: string;
  color: string;
};

/**
 * Build legend entries in a stable display order with labels and base colours.
 * Charts and UI can consume this to stay consistent with classification colours.
 */
export function getSemanticLegendEntries(): SemanticLegendEntry[] {
  return SEMANTIC_ORDER.map((key) => ({
    key,
    label: SEMANTIC_LABELS[key],
    color: SEMANTIC_PALETTE[key],
  }));
}

/**
 * Normalize a tag name:
 * - Remove namespace prefixes like "rp:"
 * - Lowercase
 * - Tokenize on non-alphanumeric boundaries (keeps words like file_map → ["file", "map"])
 */
export function normalizeTag(tag: string): { base: string; tokens: string[] } {
  const raw = String(tag ?? '').trim();
  const withoutNs = raw.includes(':') ? raw.split(':').slice(-1)[0] : raw;
  const base = withoutNs.toLowerCase();
  const tokens = tokenizeString(base);
  return { base, tokens };
}

/**
 * Tokenize a string into lowercased alphanumeric tokens.
 * Splits on any sequence of non-alphanumeric characters: [_\W]+
 */
function tokenizeString(input: string): string[] {
  const raw = String(input ?? '').toLowerCase();
  const parts = raw.split(/[^a-z0-9]+/g).filter(Boolean);
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/**
 * Case-insensitive substring search for any needle in a given string value.
 */
function includesAny(haystack: string | undefined, needles: string[]): boolean {
  if (!haystack) return false;
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/**
 * Returns true if any of the given attribute keys exist (regardless of their value).
 */
function hasAnyAttr(attrs: Record<string, string> | undefined, keys: string[]): boolean {
  if (!attrs) return false;
  return keys.some((k) => Object.prototype.hasOwnProperty.call(attrs, k));
}

/**
 * Returns true if any of the given attribute keys contain any of the given substrings.
 */
function attrStringIncludes(
  attrs: Record<string, string> | undefined,
  keys: string[],
  needles: string[]
): boolean {
  if (!attrs) return false;
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === 'string' && includesAny(v, needles)) return true;
  }
  return false;
}

/**
 * Heuristic to detect presence of a file path-like attribute value.
 */
function isLikelyFilePath(attrs: Record<string, string> | undefined): boolean {
  if (!attrs) return false;
  const keys = ['file', 'filepath', 'path', 'src', 'url', 'uri'];
  for (const k of keys) {
    const v = attrs[k];
    if (!v) continue;
    const val = String(v).toLowerCase();
    // crude heuristic: contains a slash or dot typical of paths/urls
    if (val.includes('/') || val.includes('\\') || /\.[a-z0-9]{1,8}$/.test(val)) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a RepoPrompt element based on tag name and optional attributes.
 * Order of rules matters; more specific categories precede broader ones.
 */
export function classifyRepoPromptType(
  tag: string,
  attrs?: Record<string, string>
): RepoPromptElementType {
  const { base, tokens } = normalizeTag(tag);

  const has = (...tok: string[]) => tok.some((t) => tokens.includes(t));
  const hasAll = (...tok: string[]) => tok.every((t) => tokens.includes(t));

  // Aggregate attribute tokens from common semantic hint fields
  const attrTokens = tokenizeString(
    [attrs?.class, attrs?.type, attrs?.role, attrs?.name].filter(Boolean).join(' ')
  );

  const attrHas = (...tok: string[]) => tok.some((t) => attrTokens.includes(t));
  const attrHasAll = (...tok: string[]) => tok.every((t) => attrTokens.includes(t));

  // 1) suggestions
  if (
    base.startsWith('sugg') ||
    has('suggestion', 'suggestions', 'sugg') ||
    attrHas('sugg', 'suggestion', 'suggestions')
  ) {
    return 'suggestions';
  }

  // 2) file_tree (more specific than files)
  if (
    hasAll('file', 'map') ||
    hasAll('file', 'tree') ||
    has('filetree', 'file_map', 'filetree', 'filetree', 'directory', 'dir', 'tree') && has('file') ||
    base === 'file_map' ||
    base === 'filetree' ||
    base === 'file_tree' ||
    attrHasAll('file', 'tree') ||
    attrHasAll('file', 'map')
  ) {
    return 'file_tree';
  }

  // 3) codemap
  if (has('codemap') || hasAll('code', 'map') || attrHas('codemap') || attrHasAll('code', 'map')) {
    return 'codemap';
  }

  // 4) instructions
  if (
    has('user_instructions', 'instructions', 'instruction') ||
    attrHas('user_instructions', 'instructions', 'instruction') ||
    (base === 'prompt' && (attrHas('user') || attrStringIncludes(attrs, ['role', 'type'], ['user'])))
  ) {
    return 'instructions';
  }

  // 5) meta_prompt
  if (
    hasAll('meta', 'prompt') ||
    has('metaprompt', 'meta_prompt') ||
    attrHasAll('meta', 'prompt') ||
    (base === 'prompt' && attrStringIncludes(attrs, ['type', 'role'], ['meta', 'system', 'template']))
  ) {
    return 'meta_prompt';
  }

  // 6) references
  if (
    has('references', 'reference', 'refs', 'links', 'link', 'docs', 'documentation') ||
    attrHas('references', 'reference', 'refs', 'links', 'link', 'docs', 'documentation') ||
    hasAnyAttr(attrs, ['href', 'url', 'link'])
  ) {
    return 'references';
  }

  // 7) files (generic file containers and file contents)
  if (
    base === 'file' ||
    has('file', 'files', 'file_contents', 'filecontents', 'filecontent') ||
    attrHas('file', 'files', 'file_contents', 'filecontent', 'filecontents') ||
    isLikelyFilePath(attrs)
  ) {
    return 'files';
  }

  // 8) default
  return 'other';
}

/**
 * Quick luminance-based lightness check for HEX colours.
 * Useful for deciding whether to darken or lighten a shade for contrast.
 */
export function isLightColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  // sRGB luminance (per W3C)
  const [R, G, B] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  return luminance >= 0.7;
}

/**
 * Parse a HEX color string (#RGB or #RRGGBB) to RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b };
  }
  // Fallback to mid-gray if malformed input
  return { r: 128, g: 128, b: 128 };
}