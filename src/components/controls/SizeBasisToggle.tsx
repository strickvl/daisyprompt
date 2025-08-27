import React, { useMemo } from 'react';
import { useStore } from '@/state/useStore';
import type { SizeBasis, ModelId } from '@/types/models';

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className || ''}`} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
    </svg>
  );
}

export default function SizeBasisToggle() {
  const modelId = useStore((s) => s.modelId);
  const sizeBasis = useStore((s) => s.sizeBasis);
  const parseStatus = useStore((s) => s.parseStatus);
  const totals = useStore((s) => s.totals);
  const tokenCache = useStore((s) => s.tokenCache);
  const setSizeBasis = useStore((s) => s.actions.setSizeBasis);

  const tokensKnown = useMemo(() => {
    const suffix = `:${modelId}` as const;
    for (const k in tokenCache) {
      if (k.endsWith(suffix)) return true;
    }
    return false;
  }, [tokenCache, modelId]);

  const tokensTotal = totals[modelId as ModelId]?.totalTokens;
  const tokensReady = typeof tokensTotal === 'number' || tokensKnown;

  const btnBase =
    'inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
  const selected =
    'bg-indigo-600 text-white hover:bg-indigo-600 border-indigo-600';
  const unselected =
    'bg-white text-gray-700 hover:bg-gray-50 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:border-gray-600';

  const isProxy = sizeBasis === 'chars' || (sizeBasis === 'tokens' && !tokensReady);

  const setBasis = (b: SizeBasis) => () => setSizeBasis(b);

  return (
    <div className="flex flex-col">
      <div role="group" aria-label="Size basis" className="inline-flex rounded-md shadow-sm border border-gray-300 overflow-hidden dark:border-gray-600">
        <button
          type="button"
          className={`${btnBase} ${sizeBasis === 'tokens' ? selected : unselected}`}
          aria-pressed={sizeBasis === 'tokens'}
          aria-label="Size by tokens"
          onClick={setBasis('tokens')}
        >
          <span className="mr-2">Tokens</span>
          {sizeBasis === 'tokens' && !tokensReady ? <Spinner className="text-white" /> : null}
        </button>
        <button
          type="button"
          className={`${btnBase} ${sizeBasis === 'chars' ? selected : unselected}`}
          aria-pressed={sizeBasis === 'chars'}
          aria-label="Size by characters"
          onClick={setBasis('chars')}
        >
          <span className="mr-2">Chars</span>
          <span
            className={`ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              sizeBasis === 'chars'
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
            aria-label="Proxy sizing badge"
            title="Using characters as proxy for tokens"
          >
            proxy
          </span>
        </button>
      </div>
      <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {isProxy
          ? 'Sizing by characters as a proxy while tokens compute.'
          : parseStatus === 'parsed'
          ? 'Sizing by tokens.'
          : 'Ready.'}
      </span>
    </div>
  );
}