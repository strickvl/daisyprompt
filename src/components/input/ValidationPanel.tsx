import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/state/useStore';
import type { ParseRequest, ParseProgress } from '@/types/models';
import { toPromptNode } from '@/utils/treeTransforms';

/**
 * Global singleton parser worker accessor and listener.
 */
function getParserWorker(): Worker {
  const key = '__dpParserWorker';
  const existing = (globalThis as any)[key] as Worker | undefined;
  if (existing) return existing;
  const worker = new Worker(new URL('../../workers/parser.worker.ts', import.meta.url), { type: 'module' });
  (globalThis as any)[key] = worker;
  return worker;
}

function ensureParserWorkerListener() {
  const w = getParserWorker();
  if ((w as any).__dpBoundListener) return;

  const onMessage = (ev: MessageEvent) => {
    const data = ev.data as ParseProgress;
    const state = (useStore as any).getState() as ReturnType<typeof useStore.getState>;
    const actions = state.actions;

    if (!data || typeof data !== 'object' || !('type' in data)) return;

    if (data.type === 'parse:progress') {
      actions.setParseStatus('parsing');
      actions.setParseProgress({ done: data.done, total: data.total });
      return;
    }

    if (data.type === 'parse:error') {
      actions.setParseStatus('error');
      actions.setXMLError(data.message);
      return;
    }

    if (data.type === 'parse:partial') {
      return;
    }

    if (data.type === 'parse:done') {
      const root = data.root;
      actions.setParsed(root);

      const latest = (useStore as any).getState() as ReturnType<typeof useStore.getState>;
      const { sizeBasis, modelId, tokenCache, performanceConfig } = latest;
      const { tree, totals } = toPromptNode(root, sizeBasis, modelId, tokenCache, {
        aggregationThreshold: performanceConfig.aggregationThreshold,
        maxVisibleNodes: performanceConfig.maxVisibleNodes,
      });
      latest.actions.setPromptTree(tree);
      latest.actions.updateTotals(modelId, totals);
      return;
    }
  };

  w.addEventListener('message', onMessage);
  (w as any).__dpBoundListener = true;
}

function requestParse(xml: string) {
  const actions = (useStore as any).getState().actions as ReturnType<typeof useStore.getState>['actions'];
  actions.setParseStatus('parsing');
  actions.setParseProgress({ done: 0, total: xml.length });
  actions.setXMLError(undefined);

  const worker = getParserWorker();
  const payload: ParseRequest = { type: 'parse:xml', xml, options: { preserveAttrs: true, namespace: true } };
  worker.postMessage(payload);
}

function extractLineCol(message?: string): { line?: number; column?: number } {
  if (!message) return {};
  // Common patterns emitted by XML parsers
  const patterns = [
    /line[: ]\s*(\d+)[, ]\s*column[: ]\s*(\d+)/i,
    /at line\s+(\d+)\s+column\s+(\d+)/i,
    /Line\s+(\d+),\s*Column\s+(\d+)/i,
    /L(?:ine)?\s*(\d+)\s*C(?:ol(?:umn)?)?\s*(\d+)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m) {
      const line = parseInt(m[1], 10);
      const column = parseInt(m[2], 10);
      return { line: Number.isFinite(line) ? line : undefined, column: Number.isFinite(column) ? column : undefined };
    }
  }
  return {};
}

export default function ValidationPanel() {
  const rawXML = useStore((s) => s.rawXML);
  const parseStatus = useStore((s) => s.parseStatus);
  const parseProgress = useStore((s) => s.parseProgress);
  const xmlError = useStore((s) => s.xmlError);
  const modelId = useStore((s) => s.modelId);
  const totals = useStore((s) => s.totals);

  useEffect(() => {
    ensureParserWorkerListener();
  }, []);

  const pct = useMemo(() => {
    if (parseStatus !== 'parsing' || !parseProgress || !parseProgress.total || parseProgress.total === 0) return undefined;
    const v = Math.max(0, Math.min(100, Math.round((parseProgress.done / parseProgress.total) * 100)));
    return v;
  }, [parseStatus, parseProgress]);

  const onRevalidate = () => {
    if (rawXML && rawXML.trim().length > 0) requestParse(rawXML);
  };

  const errorPos = extractLineCol(xmlError);
  const successTotals = totals[modelId];

  return (
    <div className="w-full rounded-md border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">XML Validation</div>
        <button
          type="button"
          onClick={onRevalidate}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
          aria-label="Re-validate XML"
          disabled={!rawXML || rawXML.trim().length === 0}
        >
          Re-validate
        </button>
      </div>

      {parseStatus === 'parsing' ? (
        <div className="space-y-2" aria-live="polite">
          <div className="h-2 w-full overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
            <div
              className="h-2 bg-indigo-600 transition-all"
              style={{ width: `${pct ?? 15}%` }}
              role="progressbar"
              aria-valuenow={pct ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            {pct !== undefined ? `Parsing… ${pct}%` : 'Parsing…'}
          </div>
        </div>
      ) : null}

      {parseStatus === 'error' ? (
        <div className="mt-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/50 dark:bg-red-900/20 dark:text-red-200" role="alert">
          <div className="font-semibold">Invalid XML</div>
          <div className="mt-1">{xmlError}</div>
          {errorPos.line !== undefined || errorPos.column !== undefined ? (
            <div className="mt-1 text-xs">
              {errorPos.line !== undefined ? <>Line {errorPos.line}</> : null}
              {errorPos.line !== undefined && errorPos.column !== undefined ? ', ' : null}
              {errorPos.column !== undefined ? <>Column {errorPos.column}</> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {parseStatus === 'parsed' ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-500/50 dark:bg-green-900/20 dark:text-green-200" role="status" aria-live="polite">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" className="text-green-600 dark:text-green-300" aria-hidden="true">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.778 7.778a1 1 0 01-1.414 0L3.293 10.96a1 1 0 111.414-1.414l3.1 3.1 7.071-7.071a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <div>
            <div className="font-semibold">XML looks valid</div>
            {successTotals ? (
              <div className="text-xs text-gray-700 dark:text-gray-300">
                Totals — Tokens: {new Intl.NumberFormat().format(Math.round(successTotals.totalTokens))}, Chars: {new Intl.NumberFormat().format(Math.round(successTotals.totalChars))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {parseStatus === 'idle' ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">Paste or drop XML to validate.</div>
      ) : null}
    </div>
  );
}