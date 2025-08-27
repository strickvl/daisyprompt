import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/state/useStore';
import type { ModelId, TokenizeProgress, TokenizeRequest } from '@/types/models';
import { toPromptNode } from '@/utils/treeTransforms';

import ModelSelector from '@/components/controls/ModelSelector';
import ViewModeToggle from '@/components/controls/ViewModeToggle';
import SizeBasisToggle from '@/components/controls/SizeBasisToggle';
import TokenDisplay from '@/components/controls/TokenDisplay';
import SearchBox from '@/components/controls/SearchBox';
import SemanticLegend from '@/components/controls/SemanticLegend';

import XMLEditor from '@/components/input/XMLEditor';
import FileDrop from '@/components/input/FileDrop';
import ValidationPanel from '@/components/input/ValidationPanel';

import SunburstChart from '@/components/viz/SunburstChart';
import IcicleChart from '@/components/viz/IcicleChart';

// Singleton tokenizer worker accessor
function getTokenizerWorker(): Worker {
  const key = '__dpTokenizerWorker';
  const existing = (globalThis as any)[key] as Worker | undefined;
  if (existing) return existing;
  const worker = new Worker(new URL('../workers/tokenize.worker.ts', import.meta.url), { type: 'module' });
  (globalThis as any)[key] = worker;
  return worker;
}

export default function Home() {
  const modelId = useStore((s) => s.modelId);
  const sizeBasis = useStore((s) => s.sizeBasis);
  const viewMode = useStore((s) => s.viewMode);
  const visualizationType = useStore((s) => s.visualizationType);
  const performanceConfig = useStore((s) => s.performanceConfig);

  const parseStatus = useStore((s) => s.parseStatus);
  const rootMeta = useStore((s) => s.rootMeta);
  const promptTree = useStore((s) => s.promptTree);
  const tokenCache = useStore((s) => s.tokenCache);

  const actions = useStore((s) => s.actions);
  const legendPinned = useStore((s) => s.legendPinned);
  const handleLegendPinChange = (next: boolean) => {
    actions.setLegendPinned(next);
  };

  // Active model used for current tokenization cycle
  const activeModelRef = useRef<ModelId>(modelId);

  // Debounced transform scheduler after token updates or basis changes
  const rebuildTimerRef = useRef<number | null>(null);
  const scheduleRebuild = (delay: number | undefined = performanceConfig.debounceMs) => {
    if (rebuildTimerRef.current != null) {
      window.clearTimeout(rebuildTimerRef.current);
      rebuildTimerRef.current = null;
    }
    rebuildTimerRef.current = window.setTimeout(() => {
      const st = (useStore as any).getState() as ReturnType<typeof useStore.getState>;
      const { rootMeta: rm, sizeBasis: sb, modelId: mid, tokenCache: tc, performanceConfig: pc } = st;
      if (!rm) return;
      const { tree, totals } = toPromptNode(rm, sb, mid, tc, {
        aggregationThreshold: pc.aggregationThreshold,
        maxVisibleNodes: pc.maxVisibleNodes,
      });
      st.actions.setPromptTree(tree);
      st.actions.updateTotals(mid, totals);
    }, Math.max(50, delay ?? 120));
  };

  // Ensure single tokenizer worker listener
  useEffect(() => {
    const w = getTokenizerWorker();
    if ((w as any).__dpBoundListener) return;

    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as TokenizeProgress;
      if (!data || typeof data !== 'object' || !('type' in data)) return;
      const st = (useStore as any).getState() as ReturnType<typeof useStore.getState>;
      const actions = st.actions;

      if (data.type === 'tokenize:partial') {
        // Attach current active modelId to cache updates
        const modelForUpdates = activeModelRef.current;
        const updates = data.updates.map((u) => ({
          hash: u.hash,
          modelId: modelForUpdates,
          tokens: u.tokens,
        }));
        actions.bulkUpdateTokenCache(updates);
        // Debounced re-transform for incremental updates
        scheduleRebuild(st.performanceConfig.debounceMs);
        return;
      }

      if (data.type === 'tokenize:progress') {
        // Optionally reflect progress in UI in the future
        return;
      }

      if (data.type === 'tokenize:done') {
        // Final recompute to ensure totals align with latest cache; prefer local computed totals
        scheduleRebuild(60);
        return;
      }

      if (data.type === 'tokenize:error') {
        // For MVP, surface as xmlError (shared error surface); could add dedicated tokenization error in store later
        actions.setXMLError(`Tokenization error: ${data.message}`);
        return;
      }
    };

    w.addEventListener('message', onMessage);
    (w as any).__dpBoundListener = true;
  }, []);

  // Start a tokenization run for the current root + model
  const startTokenization = (reason: 'parsed' | 'model-changed' | 'manual') => {
    const rm = (useStore as any).getState().rootMeta as typeof rootMeta;
    if (!rm) return;
    const req: TokenizeRequest = {
      type: 'tokenize:tree',
      root: rm,
      modelId,
    };
    activeModelRef.current = modelId;
    const w = getTokenizerWorker();
    w.postMessage(req);
  };

  // Kick off tokenization whenever we have a parsed tree or when model changes
  useEffect(() => {
    if (parseStatus === 'parsed' && rootMeta) {
      startTokenization('parsed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseStatus, rootMeta]);

  useEffect(() => {
    if (parseStatus === 'parsed' && rootMeta) {
      startTokenization('model-changed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // Rebuild PromptNode when sizing basis changes or performance knobs change or cache updates stream in
  useEffect(() => {
    if (!rootMeta) return;
    scheduleRebuild(performanceConfig.debounceMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeBasis, tokenCache, performanceConfig.aggregationThreshold, performanceConfig.maxVisibleNodes]);

  // Memoize chart props
  const chartData = promptTree;
  const enableAnimations = performanceConfig.enableAnimations;

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      {/* Top Controls */}
      <header className="w-full border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-800/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-3 py-1.5 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <ModelSelector />
            <ViewModeToggle />
            <SizeBasisToggle />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SearchBox />
            <TokenDisplay />
            <SemanticLegend variant="popover" onRequestPinChange={handleLegendPinChange} />
          </div>
        </div>
      </header>

      {/* Main content area */}
      <main className="mx-auto flex w-full max-w-7xl grow flex-col gap-4 px-4 py-4">
        <div className="grid min-h-0 grow grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left Panel */}
          <section className="min-h-0 space-y-4 lg:col-span-4">
            <div className="min-h-[220px] overflow-auto rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <XMLEditor />
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <FileDrop />
            </div>
            <ValidationPanel />
          </section>

          {/* Center Visualization */}
          <section className="min-h-0 rounded-md border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:col-span-8">
            <div className="relative h-[520px] w-full md:h-[620px] lg:h-[720px]">
              {visualizationType === 'sunburst' ? (
                <SunburstChart
                  data={chartData}
                  sizeBasis={sizeBasis}
                  viewMode={viewMode}
                  modelId={modelId}
                  enableAnimations={enableAnimations}
                  onNodeClick={() => {}}
                  onHover={() => {}}
                />
              ) : (
                <IcicleChart />
              )}
              {legendPinned ? (
                <div className="pointer-events-auto absolute bottom-2 right-2 z-20">
                  <SemanticLegend variant="floating" dense pinned onRequestPinChange={handleLegendPinChange} />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}