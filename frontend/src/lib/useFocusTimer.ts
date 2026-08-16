/**
 * The focus timer — the missing half of `Task.actualMin`.
 *
 * `actualMin` and `estimateMin` have been on the task model and in the weekly
 * stats since the start, but nothing ever wrote a value into them, so every
 * estimate-vs-actual number was zero against zero. This is what fills them.
 *
 * Two rules define it:
 *
 *   * **One timer at a time.** Starting a second stops the first. Parallel
 *     timers would log more focused hours than the day contains, and a number
 *     you cannot trust is worse than no number.
 *   * **The run survives a reload.** Only the start instant is stored, never a
 *     tick count, so elapsed time is always recomputed from the clock and a
 *     backgrounded tab (where timers are throttled) cannot under-count.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../types/models';
import { api } from '../api';
import { taskOf } from '../domain/parse';

const STORAGE_KEY = 'notebook.focusTimer';

interface Running {
  blockId: string;
  pageId: string;
  /** Epoch ms. The only persisted quantity — elapsed is always derived. */
  startedAt: number;
}

function read(): Running | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Running) : null;
  } catch {
    // Corrupt entry: a broken timer must not stop the app from opening.
    return null;
  }
}

function write(value: Running | null) {
  if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  else localStorage.removeItem(STORAGE_KEY);
}

/** Minutes to credit for a run. Under 30s counts as nothing, not as a minute. */
function minutesFor(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 60000);
}

interface Options {
  page: Page | null;
  /** Applied to the open page, so the edit joins the normal save path. */
  onLog: (blockId: string, minutes: number) => void;
}

export function useFocusTimer({ page, onLog }: Options) {
  const [running, setRunning] = useState<Running | null>(read);
  const [now, setNow] = useState(Date.now());

  // Kept in a ref so the unmount cleanup and the storage listener always see
  // the current run without re-subscribing on every tick.
  const runningRef = useRef(running);
  runningRef.current = running;

  /* ------------------------------------------------------------------ tick */

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  /* ---------------------------------------------------------- cross-tab */

  // Two tabs on the same notebook would otherwise each believe they own the
  // timer and both write elapsed time to the same task.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setRunning(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /* ------------------------------------------------------------- commit */

  /**
   * Write elapsed minutes back to the task.
   *
   * A timer left running on a page you have since navigated away from still
   * has to be credited, which is why this falls back to fetching and saving
   * that page directly rather than assuming the block is on screen.
   */
  const commit = useCallback(
    async (run: Running) => {
      const minutes = minutesFor(run.startedAt);
      if (minutes <= 0) return;

      if (page && run.pageId === page.id) {
        onLog(run.blockId, minutes);
        return;
      }

      const src = await api.getPage(run.pageId);
      if (!src) return;
      await api.savePage({
        ...src,
        blocks: src.blocks.map((b) => {
          if (b.id !== run.blockId || b.type !== 'CHECKBOX') return b;
          const t = taskOf(b);
          return { ...b, task: { ...t, actualMin: (t.actualMin ?? 0) + minutes } };
        }),
      });
    },
    [page, onLog],
  );

  const stop = useCallback(async () => {
    const run = runningRef.current;
    if (!run) return;
    // Cleared before the write, not after: a slow save must not leave a second
    // click able to commit the same run twice.
    setRunning(null);
    write(null);
    await commit(run);
  }, [commit]);

  const start = useCallback(
    async (blockId: string) => {
      if (!page) return;
      const current = runningRef.current;
      if (current?.blockId === blockId) return stop();
      if (current) await stop();

      const next: Running = { blockId, pageId: page.id, startedAt: Date.now() };
      setRunning(next);
      write(next);
    },
    [page, stop],
  );

  /**
   * Stop and hand the minutes back instead of writing them.
   *
   * For callers already building a block update in the same commit — checking
   * a task off, most obviously. If they let `stop` write as well, the two
   * `onChangePage` calls race and whichever lands second silently discards the
   * other's edit.
   */
  const takeElapsed = useCallback((blockId: string): number => {
    const run = runningRef.current;
    if (run?.blockId !== blockId) return 0;
    setRunning(null);
    write(null);
    return minutesFor(run.startedAt);
  }, []);

  const elapsedSec = running ? Math.floor((now - running.startedAt) / 1000) : 0;

  return {
    runningBlockId: running?.blockId ?? null,
    runningPageId: running?.pageId ?? null,
    elapsedSec,
    start,
    stop,
    takeElapsed,
  };
}

/** `7:04` / `1:22:19` — the live readout on a running row. */
export function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}
