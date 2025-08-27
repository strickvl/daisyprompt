import React, { useMemo } from 'react';
import { useStore } from '@/state/useStore';
import { MODELS } from '@/types/models';
import type { ModelId } from '@/types/models';

function classNames(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(' ');
}

function formatNumberCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${n}`;
}

export default function TokenDisplay() {
  const modelId = useStore((s) => s.modelId);
  const sizeBasis = useStore((s) => s.sizeBasis);
  const viewMode = useStore((s) => s.viewMode);
  const totals = useStore((s) => s.totals);
  const rootMeta = useStore((s) => s.rootMeta);
  const tokenCache = useStore((s) => s.tokenCache);

  const modelCfg = MODELS[modelId as ModelId];
  const contextLimit = modelCfg?.contextLimit || 1;

  const charTotalFromRoot = useMemo(() => {
    if (!rootMeta) return 0;
    let sum = 0;
    const q = [rootMeta];
    while (q.length) {
      const n = q.shift()!;
      sum += n.charCount || 0;
      if (n.children && n.children.length) {
        for (const c of n.children) q.push(c);
      }
    }
    return sum;
  }, [rootMeta]);

  const modelTotals = totals[modelId as ModelId];
  const knownTokens = typeof modelTotals?.totalTokens === 'number' ? modelTotals.totalTokens : undefined;
  const knownChars = typeof modelTotals?.totalChars === 'number' ? modelTotals.totalChars : undefined;
  const tokenEntriesForModel = useMemo(() => {
    const suffix = `:${modelId}`;
    let count = 0;
    for (const k in tokenCache) {
      if (k.endsWith(suffix)) count++;
    }
    return count;
  }, [tokenCache, modelId]);

  const chars = knownChars ?? charTotalFromRoot;
  const tokens = knownTokens;

  const usingTokens = sizeBasis === 'tokens' && typeof tokens === 'number';
  const value = usingTokens ? tokens! : chars;
  const isProxy = sizeBasis === 'chars' || (sizeBasis === 'tokens' && typeof tokens !== 'number');

  const percent = useMemo(() => {
    if (viewMode === 'relative') return 100;
    const pct = Math.max(0, Math.min(100, (value / contextLimit) * 100));
    return pct;
  }, [value, contextLimit, viewMode]);

  const strokeColor =
    percent < 70 ? '#22c55e' : percent < 90 ? '#eab308' : '#ef4444';

  const ring = {
    size: 64,
    stroke: 8,
  };
  const r = (ring.size - ring.stroke) / 2;
  const C = 2 * Math.PI * r;
  const dashOffset = C * (1 - percent / 100);

  return (
    <div className="flex items-center gap-3" aria-label="Total usage">
      <div className="relative" role="img" aria-label={`Usage: ${Math.round(percent)}% ${viewMode === 'absolute' ? 'of context' : 'relative'}`}>
        <svg width={ring.size} height={ring.size} viewBox={`0 0 ${ring.size} ${ring.size}`}>
          <circle
            cx={ring.size / 2}
            cy={ring.size / 2}
            r={r}
            stroke="#e5e7eb"
            strokeWidth={ring.stroke}
            fill="none"
          />
          <circle
            cx={ring.size / 2}
            cy={ring.size / 2}
            r={r}
            stroke={strokeColor}
            strokeWidth={ring.stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${ring.size / 2} ${ring.size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100" aria-live="polite">
            {formatNumberCompact(value)}
          </span>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {usingTokens ? 'Tokens' : 'Characters'}
          </span>
          {isProxy ? (
            <span
              className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
              title="Using characters as proxy while tokens compute"
            >
              proxy
            </span>
          ) : null}
          {sizeBasis === 'tokens' && typeof tokens !== 'number' ? (
            <span className="inline-flex items-center text-xs text-gray-500 dark:text-gray-400">
              calculating…
            </span>
          ) : null}
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {viewMode === 'absolute' ? (
            <>
              {Math.round(percent)}% of {formatNumberCompact(contextLimit)} context
            </>
          ) : (
            <>Relative view</>
          )}
        </div>
        {sizeBasis === 'tokens' ? (
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            Cache entries: {tokenEntriesForModel}
          </div>
        ) : null}
      </div>
    </div>
  );
}