/**
 * The end-of-day close.
 *
 * The morning review asks what you intend; this asks what happened. Together
 * they are the only record of *intent* in the whole product, which is what the
 * weekly retro measures the week against — counted minutes alone can tell you
 * where the time went, but not whether that was where you meant it to go.
 *
 * The counters are captured here and stored, rather than recomputed later:
 * editing a note next month must not rewrite what that day actually felt like.
 */

import { useEffect, useState } from 'react';
import type { DayReflection, Page } from '../types/models';
import { api } from '../api';
import { formatDuration } from '../domain/dates';
import { taskOf } from '../domain/parse';

interface Props {
  page: Page;
  /** Rendered inline under the note, so closing the day is where the day is. */
  onSaved?: (reflection: DayReflection) => void;
}

function snapshot(page: Page) {
  const tasks = page.blocks.filter((b) => b.type === 'CHECKBOX');
  return {
    done: tasks.filter((b) => taskOf(b).done).length,
    open: tasks.filter((b) => !taskOf(b).done && !taskOf(b).droppedAt).length,
    focusMinutes: tasks.reduce((sum, b) => sum + (taskOf(b).actualMin ?? 0), 0),
  };
}

export function DayCloseCard({ page, onSaved }: Props) {
  const [open, setOpen] = useState(false);
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
        // Already closed once: show it expanded, because the reason to come
        // back is to read or amend it.
        setOpen(true);
      })
      .catch(() => {
        /* Not being able to read yesterday's close must not block writing today's. */
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (!date) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next: DayReflection = {
        date,
        // Set in the morning review; preserved rather than overwritten, since
        // this card never asks for it.
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="dayclose__open" onClick={() => setOpen(true)}>
        Close the day →
      </button>
    );
  }

  return (
    <section className="dayclose" aria-label="End of day">
      <div className="dayclose__head">
        <span>End of day</span>
        <button type="button" className="linkbtn" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>

      <div className="dayclose__recap">
        <span>
          <strong>{counts.done}</strong> done
        </span>
        <span>
          <strong>{counts.open}</strong> still open
        </span>
        <span>
          <strong>{counts.focusMinutes ? formatDuration(counts.focusMinutes) : '—'}</strong> focused
        </span>
      </div>

      {reflection?.intent && (
        <div className="dayclose__intent">
          This morning you said: <em>{reflection.intent}</em>
        </div>
      )}

      <label className="dayclose__field">
        <span>What went well?</span>
        <input
          className="form-control"
          value={wentWell}
          onChange={(e) => setWentWell(e.target.value)}
          placeholder="One line is enough"
        />
      </label>

      <label className="dayclose__field">
        <span>What got in the way?</span>
        <input
          className="form-control"
          value={blockers}
          onChange={(e) => setBlockers(e.target.value)}
          placeholder="Interruptions, blockers, anything you want the retro to know"
        />
      </label>

      {error && <div className="dayclose__error">Could not save: {error}</div>}

      <div className="dayclose__foot">
        {reflection?.wentWell || reflection?.blockers ? (
          <span className="dayclose__saved">Saved</span>
        ) : null}
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save reflection'}
        </button>
      </div>
    </section>
  );
}
