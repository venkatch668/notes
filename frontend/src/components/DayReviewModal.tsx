/**
 * The morning review — what happened yesterday, and what carries into today.
 *
 * Shown once on the first open of a new day. Deliberately a decision point
 * rather than a silent midnight job: the value of carrying a task forward is
 * that you looked at it and chose to, which is also the only thing that stops
 * a stale task from following you around for a fortnight.
 *
 * Read-only about the past. Every write happens in `onApply`, in App, so this
 * component never has to know how a page is saved.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Block, Page, PageSummary } from '../types/models';
import { api } from '../api';
import { addDays, formatDuration, formatLong, formatShort } from '../domain/dates';
import { displayText, taskOf } from '../domain/parse';
import { TaskChips } from './Chips';

/** What the user decided about one unfinished task. */
export type ReviewAction = 'carry' | 'drop' | 'skip';

export interface ReviewDecision {
  action: ReviewAction;
  /** Set when the action is `carry` and a new due date was picked. */
  due?: string | null;
}

interface Props {
  /** The day being opened — decisions land on this page. */
  today: string;
  /** Section to look in for the previous daily note. */
  sectionId: string | null;
  pending: Array<{ page: PageSummary; block: Block }>;
  onApply: (decisions: Map<string, ReviewDecision>, intent: string) => Promise<void>;
  onClose: () => void;
}

interface Recap {
  date: string;
  done: number;
  open: number;
  focusMin: number;
  tags: string[];
}

function recapOf(page: Page): Recap {
  const tasks = page.blocks.filter((b) => b.type === 'CHECKBOX');
  const focusMin = tasks.reduce((sum, b) => sum + (taskOf(b).actualMin ?? 0), 0);

  // Ordered by frequency so the recap leads with what the day was actually
  // about, not whichever tag happened to be typed first.
  const counts = new Map<string, number>();
  for (const b of page.blocks) {
    for (const tag of b.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag]) => tag);

  return {
    date: page.date ?? '',
    done: tasks.filter((b) => taskOf(b).done).length,
    open: tasks.filter((b) => !taskOf(b).done).length,
    focusMin,
    tags,
  };
}

