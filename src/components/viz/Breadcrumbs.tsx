import React, { useMemo, useRef } from 'react';

export type BreadcrumbItem = { id: string; name: string };

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onSelect?: (index: number, item: BreadcrumbItem) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function Breadcrumbs({ items, onSelect, className, style }: BreadcrumbsProps) {
  const listRef = useRef<HTMLUListElement | null>(null);

  const pathText = useMemo(() => {
    return items.map((i) => i.name).join(' / ');
  }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const list = listRef.current;
    if (!list) return;
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-crumb="1"]'));
    const current = document.activeElement as HTMLElement | null;
    const idx = buttons.findIndex((b) => b === current);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = buttons[Math.min(buttons.length - 1, Math.max(0, idx + 1))];
      next?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = buttons[Math.max(0, Math.min(buttons.length - 1, idx - 1))];
      prev?.focus();
    }
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(pathText);
    } catch {
      // ignore
    }
  };

  return (
    <nav aria-label="Breadcrumb" className={className} style={style}>
      <ul
        ref={listRef}
        role="list"
        onKeyDown={handleKeyDown}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: 4,
          borderRadius: 6,
          background: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(2px)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          maxWidth: '100%',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
        aria-label="Zoom path"
      >
        {items.map((it, i) => (
          <li key={it.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              data-crumb="1"
              onClick={() => onSelect?.(i, it)}
              title={it.name}
              aria-label={`Jump to ${it.name}`}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#1f2937',
                cursor: 'pointer',
                padding: '2px 4px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {it.name}
            </button>
            {i < items.length - 1 ? <span aria-hidden="true" style={{ color: '#9ca3af' }}>/</span> : null}
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={copyPath}
            aria-label="Copy path"
            title="Copy path"
            style={{
              marginLeft: 8,
              border: '1px solid #d1d5db',
              background: '#f9fafb',
              color: '#111827',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Copy Path
          </button>
        </li>
      </ul>
    </nav>
  );
}

export default Breadcrumbs;