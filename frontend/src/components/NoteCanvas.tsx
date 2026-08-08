import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Block, Page, PageSummary } from '../types/models';
import { emptyTask, makeBlock } from '../domain/parse';
import { formatLong, formatTime, formatShort } from '../domain/dates';
import { BlockRow } from './BlockRow';
import { TaskChips } from './Chips';

interface Props {
  page: Page;
  carry: Array<{ page: PageSummary; block: Block }>;
  flashBlockId: string | null;
  onChangePage: (page: Page) => void;
  onAcceptCarry: (items: Array<{ page: PageSummary; block: Block }>) => void;
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
  onAcceptCarry,
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
    const task = { ...(cur.task ?? emptyTask()) };
    task.done = !task.done;
    task.completedAt = task.done ? Date.now() : null;
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
          {blocks.length === 0 && (
            <button type="button" className="linkbtn" onClick={insertScaffold}>
              Insert day template
            </button>
          )}
        </div>

        {carry.length > 0 && (
          <div className="carry">
            <div className="carry__head">
              <span>↷ {carry.length} unfinished from earlier</span>
              <span className="carry__actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onAcceptCarry(carry)}>
                  Add all to today
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onDismissCarry}>
                  Not today
                </button>
              </span>
            </div>
            {carry.map(({ page: src, block }) => (
              <div className="carry__item" key={block.id}>
                <button
                  type="button"
                  className="linkbtn"
                  title="Add this one"
                  onClick={() => onAcceptCarry([{ page: src, block }])}
                >
                  +
                </button>
                <span>{block.text.replace(/[!~=@]\S+/g, '').trim()}</span>
                <TaskChips block={block} />
                <span className="carry__from">{src.date ? formatShort(src.date) : ''}</span>
              </div>
            ))}
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
            />
          ))}
        </div>

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
