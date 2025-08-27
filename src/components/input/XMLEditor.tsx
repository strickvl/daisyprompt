import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/state/useStore';
import type { ParseProgress, ParseRequest } from '@/types/models';
import { toPromptNode } from '@/utils/treeTransforms';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<document>
  <meta author="Jane Doe" version="1.2"/>
  <section id="intro">
    <title>Introduction</title>
    <p>This is a short example of XML content to demonstrate parsing and visualization.</p>
    <p>It contains several elements and attributes to validate the pipeline.</p>
  </section>
  <section id="details">
    <title>Details</title>
    <item type="code">
      <![CDATA[
        function add(a, b) {
          return a + b;
        }
      ]]>
    </item>
    <list>
      <li>First</li>
      <li>Second</li>
      <li>Third</li>
    </list>
  </section>
</document>`.trim();

/**
 * Global singleton parser worker accessor to avoid multiple concurrent workers.
 */
function getParserWorker(): Worker {
  const key = '__dpParserWorker';
  const existing = (globalThis as any)[key] as Worker | undefined;
  if (existing) return existing;
  const worker = new Worker(new URL('../../workers/parser.worker.ts', import.meta.url), { type: 'module' });
  (globalThis as any)[key] = worker;
  return worker;
}

/**
 * Attach a single global message listener that updates the Zustand store.
 * Only attaches once per runtime; safe to call from multiple components.
 */
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
      // For MVP we do not progressively update the tree; progress bar suffices.
      return;
    }

    if (data.type === 'parse:done') {
      const root = data.root;
      actions.setParsed(root);

      // Build/refresh PromptNode tree using current store settings
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

/**
 * Send a parse request to the parser worker and prime store states.
 */
function requestParse(xml: string) {
  const actions = (useStore as any).getState().actions as ReturnType<typeof useStore.getState>['actions'];
  actions.setParseStatus('parsing');
  actions.setParseProgress({ done: 0, total: xml.length });
  actions.setXMLError(undefined);

  const worker = getParserWorker();
  const payload: ParseRequest = { type: 'parse:xml', xml, options: { preserveAttrs: true, namespace: true } };
  worker.postMessage(payload);
}

export default function XMLEditor() {
  const rawXML = useStore((s) => s.rawXML);
  const parseStatus = useStore((s) => s.parseStatus);
  const parseProgress = useStore((s) => s.parseProgress);
  const performanceConfig = useStore((s) => s.performanceConfig);
  const actions = useStore((s) => s.actions);

  const [autoValidate, setAutoValidate] = useState(true);
  const [caretLines, setCaretLines] = useState(1);

  // Ensure the worker listener is bound once
  useEffect(() => {
    ensureParserWorkerListener();
  }, []);

  // Debounced real-time validation on XML changes
  useEffect(() => {
    if (!autoValidate) return;
    const text = rawXML || '';
    if (text.trim().length === 0) {
      actions.setParseStatus('idle');
      actions.setParseProgress({ done: 0, total: 0 });
      actions.setXMLError(undefined);
      return;
    }
    const t = window.setTimeout(() => requestParse(text), Math.max(100, performanceConfig.debounceMs));
    return () => window.clearTimeout(t);
  }, [rawXML, autoValidate, performanceConfig.debounceMs, actions]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    actions.setXML(v);
    // estimate line count for aria
    const lines = v.split(/\r\n|\r|\n/).length;
    setCaretLines(lines);
  };

  const onValidateNow = () => {
    if (rawXML && rawXML.trim().length > 0) requestParse(rawXML);
  };

  const onLoadSample = () => {
    actions.setXML(SAMPLE_XML);
    requestParse(SAMPLE_XML);
  };

  const onClear = () => {
    actions.setXML('');
    actions.setXMLError(undefined);
    actions.setParseStatus('idle');
    actions.setParseProgress({ done: 0, total: 0 });
  };

  const isParsing = parseStatus === 'parsing';
  const progressPct = useMemo(() => {
    if (!parseProgress || !parseProgress.total || parseProgress.total === 0) return undefined;
    const pct = Math.max(0, Math.min(100, Math.round((parseProgress.done / parseProgress.total) * 100)));
    return pct;
  }, [parseProgress]);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onLoadSample}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          aria-label="Load sample XML"
        >
          Load Sample
        </button>
        <button
          type="button"
          onClick={onValidateNow}
          className="rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
          aria-label="Validate XML now"
          disabled={!rawXML || rawXML.trim().length === 0}
        >
          Validate
        </button>
        <button
          type="button"
          onClick={() => setAutoValidate((v) => !v)}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            autoValidate
              ? 'border-green-600 bg-green-50 text-green-800 dark:bg-green-900 dark:text-green-100 dark:border-green-400'
              : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          }`}
          aria-pressed={autoValidate}
          aria-label="Toggle auto-validate"
        >
          {autoValidate ? 'Auto-validate: On' : 'Auto-validate: Off'}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          aria-label="Clear editor"
        >
          Clear
        </button>

        <div className="ml-auto text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
          {isParsing
            ? progressPct !== undefined
              ? `Parsing… ${progressPct}%`
              : 'Parsing…'
            : null}
        </div>
      </div>

      <label htmlFor="xml-editor" className="sr-only">
        XML editor
      </label>
      <textarea
        id="xml-editor"
        value={rawXML}
        onChange={onChange}
        placeholder="Paste or type XML here…"
        spellCheck={false}
        aria-multiline="true"
        aria-label="XML editor input"
        aria-describedby="xml-editor-help"
        rows={Math.min(24, Math.max(10, caretLines))}
        className="min-h-[280px] w-full resize-y rounded-md border border-gray-300 bg-white p-3 font-mono text-sm text-gray-900 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />

      <div id="xml-editor-help" className="text-xs text-gray-500 dark:text-gray-400">
        The editor validates XML in real time using a sandboxed worker. Security note: DTDs and processing
        instructions are stripped before parsing.
      </div>
    </div>
  );
}