import type { ModelConfig, ModelId } from '@/types/models';

// Use lite build for browsers
import { Tiktoken } from '@dqbd/tiktoken/lite';
import cl100k_base from '@dqbd/tiktoken/encoders/cl100k_base.json';
import o200k_base from '@dqbd/tiktoken/encoders/o200k_base.json';

type TiktokenData = {
  // bpe_ranks is base64 encoded string in the JSON
  bpe_ranks: string;
  special_tokens: Record<string, number>;
  pat_str: string;
};

export type TokenizerType = ModelConfig['tokenizerType'];

export interface TokenizerAdapter {
  // Ensure underlying encoder is ready
  ensureReady(): Promise<void> | void;

  // Count tokens for text using the adapter's encoder
  encodeCount(text: string): number;

  // Approximate token count from character count (fallback when content text is unavailable)
  approxCountFromChars(chars: number): number;

  // Cache lookup and write helpers
  getFromCache(hash: string, modelId: ModelId): number | undefined;
  setCache(hash: string, modelId: ModelId, tokens: number): void;

  // High-level: fetch from cache or count-and-cache if text provided; optionally allow approximation
  getOrCountTokens(args: {
    hash: string;
    modelId: ModelId;
    text?: string;
    allowApprox?: boolean;
    charCount?: number;
  }): number | undefined;
}

/**
 * Base adapter providing cache helpers and default approximation policy.
 */
abstract class BaseAdapter implements TokenizerAdapter {
  protected cache: Map<`${string}:${ModelId}`, number> = new Map();

  ensureReady(): Promise<void> | void {
    // no-op by default
  }

  abstract encodeCount(text: string): number;

  approxCountFromChars(chars: number): number {
    // Reasonable default: ~4 chars per token
    if (chars <= 0) return 0;
    return Math.max(1, Math.ceil(chars / 4));
  }

  getFromCache(hash: string, modelId: ModelId): number | undefined {
    return this.cache.get(this.key(hash, modelId));
  }

  setCache(hash: string, modelId: ModelId, tokens: number): void {
    this.cache.set(this.key(hash, modelId), tokens);
  }

  getOrCountTokens(args: {
    hash: string;
    modelId: ModelId;
    text?: string;
    allowApprox?: boolean;
    charCount?: number;
  }): number | undefined {
    const { hash, modelId, text, allowApprox, charCount } = args;
    const cached = this.getFromCache(hash, modelId);
    if (typeof cached === 'number') {
      return cached;
    }

    if (typeof text === 'string') {
      const tokens = this.encodeCount(text);
      this.setCache(hash, modelId, tokens);
      return tokens;
    }

    if (allowApprox && typeof charCount === 'number') {
      // Do not cache approximations to allow future precise updates if text becomes available
      return this.approxCountFromChars(charCount);
    }

    return undefined;
  }

  protected key(hash: string, modelId: ModelId): `${string}:${ModelId}` {
    return `${hash}:${modelId}`;
  }
}

/**
 * Tiktoken adapter for cl100k_base (OpenAI GPT-4/3.5 family).
 */
class Cl100kAdapter extends BaseAdapter {
  private encoder?: Tiktoken;

  ensureReady(): void {
    if (!this.encoder) {
      const raw = cl100k_base as unknown as TiktokenData;
      this.encoder = new Tiktoken(raw.bpe_ranks, raw.special_tokens, raw.pat_str);
    }
  }

  encodeCount(text: string): number {
    if (!this.encoder) this.ensureReady();
    // encode_single_token_bytes not exposed in lite; standard encode is fine
    return this.encoder!.encode(text).length;
  }
}

/**
 * Tiktoken adapter for o200k_base (OpenAI GPT-5/O-family).
 */
class O200kAdapter extends BaseAdapter {
  private encoder?: Tiktoken;

  ensureReady(): void {
    if (!this.encoder) {
      const raw = o200k_base as unknown as TiktokenData;
      this.encoder = new Tiktoken(raw.bpe_ranks, raw.special_tokens, raw.pat_str);
    }
  }

  encodeCount(text: string): number {
    if (!this.encoder) this.ensureReady();
    return this.encoder!.encode(text).length;
  }
}

/**
 * Heuristic adapter for non-tiktoken models (Claude/Gemini) until precise tokenizers are added.
 * Uses a similar ~4 chars per token heuristic.
 */
class HeuristicAdapter extends BaseAdapter {
  constructor(private readonly charsPerToken = 4) {
    super();
  }
  encodeCount(text: string): number {
    // Treat encode as heuristic too
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / this.charsPerToken));
  }
  approxCountFromChars(chars: number): number {
    if (chars <= 0) return 0;
    return Math.max(1, Math.ceil(chars / this.charsPerToken));
  }
}

/**
 * Singleton adapter instances by tokenizer type to share caches across invocations.
 */
const instances: Partial<Record<TokenizerType, TokenizerAdapter>> = {};

export function getTokenizerAdapter(type: TokenizerType): TokenizerAdapter {
  if (instances[type]) return instances[type]!;
  let adapter: TokenizerAdapter;
  switch (type) {
    case 'cl100k_base':
      adapter = new Cl100kAdapter();
      break;
    case 'o200k_base':
      adapter = new O200kAdapter();
      break;
    case 'claude':
    case 'gemini':
    case 'custom':
    default:
      adapter = new HeuristicAdapter(4);
      break;
  }
  instances[type] = adapter;
  return adapter;
}

// Default cl100k_base adapter for convenience
export const defaultTokenizerAdapter: TokenizerAdapter = getTokenizerAdapter('cl100k_base');