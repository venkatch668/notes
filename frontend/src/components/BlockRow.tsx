import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Block } from '../types/models';
import { annotate, applyShortcuts, displayText, parsePastedText } from '../domain/parse';
import { caretOffset, offsetFromPoint, setCaret } from '../lib/caret';
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

  // The contenteditable is uncontrolled while focused: React must not rewrite
  // its child nodes under the caret. We only push text in when not editing.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    if (el.textContent !== block.text) el.textContent = block.text;
    if (pendingCaret.current !== null) {
      setCaret(el, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [editing, block.text]);

  useEffect(() => {
    if (autoFocusId !== block.id) return;
    const el = ref.current;
    if (!el) return;
    setEditing(true);
    // Focus after the swap to the editable node has committed.
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      setCaret(node, node.textContent?.length ?? 0);
    });
  }, [autoFocusId, block.id]);

  const commit = (text: string) => {
    let next = annotate({ ...block, text });
    const shortcut = applyShortcuts(next);
    if (shortcut !== next) {
      next = shortcut;
      pendingCaret.current = next.text.length;
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
    setEditing(true);
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      if (pendingCaret.current !== null) {
        setCaret(node, pendingCaret.current);
        pendingCaret.current = null;
      }
    });
  };

  const shown = displayText(block);
  const placeholder =
    props.isLast && !block.text ? "Type here. '#' heading, '-' list, '[]' task, '/' for blocks" : '';

  const body = editing ? (
    <div
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

      <div className="block__body">
        {marker && <span className="block__marker">{marker}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
      </div>
    </div>
  );
}
