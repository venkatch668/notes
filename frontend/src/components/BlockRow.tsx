import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Block } from '../types/models';
import { annotate, applyShortcuts, displayText, parsePastedText } from '../domain/parse';
import { caretOffset, offsetFromPoint, setCaret } from '../lib/caret';
import { formatElapsed } from '../lib/useFocusTimer';
import { Inline } from './Inline';
import { TaskChips } from './Chips';

export interface BlockRowProps {
  block: Block;
  index: number;
  isLast: boolean;
  autoFocusId: string | null;
  flashId: string | null;
  onChange: (block: Block) => void;
  onSplit: (index: number, before: string, after: string) => void;
  onMerge: (index: number, caret: number) => void;
  onMove: (from: number, to: number) => void;
  onIndent: (index: number, delta: number) => void;
  onToggle: (index: number) => void;
  onFocusBlock: (id: string) => void;
  onPasteBlocks: (index: number, blocks: Block[]) => void;
  onNavigate: (index: number, dir: -1 | 1) => void;
  /** Live seconds when this block owns the focus timer, null otherwise. */
  timerSec: number | null;
  onToggleTimer: (blockId: string) => void;
}

function editableClass(block: Block): string {
  const parts = ['editable'];
  if (block.type === 'HEADING') parts.push(`editable--h${block.props.level ?? 2}`);
  if (block.type === 'CODE') parts.push('editable--code');
  if (block.task?.done) parts.push('editable--done');
  return parts.join(' ');
}

