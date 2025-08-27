import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/state/useStore';
import type { SearchResult, XmlNodeMeta } from '@/types/models';

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function searchXml(root: XmlNodeMeta, query: string, limit = 50): SearchResult[] {
  const q = query.trim();
  if (q.length === 0) return [];
  const parts = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];
  const queue: XmlNodeMeta[] = [root];

  const pushResult = (node: XmlNodeMeta, matchType: SearchResult['matchType'], score: number) => {
    results.push({ nodeId: node.id, path: node.path, matchType, score });
  };

  while (queue.length && results.length < limit * 2) {
    const n = queue.shift()!;
    const tag = n.tag.toLowerCase();
    const path = n.path.toLowerCase();

    let tagScore = 0;
    let pathScore = 0;

    for (const p of parts) {
      if (tag.includes(p)) tagScore += p.length;
      if (path.includes(p)) pathScore += p.length;
    }

    if (tagScore > 0) pushResult(n, 'tag', 1000 - tagScore);
    if (pathScore > 0) pushResult(n, 'path', 2000 - pathScore);

    if (n.children && n.children.length) {
      for (const c of n.children) queue.push(c);
    }
  }

  results.sort((a, b) => a.score - b.score);
  return results.slice(0, limit);
}

export default function SearchBox() {
  const rootMeta = useStore((s) => s.rootMeta);
  const parseStatus = useStore((s) => s.parseStatus);
  const performanceConfig = useStore((s) => s.performanceConfig);
  const actions = useStore((s) => s.actions);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [localResults, setLocalResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const debouncedQuery = useDebouncedValue(query, performanceConfig.debounceMs);

  const isSearching = useMemo(() => parseStatus === 'parsing' || (debouncedQuery.length > 0 && !rootMeta), [parseStatus, debouncedQuery, rootMeta]);

  useEffect(() => {
    actions.setSearchQuery(query);
  }, [query, actions]);

  useEffect(() => {
    if (!rootMeta || debouncedQuery.trim().length === 0) {
      setLocalResults([]);
      actions.setSearchResults([]);
      return;
    }
    const res = searchXml(rootMeta, debouncedQuery, 20);
    setLocalResults(res);
    actions.setSearchResults(res);
  }, [rootMeta, debouncedQuery, actions]);

  useEffect(() => {
    setOpen(debouncedQuery.trim().length > 0 && localResults.length > 0);
  }, [debouncedQuery, localResults.length]);

  const onSelectResult = (idx: number) => {
    const r = localResults[idx];
    if (!r) return;
    actions.setSelectedNode(r.nodeId);
    const segments = r.path.split('/').filter(Boolean);
    actions.zoomToNode(segments);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(localResults.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) onSelectResult(activeIndex);
      else if (localResults.length > 0) onSelectResult(0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const clear = () => {
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
    actions.setSearchResults([]);
  };

  return (
    <div className="relative w-full max-w-md">
      <label htmlFor="search-box" className="sr-only">
        Search nodes by tag or path
      </label>
      <div className="flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800">
        <svg className="mr-2 h-4 w-4 text-gray-500 dark:text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M12.9 14.32a8 8 0 111.414-1.414l3.387 3.387a1 1 0 01-1.414 1.414l-3.387-3.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z" clipRule="evenodd" />
        </svg>
        <input
          id="search-box"
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(localResults.length > 0)}
          placeholder="Search by tag or path (e.g., section[2]/p[1])"
          className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100"
          role="combobox"
          aria-expanded={open}
          aria-controls="search-results-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `search-option-${activeIndex}` : undefined}
          disabled={parseStatus === 'parsing'}
        />
        {query ? (
          <button
            type="button"
            onClick={clear}
            className="ml-2 rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-gray-700"
            aria-label="Clear search"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 8.586l4.95-4.95a1 1 0 111.414 1.414L11.414 10l4.95 4.95a1 1 0 01-1.414 1.414L10 11.414l-4.95 4.95A1 1 0 013.636 15.95L8.586 11l-4.95-4.95A1 1 0 115.05 4.636L10 9.586z" clipRule="evenodd" />
            </svg>
          </button>
        ) : null}
      </div>

      {isSearching ? (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Searching…</div>
      ) : null}

      {open ? (
        <ul
          id="search-results-listbox"
          role="listbox"
          ref={listRef}
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          {localResults.map((r, idx) => (
            <li
              key={r.nodeId + idx}
              id={`search-option-${idx}`}
              role="option"
              aria-selected={activeIndex === idx}
              className={`
                cursor-pointer px-3 py-2 ${
                  activeIndex === idx
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-700'
                }
              `}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelectResult(idx)}
              title={r.path}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{r.path}</span>
                <span className="ml-2 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {r.matchType}
                </span>
              </div>
            </li>
          ))}
          {localResults.length === 0 ? (
            <li className="px-3 py-2 text-gray-500 dark:text-gray-400">No results</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}