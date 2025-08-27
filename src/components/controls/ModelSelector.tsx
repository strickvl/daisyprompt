import React from 'react';
import { useStore } from '@/state/useStore';
import { MODELS } from '@/types/models';
import type { ModelId } from '@/types/models';

function formatContextLimit(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

export default function ModelSelector() {
  const modelId = useStore((s) => s.modelId);
  const parseStatus = useStore((s) => s.parseStatus);
  const setModel = useStore((s) => s.actions.setModel);

  const models = Object.values(MODELS);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as ModelId;
    setModel(next);
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="model-select" className="sr-only">
        Select LLM model
      </label>
      <div className="relative">
        <select
          id="model-select"
          aria-label="Model selector"
          className="block w-56 appearance-none rounded-md border border-gray-300 bg-white px-2.5 py-1.5 pr-9 text-sm leading-5 text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          value={modelId}
          onChange={handleChange}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id} title={`${m.name} — ${formatContextLimit(m.contextLimit)}`}>
              {m.name} — {formatContextLimit(m.contextLimit)}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-500 dark:text-gray-400" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.188l3.71-3.958a.75.75 0 011.08 1.04l-4.24 4.523a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
          </svg>
        </span>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
        {parseStatus === 'parsing' ? 'Parsing XML…' : null}
      </div>
    </div>
  );
}