export function BlockRow(props: BlockRowProps) {
  const { block, index, autoFocusId, flashId } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  // The contenteditable is uncontrolled while focused: every keystroke is
  // typed straight into the DOM by the browser, then echoed up through
  // `commit`. React must never read that echo back and rewrite the DOM with
  // it — under fast typing, renders batch and this effect can run with a
  // `block.text` prop that is one keystroke stale while the DOM already has
  // the newer character. Comparing `el.textContent !== block.text` in that
  // window looks like a real mismatch, forces a rewrite, and strands the
  // caret at the wrong offset — the next keystrokes land in the wrong place
  // and read as duplicated/scrambled text.
  //
  // So a DOM rewrite only happens when explicitly requested via
  // `forceSync` — entering edit mode, or a shortcut rewriting the text (e.g.
  // "# " -> a heading) — never as a reaction to the prop simply changing.
  const forceSync = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    if (forceSync.current) {
      if (el.textContent !== block.text) el.textContent = block.text;
      forceSync.current = false;
      // Focus synchronously, in the same commit that swapped this block into
      // edit mode — not a `requestAnimationFrame` later. A deferred focus
      // leaves a whole extra frame where nothing (or the block just left) has
      // focus; any keystroke typed in that window — most commonly hitting
      // Enter and immediately continuing to type the next line — lands on
      // the wrong element and either re-appends onto the old block's already
      // trimmed text (reads as duplication) or gets silently dropped.
      if (document.activeElement !== el) el.focus();
      setCaret(el, pendingCaret.current ?? block.text.length);
      pendingCaret.current = null;
      return;
    }
    if (pendingCaret.current !== null) {
      setCaret(el, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [editing, block.text]);

  useEffect(() => {
    if (autoFocusId !== block.id) return;
    if (!ref.current) return;
    forceSync.current = true;
    setEditing(true);
  }, [autoFocusId, block.id]);

  const commit = (text: string) => {
    let next = annotate({ ...block, text });
    const shortcut = applyShortcuts(next);
    if (shortcut !== next) {
      next = shortcut;
      pendingCaret.current = next.text.length;
      forceSync.current = true; // the shortcut rewrote text; the DOM needs it too
    }
    props.onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent ?? '';
    const caret = caretOffset(el);

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && block.type === 'CHECKBOX') {
        props.onToggle(index);
        return;
      }
      props.onSplit(index, text.slice(0, caret), text.slice(caret));
      return;
    }

    if (e.key === 'Backspace' && caret === 0 && window.getSelection()?.isCollapsed) {
      // Leaving a list/checkbox is the more useful first outcome; only merge
      // once the block is already a plain paragraph.
      if (block.type !== 'TEXT') {
        e.preventDefault();
        props.onChange({ ...annotate({ ...block, type: 'TEXT', props: {} }) });
        return;
      }
      if (index > 0) {
        e.preventDefault();
        props.onMerge(index, caret);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      props.onIndent(index, e.shiftKey ? -1 : 1);
      return;
    }

    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      props.onMove(index, index + (e.key === 'ArrowUp' ? -1 : 1));
      return;
    }

    if (e.key === 'ArrowUp' && caret === 0) {
      e.preventDefault();
      props.onNavigate(index, -1);
      return;
    }

    if (e.key === 'ArrowDown' && caret === text.length) {
      e.preventDefault();
      props.onNavigate(index, 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault(); // never let foreign markup into the document

    if (!text.includes('\n')) {
      document.execCommand('insertText', false, text);
      return;
    }
    props.onPasteBlocks(index, parsePastedText(text));
  };

  const startEditing = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) return; // let links win
    const el = ref.current;
    const offset = el ? offsetFromPoint(el, e.clientX, e.clientY) : null;
    pendingCaret.current = offset ?? block.text.length;
    forceSync.current = true;
    setEditing(true);
  };

  const shown = displayText(block);
  const placeholder =
    props.isLast && !block.text ? "Type here. '#' heading, '-' list, '[]' task, '/' for blocks" : '';

  // Different `key`s force React to unmount/remount this node when `editing`
  // flips, rather than patching one shared DOM node in place. The editing
  // branch writes its text imperatively (`el.textContent = ...`, outside
  // React's view — see the layout effect above); the read branch renders
  // text as real JSX children via `<Inline>`. Without distinct keys, React
  // reconciles both branches as the same node: it never tracked the
  // imperative text as a child, so switching back to the read branch just
  // *appends* the `<Inline>` output next to the leftover manual text node
  // instead of replacing it — the block's text visibly duplicates the
  // instant you finish editing it.
  const body = editing ? (
    <div
      key="edit"
      ref={ref}
      className={editableClass(block)}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      onInput={(e) => commit(e.currentTarget.textContent ?? '')}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onBlur={() => setEditing(false)}
      onFocus={() => props.onFocusBlock(block.id)}
    />
  ) : (
    <div
      key="read"
      ref={ref}
      className={editableClass(block)}
      data-placeholder={placeholder}
      onMouseDown={startEditing}
    >
      {shown ? <Inline text={shown} /> : null}
      {/* Chips live inside the rendered text so they flow after the last word
          rather than dropping to a line of their own. */}
      {block.type === 'CHECKBOX' ? (
        <TaskChips block={block} />
      ) : block.classification ? (
        <span className="chips">
          <span className={`badge rounded-pill chip chip--${block.classification}`}>
            {block.classification === 'professional' ? 'Professional' : 'Personal'}
          </span>
        </span>
      ) : null}
    </div>
  );

  const marker =
    block.type === 'BULLET' ? '•' : block.type === 'NUMBER' ? `${block.props.start ?? index + 1}.` : null;

  if (block.type === 'DIVIDER') {
    return (
      <div className="block" data-block-id={block.id}>
        <div className="divider" />
      </div>
    );
  }

  return (
    <div
      className={[
        'block',
        `block--${block.type.toLowerCase()}`,
        flashId === block.id ? 'block--flash' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-block-id={block.id}
      style={{ paddingLeft: 26 + block.indent * 22 }}
      draggable={!editing}
      onDragStart={(e) => e.dataTransfer.setData('text/block-index', String(index))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/block-index'));
        if (!Number.isNaN(from) && from !== index) props.onMove(from, index);
      }}
    >
      <span className="block__handle" title="Drag to move (Alt+↑/↓)">
        ⠿
      </span>

      {block.type === 'CHECKBOX' && (
        <button
          type="button"
          className={`checkbox ${block.task?.done ? 'checkbox--done' : ''}`}
          aria-label={block.task?.done ? 'Mark as not done' : 'Mark as done'}
          aria-pressed={!!block.task?.done}
          onClick={() => props.onToggle(index)}
        >
          ✓
        </button>
      )}

      {/* Hidden on a finished task: there is nothing left to spend time on,
          and a stray click would log minutes against completed work. */}
      {block.type === 'CHECKBOX' && !block.task?.done && (
        <button
          type="button"
          className={`focusbtn ${props.timerSec !== null ? 'focusbtn--on' : ''}`}
          title={props.timerSec !== null ? 'Stop the timer' : 'Start focusing on this'}
          aria-label={props.timerSec !== null ? 'Stop focus timer' : 'Start focus timer'}
          onClick={() => props.onToggleTimer(block.id)}
        >
          {props.timerSec !== null ? `■ ${formatElapsed(props.timerSec)}` : '▶'}
        </button>
      )}

      <div className="block__body">
        {marker && <span className="block__marker">{marker}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
      </div>
    </div>
  );
}
