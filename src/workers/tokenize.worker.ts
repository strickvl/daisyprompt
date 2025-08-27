/**
 * Tokenizer Web Worker for DaisyPrompt
 * - Uses tokenizer adapters (default: tiktoken cl100k_base)
 * - Walks XmlNodeMeta tree breadth-first
 * - Uses in-adapter cache (hash:modelId) to avoid recomputation
 * - Batches tokenize:partial updates every ~16ms for responsiveness
 * - Emits progress and final totals
 */

import type { TokenizeRequest, TokenizeProgress, XmlNodeMeta, ModelId } from '@/types/models';
import { MODELS } from '@/types/models';
import { getTokenizerAdapter } from '@/utils/tokenizerAdapter';

/**
 * Time helpers
 */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

const BATCH_INTERVAL_MS = 16;

type Update = { id: string; hash: string; tokens: number };

/**
 * Attempt to extract raw text content from XmlNodeMeta if available.
 * Parser currently doesn't include full text content in XmlNodeMeta for memory reasons,
 * but if present (e.g., injected), we will use it. Otherwise, undefined.
 */
function extractNodeText(node: XmlNodeMeta): string | undefined {
  const anyNode = node as any;
  if (typeof anyNode.content === 'string') return anyNode.content;
  if (typeof anyNode.text === 'string') return anyNode.text;
  return undefined;
}

function countNodesBFS(root: XmlNodeMeta): number {
  let count = 0;
  const queue: XmlNodeMeta[] = [root];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    count += 1;
    if (node.children && node.children.length) {
      for (const c of node.children) queue.push(c);
    }
  }
  return count;
}

async function tokenizeTree(req: TokenizeRequest) {
  const { root, modelId } = req;
  const model = MODELS[modelId];
  const tokenizer = getTokenizerAdapter(model.tokenizerType);
  await tokenizer.ensureReady();

  const totalNodes = countNodesBFS(root);
  let processed = 0;
  let totalTokens = 0;

  const updates: Update[] = [];
  let lastFlushAt = nowMs();

  const flush = (force = false) => {
    const t = nowMs();
    if (!force && t - lastFlushAt < BATCH_INTERVAL_MS) return;
    if (updates.length > 0) {
      postMessage(
        { type: 'tokenize:partial', updates: updates.splice(0, updates.length) } as TokenizeProgress
      );
    }
    postMessage({ type: 'tokenize:progress', processed, total: totalNodes } as TokenizeProgress);
    lastFlushAt = t;
  };

  const queue: XmlNodeMeta[] = [root];

  while (queue.length > 0) {
    const node = queue.shift() as XmlNodeMeta;

    // BFS enqueue children first to keep traversal even
    if (node.children && node.children.length) {
      for (const child of node.children) {
        queue.push(child);
      }
    }

    // Compute tokens using cache or encode if necessary
    const rawText = extractNodeText(node);
    const cachedOrCounted = tokenizer.getOrCountTokens({
      hash: node.hash,
      modelId,
      text: rawText,
      // If raw text not present, approximate using char count, but do not cache approximations
      allowApprox: typeof rawText !== 'string',
      charCount: node.charCount,
    });

    const tokens = typeof cachedOrCounted === 'number' ? cachedOrCounted : 0;

    // Record update for this node (even cache hits), so UI can update token counts incrementally
    updates.push({ id: node.id, hash: node.hash, tokens });

    processed += 1;
    totalTokens += tokens;

    // Flush periodically to keep UI responsive and yield the worker
    flush(false);

    // Small cooperative yield after flush window to avoid long tight loops on massive trees
    if (nowMs() - lastFlushAt >= BATCH_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Final flush and done
  flush(true);
  postMessage({ type: 'tokenize:done', totals: { modelId, totalTokens } } as TokenizeProgress);
}

/**
 * Worker message handler
 */
self.onmessage = async (ev: MessageEvent) => {
  const data = ev.data as TokenizeRequest | unknown;

  if (!data || typeof data !== 'object') {
    postMessage({ type: 'tokenize:error', message: 'Invalid message payload' } as TokenizeProgress);
    return;
  }

  if ((data as TokenizeRequest).type !== 'tokenize:tree') {
    postMessage({ type: 'tokenize:error', message: 'Unsupported message type' } as TokenizeProgress);
    return;
  }

  const req = data as TokenizeRequest;

  try {
    await tokenizeTree(req);
  } catch (err: any) {
    postMessage(
      { type: 'tokenize:error', message: err?.message ? String(err.message) : String(err) } as TokenizeProgress
    );
  }
};

export {};