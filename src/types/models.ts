// Core type definitions as specified in the design document

export type ModelId = string;

// Source of truth from XML parsing
export interface XmlNodeMeta {
  id: string;                       // stable (path-like or hash)
  tag: string;                      // element/tag name
  attrs?: Record<string, string>;
  path: string;                     // XPath-like or custom
  kind: 'text' | 'code' | 'metadata' | 'container' | 'other';
  charCount: number;                // immediate, cheap
  tokenCount?: number;              // per selected model (filled incrementally)
  hash: string;                     // content hash for de-dupe/cache
  children?: XmlNodeMeta[];
}

// View model for D3 visualization
export interface PromptNode {
  id: string;                       // unique id for D3 node
  name: string;                     // display label (usually tag)
  value: number;                    // node-only size (tokens or chars)
  totalValue: number;               // node + descendants
  path: string;                     // breadcrumb path
  content?: string;                 // trimmed preview (escaped)
  attributes: Record<string, string>;
  children: PromptNode[];
}

// Token caching strategy
export type TokenCacheKey = `${string}:${ModelId}`; // `${hash}:${modelId}`
export type TokenCache = Record<TokenCacheKey, number>;

// Per-model statistics
export interface PerModelTotals {
  [modelId: ModelId]: { totalTokens: number; totalChars: number };
}

// Model configurations
export interface ModelConfig {
  id: ModelId;
  name: string;
  contextLimit: number;
  tokenizerType: 'cl100k_base' | 'claude' | 'gemini' | 'custom';
  overheadTokens?: number; // System/tool wrapper overhead
}

// Predefined models from the design document
export const MODELS: Record<ModelId, ModelConfig> = {
  'gpt-4-128k': {
    id: 'gpt-4-128k',
    name: 'GPT-4 (128k)',
    contextLimit: 128000,
    tokenizerType: 'cl100k_base',
  },
  'claude-3-opus-200k': {
    id: 'claude-3-opus-200k',
    name: 'Claude 3 Opus (200k)',
    contextLimit: 200000,
    tokenizerType: 'claude',
  },
  'claude-3.5-sonnet-200k': {
    id: 'claude-3.5-sonnet-200k',
    name: 'Claude 3.5 Sonnet (200k)',
    contextLimit: 200000,
    tokenizerType: 'claude',
  },
  'gemini-1.5-pro-1m': {
    id: 'gemini-1.5-pro-1m',
    name: 'Gemini 1.5 Pro (1M)',
    contextLimit: 1000000,
    tokenizerType: 'gemini',
  },
};

// Worker message contracts for parsing
export type ParseRequest =
  | { type: 'parse:xml'; xml: string; options?: { preserveAttrs?: boolean; namespace?: boolean } };

export type ParseProgress =
  | { type: 'parse:progress'; done: number; total?: number; stage: 'parsing' | 'hashing' }
  | { type: 'parse:partial'; subtree: XmlNodeMeta }
  | { type: 'parse:done'; root: XmlNodeMeta }
  | { type: 'parse:error'; message: string };

// Worker message contracts for tokenization
export type TokenizeRequest = {
  type: 'tokenize:tree';
  root: XmlNodeMeta;
  modelId: ModelId;
};

export type TokenizeProgress =
  | { type: 'tokenize:progress'; processed: number; total?: number }
  | { type: 'tokenize:partial'; updates: Array<{ id: string; hash: string; tokens: number }> }
  | { type: 'tokenize:done'; totals: { modelId: ModelId; totalTokens: number } }
  | { type: 'tokenize:error'; message: string };

// Application state types
export type SizeBasis = 'tokens' | 'chars';
export type ViewMode = 'absolute' | 'relative';
export type VisualizationType = 'sunburst' | 'icicle';
export type ParseStatus = 'idle' | 'parsing' | 'parsed' | 'error';

// Search and selection
export interface SearchResult {
  nodeId: string;
  path: string;
  matchType: 'tag' | 'path' | 'content';
  score: number;
}

// Performance settings
export interface PerformanceConfig {
  maxVisibleNodes: number;        // Default 2000
  aggregationThreshold: number;   // Default 0.75% of total
  enableAnimations: boolean;
  enableLOD: boolean;             // Level of detail rendering
  debounceMs: number;            // Default 150ms
}

// Export formats
export type ExportFormat = 'png' | 'svg' | 'csv' | 'json';

export interface ExportOptions {
  format: ExportFormat;
  includeMetadata?: boolean;
  quality?: number; // For PNG
}