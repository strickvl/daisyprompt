/**
 * XML Parser Web Worker for DaisyPrompt
 * - Primary: fast-xml-parser with attributes + namespaces preserved
 * - Fallback: saxes streaming parser for very large XML
 * - Security: strips DTDs and processing instructions, never resolves entities
 * - Emits progressive updates: parse:progress, parse:partial, parse:done
 * - Computes charCount and per-node content hash (xxhash)
 */

import type { ParseRequest, ParseProgress, XmlNodeMeta } from '@/types/models';
import { XMLParser } from 'fast-xml-parser';
import { SaxesParser } from 'saxes';
import type { SaxesTag, SaxesAttribute } from 'saxes';
import { initHashing, hashStringSync, stableAttrString } from '@/utils/hashing';
import { classifyRepoPromptType } from '@/utils/semantic';

export type { ParseRequest, ParseProgress, XmlNodeMeta };

/**
 * Heuristics for switching to streaming fallback.
 * String length is a decent proxy for large XML.
 */
const STREAMING_THRESHOLD_CHARS = 2 * 1024 * 1024; // ~2MB
const STREAM_CHUNK_SIZE = 64 * 1024; // 64KB write chunks for saxes
const PARTIAL_EMIT_INTERVAL_MS = 30;
const PROGRESS_EMIT_INTERVAL_MS = 60;

/**
 * Basic sanitizer: remove DOCTYPE (including internal subset) and processing instructions.
 * We keep the XML declaration <?xml ...?>, but strip all other PIs.
 * This avoids DTD/entity declarations entirely.
 */
function sanitizeXml(xml: string): string {
  // Remove DOCTYPE with optional internal subset
  const withoutDoctype = xml.replace(/<!DOCTYPE[^<>\[\]]*(\[[\s\S]*?\])?[^>]*>/gi, '');
  // Remove processing instructions except the XML declaration at the start
  const withoutPIs = withoutDoctype.replace(/<\?(?!(xml\s))[\s\S]*?\?>/gi, '');
  return withoutPIs;
}

/**
 * Utility to check time without relying on performance existing.
 */
