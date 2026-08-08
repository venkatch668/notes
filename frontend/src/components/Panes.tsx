import { useEffect, useMemo, useState } from 'react';
import type { Notebook, PageSummary, Section } from '../types/models';
import {
  addDays,
  endOfMonth,
  formatShort,
  fromKey,
  startOfMonth,
  toKey,
  todayKey,
} from '../domain/dates';

/* --------------------------------------------------------- Notebook pane */

export function NotebookPane({
  notebooks,
  activeId,
  onSelect,
  onAdd,
}: {
  notebooks: Notebook[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="pane pane--notebooks" aria-label="Notebooks">
      <div className="pane__head">
        <span>Notebooks</span>
        <button type="button" className="pane__add" onClick={onAdd} title="New notebook">
          +
        </button>
      </div>
      <div className="pane__scroll">
        {notebooks.map((nb) => (
          <button
            key={nb.id}
            type="button"
            className={`navrow ${nb.id === activeId ? 'navrow--active' : ''}`}
            onClick={() => onSelect(nb.id)}
          >
            <span className="navrow__swatch" style={{ background: nb.color }} />
            <span className="navrow__label">{nb.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------- Section pane */

export function SectionPane({
  sections,
  activeId,
  counts,
  onSelect,
  onAdd,
  onQuick,
  quick,
}: {
  sections: Section[];
  activeId: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onQuick: (which: 'today' | 'yesterday' | 'week' | 'month') => void;
  quick: string | null;
}) {
  return (
    <aside className="pane pane--sections" aria-label="Sections">
      <div className="pane__head">
        <span>Jump to</span>
      </div>
      <div className="quickdates">
        {(
          [
            ['today', 'Today'],
            ['yesterday', 'Yesterday'],
            ['week', 'This Week'],
            ['month', 'This Month'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`quickdate ${quick === key ? 'quickdate--active' : ''}`}
            onClick={() => onQuick(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pane__head">
        <span>Sections</span>
        <button type="button" className="pane__add" onClick={onAdd} title="New section">
          +
        </button>
      </div>
      <div className="pane__scroll">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`navrow ${s.id === activeId ? 'navrow--active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="navrow__swatch" style={{ background: s.color }} />
            <span className="navrow__label">{s.name}</span>
            <span className="navrow__count">{counts[s.id] ?? 0}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------- Page pane */

export function PagePane({
  pages,
  activeId,
  activeDate,
  onSelect,
  onSelectDate,
  onAdd,
}: {
  pages: PageSummary[];
  activeId: string | null;
  activeDate: string | null;
  onSelect: (id: string) => void;
  onSelectDate: (date: string) => void;
  onAdd: () => void;
}) {
  const activityByDate = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of pages) if (p.date) m[p.date] = p.activity;
    return m;
  }, [pages]);

  return (
    <aside className="pane pane--pages" aria-label="Pages">
      <div className="pane__head">
        <span>Pages</span>
        <button type="button" className="pane__add" onClick={onAdd} title="New page">
          +
        </button>
      </div>

      <div className="pane__scroll">
        {pages.length === 0 && <div className="empty">No pages yet</div>}
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`pagerow ${p.id === activeId ? 'pagerow--active' : ''}`}
            onClick={() => onSelect(p.id)}
          >
            <span className="pagerow__title">
              <span className="navrow__label">
                {p.kind === 'daily' && p.date ? formatShort(p.date) : p.title}
              </span>
              {p.activity > 0 && (
                <span className="pagerow__dots" aria-label={`${p.activity} activity`}>
                  {'●'.repeat(p.activity)}
                </span>
              )}
            </span>
            {p.preview && <span className="pagerow__preview">{p.preview}</span>}
          </button>
        ))}
      </div>

      <MonthCalendar activeDate={activeDate} activity={activityByDate} onSelectDate={onSelectDate} />
    </aside>
  );
}

/* -------------------------------------------------------------- Calendar */

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function MonthCalendar({
  activeDate,
  activity,
  onSelectDate,
}: {
  activeDate: string | null;
  activity: Record<string, number>;
  onSelectDate: (date: string) => void;
}) {
  const [anchor, setAnchor] = useState(() => startOfMonth(activeDate ?? todayKey()));
  const today = todayKey();

  // Follow the note being viewed, so opening an older day scrolls the calendar
  // to that month instead of stranding the highlight off-screen.
  useEffect(() => {
    if (activeDate) setAnchor(startOfMonth(activeDate));
  }, [activeDate]);

  const cells = useMemo(() => {
    const first = fromKey(anchor);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const last = fromKey(endOfMonth(anchor)).getDate();
    const out: Array<{ key: string; inMonth: boolean; day: number }> = [];

    for (let i = lead; i > 0; i -= 1) {
      const k = addDays(anchor, -i);
      out.push({ key: k, inMonth: false, day: fromKey(k).getDate() });
    }
    for (let d = 0; d < last; d += 1) {
      const k = addDays(anchor, d);
      out.push({ key: k, inMonth: true, day: d + 1 });
    }
    while (out.length % 7 !== 0) {
      const k = addDays(out[out.length - 1].key, 1);
      out.push({ key: k, inMonth: false, day: fromKey(k).getDate() });
    }
    return out;
  }, [anchor]);

  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    fromKey(anchor),
  );

  const shift = (months: number) => {
    const d = fromKey(anchor);
    setAnchor(toKey(new Date(d.getFullYear(), d.getMonth() + months, 1)));
  };

  return (
    <div className="calendar">
      <div className="calendar__head">
        <button type="button" className="calendar__nav" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <span>{monthLabel}</span>
        <button type="button" className="calendar__nav" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="calendar__grid">
        {DOW.map((d, i) => (
          <div key={i} className="calendar__dow">
            {d}
          </div>
        ))}
        {cells.map((c) => {
          const dots = activity[c.key] ?? 0;
          const classes = [
            'calendar__day',
            c.inMonth ? '' : 'calendar__day--muted',
            c.key === today ? 'calendar__day--today' : '',
            c.key === activeDate ? 'calendar__day--active' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button key={c.key} type="button" className={classes} onClick={() => onSelectDate(c.key)}>
              {c.day}
              {dots > 0 && (
                <span className="calendar__dots" aria-hidden>
                  {Array.from({ length: Math.min(dots, 4) }).map((_, i) => (
                    <span key={i} className="calendar__dot" />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
