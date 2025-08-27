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
    <div className="flex flex-col gap-2">
      {/* Chart Type selector */}
      <div className="flex flex-col">
        <label className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">Chart Type</label>
        <div role="group" aria-label="Chart type" className="inline-flex rounded-md shadow-sm border border-gray-300 overflow-hidden dark:border-gray-600">
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
      </div>

      {/* View Mode selector (only when absolute mode is meaningful) */}
      {hasAbsolute && (
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">View Mode</label>
          <div role="group" aria-label="View mode" className="inline-flex rounded-md shadow-sm border border-gray-300 overflow-hidden dark:border-gray-600">
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
          <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Absolute shows usage vs model context; Relative normalizes the chart.
          </span>
        </div>
      )}
    </div>
  );
}