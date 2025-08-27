import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/state/useStore';
import type { ParseProgress, ParseRequest } from '@/types/models';
import { toPromptNode } from '@/utils/treeTransforms';

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${n} B`;
}

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
      // Ignored for MVP; progress UI is sufficient
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

export default function FileDrop() {
  const actions = useStore((s) => s.actions);
  const parseStatus = useStore((s) => s.parseStatus);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ensureParserWorkerListener();
  }, []);

  const acceptFile = (file: File): string | null => {
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    const isXML =
      name.endsWith('.xml') || type === 'text/xml' || type === 'application/xml' || type === 'application/text+xml';
    if (!isXML) return 'Please drop a .xml file.';
    if (file.size > MAX_FILE_BYTES) return `File too large. Max ${MAX_FILE_SIZE_MB}MB.`;
    return null;
    };

  const handleFile = async (file: File) => {
    const reason = acceptFile(file);
    if (reason) {
      setLocalError(reason);
      actions.setXMLError(reason);
      return;
    }
    try {
      const text = await file.text();
      actions.setXML(text);
      requestParse(text);
      setLocalError(undefined);
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : 'Failed to read file.';
      setLocalError(msg);
      actions.setXMLError(msg);
    }
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const xml = files.find((f) => {
      const n = f.name.toLowerCase();
      const t = (f.type || '').toLowerCase();
      return n.endsWith('.xml') || t === 'text/xml' || t === 'application/xml' || t === 'application/text+xml';
    }) || files[0];
    await handleFile(xml);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const onPickFile = () => inputRef.current?.click();
  const onInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFile(file);
    e.currentTarget.value = '';
  };

  return (
    <div className="w-full">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        role="button"
        tabIndex={0}
        aria-label="Drag and drop XML files here"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPickFile();
          }
        }}
        className={`flex h-36 w-full cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-4 transition-colors ${
          dragOver
            ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-900/30'
            : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
        }`}
        title="Drop .xml file here or click to select"
        onClick={onPickFile}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          onChange={onInputChange}
        />
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`mb-2 ${
            dragOver ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-300'
          }`}
          aria-hidden="true"
        >
          <path d="M19 13v6H5v-6H3v8h18v-8h-2zM11 6.414V16h2V6.414l3.293 3.293 1.414-1.414L12 2.586 6.293 8.293l1.414 1.414L11 6.414z"></path>
        </svg>
        <div className="text-sm font-medium text-gray-800 dark:text-gray-100">Drop XML file here</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          or click to select • .xml • up to {MAX_FILE_SIZE_MB}MB
        </div>
        {parseStatus === 'parsing' ? (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
            Parsing in progress…
          </div>
        ) : null}
        {localError ? (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
            {localError}
          </div>
        ) : null}
      </div>
    </div>
  );
}