function nowMs(): number {
  // performance.now is available in workers in browsers; fallback to Date.now
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Classify node kind by simple heuristics.
 */
function classifyKind(tag: string, text: string, childCount: number): XmlNodeMeta['kind'] {
  const trimmed = text.trim();
  if (childCount === 0 && trimmed.length > 0) return 'text';
  const lower = tag.toLowerCase();
  if (lower === 'script' || lower === 'style' || lower.includes('code')) return 'code';
  if (
    lower === 'meta' ||
    lower === 'head' ||
    lower.startsWith('?') ||
    lower.startsWith('!') ||
    lower.includes('meta')
  ) {
    return 'metadata';
  }
  if (childCount > 0) return 'container';
  return 'other';
}

/**
 * Parse via fast-xml-parser, then walk to build XmlNodeMeta tree.
 */
async function parseWithFastXmlParser(xml: string, options: { preserveAttrs: boolean; namespace: boolean }) {
  const { preserveAttrs, namespace } = options;

  // Emit initial progress
  postMessage({ type: 'parse:progress', done: 0, total: xml.length, stage: 'parsing' } satisfies ParseProgress);

  // Configure parser to preserve attributes and namespaces, ignore PI/DTD
  const parser = new XMLParser({
    ignoreAttributes: !preserveAttrs ? true : false,
    attributeNamePrefix: '@_',
    // namespace handling
    ignoreNameSpace: namespace ? false : true,
    removeNSPrefix: false,
    // CDATA captured as text-like field we'll merge into text
    cdataTagName: '#cdata',
    // Keep raw strings; do not coerce to numbers/booleans
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    // Security related settings (may be ignored by fxp but harmless)
    allowBooleanAttributes: true,
    // Ignore declarations and processing instructions in output
    ignoreDeclaration: true,
  } as any);

  // Parse to an object; this is synchronous and may take time on large inputs.
  const jsObj = parser.parse(xml);

  // After parse, indicate move to "hashing" stage as we construct metrics/hashes.
  postMessage({
    type: 'parse:progress',
    done: Math.floor(xml.length * 0.6),
    total: xml.length,
    stage: 'hashing',
  } satisfies ParseProgress);

  // Build XmlNodeMeta tree
  const { root, processed } = buildMetaTreeFromFxp(jsObj, { preserveAttrs, namespace });

  // Final progress + done
  postMessage({
    type: 'parse:progress',
    done: xml.length,
    total: xml.length,
    stage: 'hashing',
  } satisfies ParseProgress);

  postMessage({ type: 'parse:done', root } satisfies ParseProgress);
}

/**
 * Convert fast-xml-parser output to XmlNodeMeta with progressive partial emissions.
 */
function buildMetaTreeFromFxp(
  jsObj: any,
  opts: { preserveAttrs: boolean; namespace: boolean }
): { root: XmlNodeMeta; processed: number } {
  // Find root: either a single property or synthesize a wrapper
  const keys = Object.keys(jsObj);
  let rootTag = 'document';
  let rootVal: any = jsObj;
  if (keys.length === 1) {
    rootTag = keys[0];
    rootVal = jsObj[rootTag];
  } else if (keys.length > 1) {
    // Wrap multiple roots under a synthetic "document"
    rootTag = 'document';
    rootVal = jsObj;
  }

  let processed = 0;
  let lastPartialAt = 0;
  let lastProgressAt = 0;

  // Per-depth sibling counters
  const levelCounters: Map<string, number>[] = [];

  const walk = (tag: string, nodeVal: any, depth: number, pathPrefix: string): XmlNodeMeta => {
    const counts = (levelCounters[depth] = levelCounters[depth] ?? new Map());
    const idx = (counts.get(tag) ?? 0) + 1;
    counts.set(tag, idx);
    const seg = `${tag}[${idx}]`;
    const path = pathPrefix ? `${pathPrefix}/${seg}` : seg;

    let attrs: Record<string, string> | undefined = undefined;
    let textContent = '';
    let children: XmlNodeMeta[] | undefined = undefined;

    const addChild = (child: XmlNodeMeta) => {
      if (!children) children = [];
      children.push(child);
    };

    // Extract attributes/text/children depending on nodeVal type
    if (typeof nodeVal === 'string' || typeof nodeVal === 'number' || typeof nodeVal === 'boolean') {
      textContent = String(nodeVal);
    } else if (nodeVal && typeof nodeVal === 'object') {
      // Attributes prefixed with '@_'
      const keys = Object.keys(nodeVal);
      for (const k of keys) {
        if (k === '#text' || k === '#cdata') continue;
        if (k.startsWith('@_')) {
          attrs = attrs ?? {};
          const attrName = k.slice(2); // remove '@_'
          const val = nodeVal[k];
          if (typeof val !== 'undefined' && val !== null) {
            attrs[attrName] = String(val);
          }
        }
      }

      // Text and CDATA
      if (typeof nodeVal['#text'] === 'string') textContent += nodeVal['#text'];
      if (typeof nodeVal['#cdata'] === 'string') textContent += nodeVal['#cdata'];

      // Children: any keys that are not attrs nor text/cdata
      for (const k of keys) {
        if (k.startsWith('@_') || k === '#text' || k === '#cdata') continue;
        const v = nodeVal[k];
        if (Array.isArray(v)) {
          for (const item of v) {
            const child = walk(k, item, depth + 1, path);
            addChild(child);
          }
        } else {
          const child = walk(k, v, depth + 1, path);
          addChild(child);
        }
      }
    }

    // Compute metrics
    const charCount = textContent.length;
    const hash = hashStringSync(`${stableAttrString(attrs)}|${textContent}`);

    const childCount = children ? (children as XmlNodeMeta[]).length : 0;
    const kind = classifyKind(tag, textContent, childCount);
    const rpType = classifyRepoPromptType(tag, attrs);

    const meta: XmlNodeMeta = {
      id: path,
      tag,
      attrs,
      path,
      kind,
      charCount,
      hash,
      rpType,
      children,
    };

    processed += 1;

    // Progressive emissions
    const t = nowMs();
    if (t - lastPartialAt > PARTIAL_EMIT_INTERVAL_MS) {
      postMessage({ type: 'parse:partial', subtree: meta } satisfies ParseProgress);
      lastPartialAt = t;
    }
    if (t - lastProgressAt > PROGRESS_EMIT_INTERVAL_MS) {
      postMessage({ type: 'parse:progress', done: processed, stage: 'hashing' } satisfies ParseProgress);
      lastProgressAt = t;
    }

    return meta;
  };

  const root = walk(rootTag, rootVal, 0, '');

  return { root, processed };
}

/**
 * Streaming parse using saxes. Handles very large XML progressively.
 */
async function parseWithSaxes(xml: string, options: { preserveAttrs: boolean; namespace: boolean }) {
  const { namespace } = options;

  // Prepare hashing upfront for sync usage
  await initHashing();

  // Progress counters
  let processed = 0;
  let lastPartialAt = 0;
  let lastProgressAt = 0;

  postMessage({ type: 'parse:progress', done: 0, total: xml.length, stage: 'parsing' } satisfies ParseProgress);

  type Frame = {
    tag: string;
    attrs?: Record<string, string>;
    textParts: string[];
    children: XmlNodeMeta[];
    idx: number;
    path: string;
  };

  const levelCounters: Map<string, number>[] = [];
  const stack: Frame[] = [];
  let rootNode: XmlNodeMeta | undefined;

  const parser = new SaxesParser({ xmlns: namespace });

  (parser as any).onerror = (err: Error) => {
    postMessage({ type: 'parse:error', message: `XML parsing error: ${err.message || String(err)}` } satisfies ParseProgress);
  };

  // For security, if a DOCTYPE is encountered we will ignore and continue,
  // since the input already had DTD stripped. This is an extra guard.
  (parser as any).ondoctype = () => {
    // ignore silently; we sanitize input beforehand to strip DTD completely
  };

  // Ignore processing instructions
  (parser as any).onprocessinginstruction = () => {
    // ignore
  };

  (parser as any).onopentag = (tag: SaxesTag) => {
    // tag.name is the raw (possibly prefixed) name
    const depth = stack.length;
    const counts = (levelCounters[depth] = levelCounters[depth] ?? new Map());
    const idx = (counts.get(tag.name) ?? 0) + 1;
    counts.set(tag.name, idx);
    const seg = `${tag.name}[${idx}]`;
    const path = depth === 0 ? seg : `${stack[depth - 1].path}/${seg}`;

    // Attributes: serialize name as provided by saxes (includes prefixes)
    let attrs: Record<string, string> | undefined = undefined;
    if (tag.attributes) {
      const attrsAny = tag.attributes as Record<string, string | SaxesAttribute>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(attrsAny)) {
        const val = typeof v === 'object' && v !== null && 'value' in v ? String((v as SaxesAttribute).value) : String(v);
        out[k] = val;
      }
      if (Object.keys(out).length > 0) attrs = out;
    }

    stack.push({
      tag: tag.name,
      attrs,
      textParts: [],
      children: [],
      idx,
      path,
    });

    const t = nowMs();
    if (t - lastProgressAt > PROGRESS_EMIT_INTERVAL_MS) {
      postMessage({ type: 'parse:progress', done: processed, total: xml.length, stage: 'parsing' } satisfies ParseProgress);
      lastProgressAt = t;
    }
  };

  (parser as any).ontext = (text: string) => {
    if (stack.length === 0) return;
    stack[stack.length - 1].textParts.push(text);
  };

  (parser as any).oncdata = (text: string) => {
    if (stack.length === 0) return;
    stack[stack.length - 1].textParts.push(text);
  };

  (parser as any).onclosetag = (_name: string) => {
    const frame = stack.pop();
    if (!frame) return;

    const text = frame.textParts.join('');
    const charCount = text.length;
    const hash = hashStringSync(`${stableAttrString(frame.attrs)}|${text}`);

    const kind = classifyKind(frame.tag, text, frame.children.length);
    const rpType = classifyRepoPromptType(frame.tag, frame.attrs);

    const node: XmlNodeMeta = {
      id: frame.path,
      tag: frame.tag,
      attrs: frame.attrs,
      path: frame.path,
      kind,
      charCount,
      hash,
      rpType,
      children: frame.children.length > 0 ? frame.children : undefined,
    };

    processed += 1;

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      rootNode = node;
    }

    const t = nowMs();
    if (t - lastPartialAt > PARTIAL_EMIT_INTERVAL_MS) {
      postMessage({ type: 'parse:partial', subtree: node } satisfies ParseProgress);
      lastPartialAt = t;
    }
    if (t - lastProgressAt > PROGRESS_EMIT_INTERVAL_MS) {
      postMessage({ type: 'parse:progress', done: processed, total: xml.length, stage: 'parsing' } satisfies ParseProgress);
      lastProgressAt = t;
    }
  };

  // Feed the parser in chunks to avoid big synchronous writes
  for (let i = 0; i < xml.length; i += STREAM_CHUNK_SIZE) {
    const chunk = xml.slice(i, i + STREAM_CHUNK_SIZE);
    parser.write(chunk);
    // Yield to event loop (implicitly by chunking), and emit progress
    const t = nowMs();
    if (t - lastProgressAt > PROGRESS_EMIT_INTERVAL_MS) {
      postMessage({ type: 'parse:progress', done: processed, total: xml.length, stage: 'parsing' } satisfies ParseProgress);
      lastProgressAt = t;
    }
  }
  parser.close();

  // Done
  if (!rootNode) {
    // Fallback to empty root if nothing parsed (e.g., empty or whitespace-only)
    rootNode = {
      id: 'document[1]',
      tag: 'document',
      path: 'document[1]',
      kind: 'other',
      charCount: 0,
      hash: hashStringSync('|'),
    };
  }

  // Final progress + done
  postMessage({
    type: 'parse:progress',
    done: xml.length,
    total: xml.length,
    stage: 'hashing',
  } satisfies ParseProgress);

  postMessage({ type: 'parse:done', root: rootNode } satisfies ParseProgress);
}

