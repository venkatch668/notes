import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchFilters, SearchHit } from '../types/models';
import { api } from '../api/localApi';
import { formatShort } from '../domain/dates';
import { Highlighted } from './Inline';

interface Props {
  onClose: () => void;
  onOpenHit: (hit: SearchHit) => void;
}

type ToggleKey = 'professional' | 'personal' | 'pending' | 'done' | 'high';

const TOGGLES: Array<[ToggleKey, string]> = [
  ['professional', 'Professional'],
  ['personal', 'Personal'],
  ['pending', 'Pending'],
  ['done', 'Completed'],
  ['high', 'High priority'],
];

export function SearchPalette({ onClose, onOpenHit }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Set<ToggleKey>>(new Set());
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const filters = useMemo<SearchFilters>(() => {
    const f: SearchFilters = {};
    if (active.has('professional')) f.classification = 'professional';
    if (active.has('personal')) f.classification = 'personal';
    if (active.has('pending')) { f.isTask = true; f.done = false; }
    if (active.has('done')) { f.isTask = true; f.done = true; }
    if (active.has('high')) f.priority = 'high';
    return f;
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    const hasFilter = Object.keys(filters).length > 0;
    if (!query.trim() && !hasFilter) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await api.search(query, filters);
      if (!cancelled) {
        setHits(r);
        setCursor(0);
      }
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, filters]);

  const toggle = (k: ToggleKey) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else {
        // Mutually exclusive pairs, so the filter set stays satisfiable.
        if (k === 'professional') next.delete('personal');
        if (k === 'personal') next.delete('professional');
        if (k === 'pending') next.delete('done');
        if (k === 'done') next.delete('pending');
        next.add(k);
      }
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    }
    if (e.key === 'Enter' && hits[cursor]) {
      e.preventDefault();
      onOpenHit(hits[cursor]);
    }
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette shadow-lg" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="form-control palette__input"
          placeholder="Search everything…  try: kafka · is:pending · tag:meeting · priority:high"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="palette__filters">
          {TOGGLES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`filterchip ${active.has(k) ? 'filterchip--on' : ''}`}
              onClick={() => toggle(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="palette__results">
          {hits.length === 0 && (
            <div className="empty">
              {query || active.size
                ? 'No matches.'
                : 'Search your whole notebook. ↑ ↓ to move, Enter to open, Esc to close.'}
            </div>
          )}

          {hits.map((h, i) => (
            <button
              key={`${h.pageId}-${h.blockId}`}
              type="button"
              className={`result ${i === cursor ? 'result--cursor' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onOpenHit(h)}
            >
              <span className="result__meta">
                <span className="result__date">{h.date ? formatShort(h.date) : h.title}</span>
                {h.heading && <span>› {h.heading}</span>}
                {h.type === 'CHECKBOX' && <span>· task</span>}
              </span>
              <span className="result__snippet">
                <Highlighted text={h.snippet} spans={h.spans} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
