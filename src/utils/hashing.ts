import xxhash, { type XXHashAPI } from 'xxhash-wasm';

/**
 * xxhash-wasm loader + helpers.
 *
 * Usage:
 *  await initHashing();
 *  const h = hashStringSync("content"); // synchronous after init
 */

let apiPromise: Promise<XXHashAPI> | null = null;
let api: XXHashAPI | null = null;

/**
 * Initialize the wasm hasher once. Call this before streaming operations.
 */
export async function initHashing(): Promise<void> {
  if (api) return;
  if (!apiPromise) {
    apiPromise = xxhash();
  }
  api = await apiPromise;
}

/**
 * Stable, deterministic attribute serialization for hashing.
 * Sorts keys; joins as "k=v" with "|" delimiter.
 */
export function stableAttrString(attrs?: Record<string, string>): string {
  if (!attrs) return '';
  const entries = Object.entries(attrs).filter(
    (e): e is [string, string] => typeof e[0] === 'string' && typeof e[1] === 'string'
  );
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join('|');
}

/**
 * Convert a 64-bit BigInt to a zero-padded 16-char hex string.
 */
function toHex64(v: bigint): string {
  let hex = v.toString(16);
  if (hex.length < 16) hex = '0'.repeat(16 - hex.length) + hex;
  return hex;
}

/**
 * Hash a Uint8Array synchronously. Requires initHashing() to have been awaited.
 */
export function hashBytesSync(bytes: Uint8Array, seed: number | bigint = 0): string {
  if (!api) {
    throw new Error('xxhash-wasm not initialized. Call initHashing() first.');
  }
  const seedBig = typeof seed === 'bigint' ? seed : BigInt(seed);
  // h64Raw accepts Uint8Array and returns a BigInt; convert to hex string
  const digest = api.h64Raw(bytes, seedBig);
  return toHex64(digest);
}

/**
 * Hash a string synchronously. Requires initHashing() to have been awaited.
 */
export function hashStringSync(input: string, seed: number | bigint = 0): string {
  const enc = new TextEncoder();
  return hashBytesSync(enc.encode(input), seed);
}

/**
 * Hash a string; ensures initialization first (async).
 */
export async function hashString(input: string, seed: number | bigint = 0): Promise<string> {
  await initHashing();
  return hashStringSync(input, seed);
}