/**
 * Message handling
 */
self.onmessage = async (ev: MessageEvent) => {
  const data = ev.data as ParseRequest | unknown;

  if (!data || typeof data !== 'object') {
    postMessage({ type: 'parse:error', message: 'Invalid message payload' } satisfies ParseProgress);
    return;
  }

  if ((data as ParseRequest).type !== 'parse:xml') {
    // Unknown message type for this worker
    postMessage({ type: 'parse:error', message: 'Unsupported message type' } satisfies ParseProgress);
    return;
  }

  const req = data as ParseRequest;

  try {
    // Initialize hashing before any sync hashing operations
    await initHashing();

    // Sanitize XML input for security
    const sanitized = sanitizeXml(req.xml);

    const preserveAttrs = req.options?.preserveAttrs ?? true;
    const namespace = req.options?.namespace ?? true;

    // Decide strategy
    const shouldStream = sanitized.length >= STREAMING_THRESHOLD_CHARS;

    if (shouldStream) {
      await parseWithSaxes(sanitized, { preserveAttrs, namespace });
    } else {
      await parseWithFastXmlParser(sanitized, { preserveAttrs, namespace });
    }
  } catch (err: any) {
    postMessage({
      type: 'parse:error',
      message: err?.message ? String(err.message) : String(err),
    } satisfies ParseProgress);
  }
};

export {};