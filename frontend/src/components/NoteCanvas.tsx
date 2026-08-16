import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Block, Page, PageSummary } from '../types/models';
import { displayText, emptyTask, makeBlock, taskOf } from '../domain/parse';
import { formatDuration, formatLong, formatTime, formatShort } from '../domain/dates';
import { useFocusTimer } from '../lib/useFocusTimer';
import { BlockRow } from './BlockRow';
import { TaskChips } from './Chips';
import { DayCloseCard } from './DayCloseCard';

interface Props {
  page: Page;
  carry: Array<{ page: PageSummary; block: Block }>;
  flashBlockId: string | null;
  onChangePage: (page: Page) => void;
  /** Opens the day review, which is where carrying is actually decided. */
  onReviewCarry: () => void;
  onDismissCarry: () => void;
  /** Reported so the ribbon can act on whichever block has the caret. */
  onActiveBlock: (id: string | null) => void;
}

const SCAFFOLD = ['Morning', 'Tasks', 'Meetings', 'Notes', 'Ideas', 'Personal', 'End of Day'];

export function NoteCanvas({
  page,
  carry,
  flashBlockId,
  onChangePage,
  onReviewCarry,
  onDismissCarry,
  onActiveBlock,
}: Props) {
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);

  const blocks = page.blocks;

  // Land with the caret ready on an untouched note, but never yank focus (and
  // the scroll position) when opening a note that already has content.
  useEffect(() => {
    if (blocks.length === 1 && !blocks[0].text) setAutoFocusId(blocks[0].id);
  }, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback(
    (next: Block[], focusId?: string) => {
      onChangePage({ ...page, blocks: next });
      if (focusId) setAutoFocusId(focusId);
    },
    [page, onChangePage],
  );

  const stats = useMemo(() => {
    const tasks = blocks.filter((b) => b.type === 'CHECKBOX');
    return { total: tasks.length, done: tasks.filter((b) => b.task?.done).length };
  }, [blocks]);

  /* ----------------------------------------------------------- focus time */

  const logTime = useCallback(
    (blockId: string, minutes: number) => {
      onChangePage({
        ...page,
        blocks: page.blocks.map((b) => {
          if (b.id !== blockId || b.type !== 'CHECKBOX') return b;
          const t = taskOf(b);
          return { ...b, task: { ...t, actualMin: (t.actualMin ?? 0) + minutes } };
        }),
      });
    },
    [page, onChangePage],
  );

  const timer = useFocusTimer({ page, onLog: logTime });

  /**
   * Where the day actually went.
   *
   * Derived from the blocks on screen rather than stored: `actualMin` is the
   * single source of truth, and a cached total would drift the moment a task
   * was edited. Untagged focused work is grouped under a single bucket so the
   * split always adds up to the total.
   */
  const focus = useMemo(() => {
    let total = 0;
    const byTag = new Map<string, number>();
    for (const b of blocks) {
      const min = b.type === 'CHECKBOX' ? taskOf(b).actualMin ?? 0 : 0;
      if (!min) continue;
      total += min;
      if (!b.tags.length) byTag.set('untagged', (byTag.get('untagged') ?? 0) + min);
      // Time is credited to every tag on the task, so the per-tag figures
      // answer "how much work touched #oncall", not "how much was only
      // #oncall". They intentionally sum to more than the total.
      for (const tag of b.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + min);
    }
    return {
      total,
      tags: [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [blocks]);

  /* ------------------------------------------------------ block operations */

  const handleChange = (b: Block) => update(blocks.map((x) => (x.id === b.id ? b : x)));

  const handleSplit = (index: number, before: string, after: string) => {
    const cur = blocks[index];
    const next = [...blocks];

    // Enter on an empty list item exits the list rather than making another one.
    if (!cur.text && cur.type !== 'TEXT') {
      next[index] = { ...cur, type: 'TEXT', props: {}, task: undefined, indent: 0 };
      update(next, cur.id);
      return;
    }

    next[index] = { ...cur, text: before };
    const carryType = cur.type === 'HEADING' || cur.type === 'DIVIDER' ? 'TEXT' : cur.type;
    const created = makeBlock(carryType, after, {
      indent: cur.indent,
      props: carryType === 'CODE' ? cur.props : {},
      task: carryType === 'CHECKBOX' ? emptyTask() : undefined,
    });
    next.splice(index + 1, 0, created);
    update(next, created.id);
  };

  const handleMerge = (index: number) => {
    if (index === 0) return;
    const prev = blocks[index - 1];
    const cur = blocks[index];
    const next = [...blocks];
    next[index - 1] = { ...prev, text: prev.text + cur.text };
    next.splice(index, 1);
    update(next, prev.id);
  };

  const handleMove = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update(next, moved.id);
  };

  const handleIndent = (index: number, delta: number) => {
    const next = [...blocks];
    next[index] = { ...next[index], indent: Math.max(0, Math.min(5, next[index].indent + delta)) };
    update(next, next[index].id);
  };

  const handleToggle = (index: number) => {
    const cur = blocks[index];
    if (cur.type !== 'CHECKBOX') return;
    // Finishing the task ends the run, and those last minutes are folded into
    // this same update rather than written separately — two page updates in
    // one commit would race and one of them would be lost.
    const logged = timer.takeElapsed(cur.id);
    const task = { ...emptyTask(), ...cur.task };
    task.done = !task.done;
    task.completedAt = task.done ? Date.now() : null;
    if (logged > 0) task.actualMin = (task.actualMin ?? 0) + logged;
    const next = [...blocks];
    next[index] = { ...cur, task };
    update(next);
  };

  const handlePasteBlocks = (index: number, pasted: Block[]) => {
    const next = [...blocks];
    next.splice(index + 1, 0, ...pasted);
    update(next, pasted[pasted.length - 1]?.id);
  };

  const handleNavigate = (index: number, dir: -1 | 1) => {
    const target = blocks[index + dir];
    if (target) setAutoFocusId(target.id);
  };

  const appendBlock = () => {
    const created = makeBlock('TEXT', '');
    update([...blocks, created], created.id);
  };

  const insertScaffold = () => {
    const created = SCAFFOLD.flatMap((name) => [
      makeBlock('HEADING', name, { props: { level: 2 } }),
      makeBlock('TEXT', ''),
    ]);
    update([...blocks, ...created], created[1].id);
  };

  /* ------------------------------------------------------------- rendering */

  const dateLabel = page.date ? formatLong(page.date) : page.title;

  return (
    <div className="canvas">
      <div className="canvas__sheet">
        <input
          className="pagetitle"
          value={page.kind === 'daily' ? dateLabel : page.title}
          readOnly={page.kind === 'daily'}
          placeholder="Untitled page"
          onChange={(e) => onChangePage({ ...page, title: e.target.value })}
        />

        <div className="pagemeta">
          <span>{formatTime(page.updatedAt)}</span>
          {stats.total > 0 && (
            <span className="pagemeta__stat">
              {stats.done} of {stats.total} tasks done
            </span>
          )}
          {focus.total > 0 && (
            <span
              className="pagemeta__stat pagemeta__focus"
              title={focus.tags.map(([t, m]) => `#${t} ${formatDuration(m)}`).join(' · ')}
            >
              {formatDuration(focus.total)} focused
              {focus.tags.length > 0 && (
                <span className="pagemeta__split">
                  {focus.tags.map(([t, m]) => `#${t} ${formatDuration(m)}`).join(' · ')}
                </span>
              )}
            </span>
          )}
          {blocks.length === 0 && (
            <button type="button" className="linkbtn" onClick={insertScaffold}>
              Insert day template
            </button>
          )}
        </div>

        {/* A pointer to the review, not a second way to carry tasks. Two
            competing carry paths is how the same task ends up on the page
            twice, so the decision lives in one place only. */}
        {carry.length > 0 && (
          <div className="carry">
            <div className="carry__head">
              <span>↷ {carry.length} unfinished from earlier</span>
              <span className="carry__actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={onReviewCarry}>
                  Review
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onDismissCarry}>
                  Not now
                </button>
              </span>
            </div>
            {carry.slice(0, 4).map(({ page: src, block }) => (
              <div className="carry__item" key={block.id}>
                <span>{displayText(block)}</span>
                <TaskChips block={block} />
                <span className="carry__from">{src.date ? formatShort(src.date) : ''}</span>
              </div>
            ))}
            {carry.length > 4 && (
              <div className="carry__item carry__more">and {carry.length - 4} more</div>
            )}
          </div>
        )}

        <div className="blocks">
          {blocks.map((block, i) => (
            <BlockRow
              key={block.id}
              block={block}
              index={i}
              isLast={i === blocks.length - 1}
              autoFocusId={autoFocusId}
              flashId={flashBlockId}
              onChange={handleChange}
              onSplit={handleSplit}
              onMerge={handleMerge}
              onMove={handleMove}
              onIndent={handleIndent}
              onToggle={handleToggle}
              onFocusBlock={(id) => {
                setAutoFocusId(null);
                onActiveBlock(id);
              }}
              onPasteBlocks={handlePasteBlocks}
              onNavigate={handleNavigate}
              timerSec={timer.runningBlockId === block.id ? timer.elapsedSec : null}
              onToggleTimer={(id) => void timer.start(id)}
            />
          ))}
        </div>

        {/* Only on a daily note: a free page has no day to close. */}
        {page.kind === 'daily' && <DayCloseCard page={page} />}

        {/* Clicking the empty area below the last block starts a new one, so
            there is never a dead zone between "open" and "write". */}
        <div
          style={{ minHeight: 220, cursor: 'text' }}
          onMouseDown={(e) => {
            e.preventDefault();
            const last = blocks[blocks.length - 1];
            if (last && !last.text) setAutoFocusId(last.id);
            else appendBlock();
          }}
        />
      </div>
    </div>
  );
}
