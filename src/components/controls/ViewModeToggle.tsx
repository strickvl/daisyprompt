import React from 'react';
import { useStore } from '@/state/useStore';
import type { ViewMode, VisualizationType } from '@/types/models';
import { MODELS } from '@/types/models';

export default function ViewModeToggle() {
  const modelId = useStore((s) => s.modelId);
  const viewMode = useStore((s) => s.viewMode);
  const chartType = useStore((s) => s.visualizationType);
  const setViewMode = useStore((s) => s.actions.setViewMode);
  const setChartType = useStore((s) => s.actions.setVisualizationType);

  const model = MODELS[modelId];
  const hasAbsolute = !!model?.contextLimit && model.contextLimit > 0;

  const btnBase =
    'inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
  const selected =
    'bg-indigo-600 text-white hover:bg-indigo-600 border-indigo-600';
  const unselected =
    'bg-white text-gray-700 hover:bg-gray-50 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:border-gray-600';

  const setMode = (mode: ViewMode) => () => setViewMode(mode);
  const setType = (type: VisualizationType) => () => setChartType(type);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id="chart-type-label" className="sr-only">Chart Type</span>
      <div role="group" aria-labelledby="chart-type-label" className="inline-flex rounded-md shadow-sm border border-gray-300 overflow-hidden dark:border-gray-600">
        <button
          type="button"
          className={`${btnBase} ${chartType === 'sunburst' ? selected : unselected}`}
          aria-pressed={chartType === 'sunburst'}
          aria-label="Sunburst chart"
          onClick={setType('sunburst')}
        >
          Sunburst
        </button>
        <button
          type="button"
          className={`${btnBase} ${chartType === 'icicle' ? selected : unselected}`}
          aria-pressed={chartType === 'icicle'}
          aria-label="Icicle chart"
          onClick={setType('icicle')}
        >
          Icicle
        </button>
      </div>

      {hasAbsolute && (
        <>
          <span id="view-mode-label" className="sr-only">View Mode</span>
          <div role="group" aria-labelledby="view-mode-label" className="inline-flex rounded-md shadow-sm border border-gray-300 overflow-hidden dark:border-gray-600">
            <button
              type="button"
              className={`${btnBase} ${viewMode === 'absolute' ? selected : unselected}`}
              aria-pressed={viewMode === 'absolute'}
              aria-label="Absolute view mode"
              onClick={setMode('absolute')}
            >
              Absolute
            </button>
            <button
              type="button"
              className={`${btnBase} ${viewMode === 'relative' ? selected : unselected}`}
              aria-pressed={viewMode === 'relative'}
              aria-label="Relative view mode"
              onClick={setMode('relative')}
            >
              Relative
            </button>
          </div>
        </>
      )}
    </div>
  );
}