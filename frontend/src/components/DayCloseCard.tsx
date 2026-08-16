/**
 * The end-of-day close.
 *
 * A single button pinned at the foot of the note, a dialog to say how the day
 * went, and a closing quote once it is saved.
 *
 * The morning review asks what you intend; this asks what happened. Together
 * they are the only record of *intent* in the product, which is what the weekly
 * retro measures the week against — counted minutes tell you where the time
 * went, but not whether that was where you meant it to go.
 *
 * The counters are captured at close time and stored, not recomputed later:
 * editing this note next month must not rewrite what the day felt like.
 */

import { useEffect, useState } from 'react';
import type { DayReflection, Page } from '../types/models';
import { api } from '../api';
import { formatDuration } from '../domain/dates';
import { taskOf } from '../domain/parse';
import { closingLine, quoteForDay } from '../domain/quotes';
import { Modal } from './Modal';

interface Props {
  page: Page;
  onSaved?: (reflection: DayReflection) => void;
}

type Stage = 'idle' | 'form' | 'done';

function snapshot(page: Page) {
  const tasks = page.blocks.filter((b) => b.type === 'CHECKBOX');
  return {
    done: tasks.filter((b) => taskOf(b).done).length,
    open: tasks.filter((b) => !taskOf(b).done && !taskOf(b).droppedAt).length,
    focusMinutes: tasks.reduce((sum, b) => sum + (taskOf(b).actualMin ?? 0), 0),
  };
}

export function DayCloseCard({ page, onSaved }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [reflection, setReflection] = useState<DayReflection | null>(null);
  const [wentWell, setWentWell] = useState('');
  const [blockers, setBlockers] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const date = page.date;
  const counts = snapshot(page);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    api
      .getReflection(date)
      .then((r) => {
        if (cancelled || !r) return;
        setReflection(r);
        setWentWell(r.wentWell);
        setBlockers(r.blockers);
      })
      .catch(() => {
        /* Failing to read an old close must not block writing today's. */
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (!date) return null;

  const closed = Boolean(reflection?.wentWell || reflection?.blockers);
  const quote = quoteForDay(date);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next: DayReflection = {
        date,
        // Set in the morning review; preserved rather than overwritten, since
        // this dialog never asks for it.
        intent: reflection?.intent ?? '',
        wentWell: wentWell.trim(),
        blockers: blockers.trim(),
        focusMinutes: counts.focusMinutes,
        tasksDone: counts.done,
        tasksOpen: counts.open,
      };
      const saved = await api.saveReflection(next);
      setReflection(saved);
      onSaved?.(saved);
      setStage('done');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="dayclose__bar">
        <button
          type="button"
          className={`dayclose__btn ${closed ? 'dayclose__btn--done' : ''}`}
          onClick={() => setStage('form')}
        >
          <span className="dayclose__btnicon" aria-hidden>
            {closed ? '✓' : '🌙'}
          </span>
          <span className="dayclose__btntext">
            <strong>{closed ? 'Day closed' : 'End of day'}</strong>
            <span className="dayclose__btnsub">
              {closed
                ? 'Reopen to add more'
                : `${counts.done} done · ${counts.open} open${counts.focusMinutes ? ` · ${formatDuration(counts.focusMinutes)} focused` : ''}`}
            </span>
          </span>
          <span className="dayclose__btnchev" aria-hidden>
            →
          </span>
        </button>
      </div>

      {stage === 'form' && (
        <Modal
          title="How did today go?"
          subtitle="Two lines is plenty. The weekly retro reads these."
          onClose={() => setStage('idle')}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setStage('idle')}
              >
                Not now
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save & close the day'}
              </button>
            </>
          }
        >
          <div className="closestats">
            <div className="closestat">
              <span className="closestat__value">{counts.done}</span>
              <span className="closestat__label">done</span>
            </div>
            <div className="closestat">
              <span className="closestat__value">{counts.open}</span>
              <span className="closestat__label">still open</span>
            </div>
            <div className="closestat">
              <span className="closestat__value">
                {counts.focusMinutes ? formatDuration(counts.focusMinutes) : '—'}
              </span>
              <span className="closestat__label">focused</span>
            </div>
          </div>

          {reflection?.intent && (
            <p className="closeintent">
              This morning you said: <em>{reflection.intent}</em>
            </p>
          )}

          <label className="field">
            <span className="field__label">What went well?</span>
            <textarea
              className="form-control"
              rows={2}
              value={wentWell}
              onChange={(e) => setWentWell(e.target.value)}
              placeholder="Anything you want to remember about today"
            />
          </label>

          <label className="field">
            <span className="field__label">What got in the way?</span>
            <textarea
              className="form-control"
              rows={2}
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="Interruptions, blockers, anything the retro should know"
            />
          </label>

          {error && <p className="field__error">Could not save: {error}</p>}
        </Modal>
      )}

      {stage === 'done' && (
        <Modal
          title="Day closed"
          size="sm"
          onClose={() => setStage('idle')}
          footer={
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setStage('idle')}
            >
              Goodnight
            </button>
          }
        >
          <p className="closingline">
            {closingLine(counts.done, counts.open, counts.focusMinutes)}
          </p>
          <blockquote className="quote">
            <p className="quote__text">“{quote.text}”</p>
            <footer className="quote__author">— {quote.author}</footer>
          </blockquote>
        </Modal>
      )}
    </>
  );
}