export function DayReviewModal({ today, sectionId, pending, onApply, onClose }: Props) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [decisions, setDecisions] = useState<Map<string, ReviewDecision>>(new Map());
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ------------------------------------------------------------- yesterday */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sectionId) return;
      const summaries = await api.listPages(sectionId);

      // The most recent daily note before today — not literally yesterday,
      // because a weekend or a day off would otherwise show an empty recap.
      const previous = summaries
        .filter((p) => p.kind === 'daily' && p.date && p.date < today)
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
      if (!previous) return;

      const full = await api.getPage(previous.id);
      if (full && !cancelled) setRecap(recapOf(full));
    })().catch(() => {
      // A failed recap must not block the decisions below it, which are the
      // part that matters.
    });
    return () => {
      cancelled = true;
    };
  }, [sectionId, today]);

  /* -------------------------------------------------------------- decisions */

  const decide = (blockId: string, action: ReviewAction, due?: string | null) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      // Clicking the active choice again clears it, so a misclick is one click
      // to undo rather than a decision you cannot take back.
      if (next.get(blockId)?.action === action && due === undefined) next.delete(blockId);
      else next.set(blockId, { action, due });
      return next;
    });
  };

  const carryAll = () => {
    setDecisions(new Map(pending.map(({ block }) => [block.id, { action: 'carry' as const }])));
  };

  const counts = useMemo(() => {
    let carry = 0;
    let drop = 0;
    for (const d of decisions.values()) {
      if (d.action === 'carry') carry += 1;
      if (d.action === 'drop') drop += 1;
    }
    return { carry, drop, undecided: pending.length - decisions.size };
  }, [decisions, pending.length]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApply(decisions, intent.trim());
      onClose();
    } catch (err) {
      // Surfaced rather than swallowed: the day is only stamped as reviewed
      // once the writes land, so a failure here must be visible or tasks
      // silently fail to carry.
      setError((err as Error).message);
      setBusy(false);
    }
  };

  /* -------------------------------------------------------------- rendering */

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dayreview shadow-lg"
        role="dialog"
        aria-label="Day review"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="dayreview__head">
          <div>
            <h2 className="dayreview__title">Good morning</h2>
            <div className="dayreview__sub">{formatLong(today)}</div>
          </div>
          <button type="button" className="linkbtn" onClick={onClose} disabled={busy}>
            Later
          </button>
        </div>

        <div className="dayreview__body">
          {recap && (
            <section className="dayreview__section">
              <h3 className="dayreview__h3">
                {recap.date === addDays(today, -1) ? 'Yesterday' : formatShort(recap.date)}
              </h3>
              <div className="dayreview__recap">
                <span>
                  <strong>{recap.done}</strong> done
                </span>
                <span>
                  <strong>{recap.open}</strong> left open
                </span>
                {recap.focusMin > 0 && (
                  <span>
                    <strong>{formatDuration(recap.focusMin)}</strong> focused
                  </span>
                )}
              </div>
              {recap.tags.length > 0 && (
                <div className="dayreview__tags">
                  {recap.tags.map((t) => (
                    <span key={t} className="badge rounded-pill chip">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="dayreview__section">
            <h3 className="dayreview__h3">
              Unfinished
              {pending.length > 0 && (
                <button type="button" className="linkbtn" onClick={carryAll}>
                  Carry all
                </button>
              )}
            </h3>

            {pending.length === 0 ? (
              <div className="empty">Nothing is outstanding. Clean slate.</div>
            ) : (
              pending.map(({ page: src, block }) => {
                const task = taskOf(block);
                const chosen = decisions.get(block.id);
                const age = task.carryCount;
                return (
                  <div
                    key={block.id}
                    className={`dayreview__task ${chosen ? `is-${chosen.action}` : ''}`}
                  >
                    <div className="dayreview__taskmain">
                      <span className="dayreview__tasktext">{displayText(block)}</span>
                      <TaskChips block={block} />
                    </div>
                    <div className="dayreview__taskmeta">
                      <span>{src.date ? formatShort(src.date) : ''}</span>
                      {age >= 2 && (
                        <span className={`dayreview__age ${age >= 5 ? 'is-stale' : ''}`}>
                          carried {age}×
                        </span>
                      )}
                    </div>
                    <div className="dayreview__actions">
                      <button
                        type="button"
                        className={`btn btn-sm ${chosen?.action === 'carry' ? 'btn-primary' : 'btn-outline-secondary'}`}
                        onClick={() => decide(block.id, 'carry')}
                      >
                        Carry
                      </button>
                      <input
                        type="date"
                        className="form-control form-control-sm dayreview__date"
                        title="Carry with a new due date"
                        value={chosen?.due ?? ''}
                        onChange={(e) => decide(block.id, 'carry', e.target.value || null)}
                      />
                      <button
                        type="button"
                        className={`btn btn-sm ${chosen?.action === 'drop' ? 'btn-danger' : 'btn-outline-secondary'}`}
                        onClick={() => decide(block.id, 'drop')}
                      >
                        Drop
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <section className="dayreview__section">
            <h3 className="dayreview__h3">Today&rsquo;s focus</h3>
            <input
              className="form-control"
              placeholder="One line — what would make today a good day?"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            />
          </section>
        </div>

        {error && <div className="dayreview__error">Could not apply: {error}</div>}

        <div className="dayreview__foot">
          <span className="dayreview__count">
            {counts.carry} carrying · {counts.drop} dropping · {counts.undecided} left as is
          </span>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
            {busy ? 'Applying…' : 'Start the day'}
          </button>
        </div>
      </div>
    </div>
  );
}
