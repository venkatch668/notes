/** Caret helpers for contenteditable blocks. DOM-only, no React. */

export function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

export function setCaret(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  const range = document.createRange();
  let remaining = offset;
  let placed = false;

  const walk = (node: Node): void => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        range.setStart(node, remaining);
        placed = true;
        return;
      }
      remaining -= len;
      return;
    }
    node.childNodes.forEach(walk);
  };

  walk(el);
  if (!placed) range.selectNodeContents(el);
  range.collapse(placed ? true : false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function focusAtEnd(el: HTMLElement): void {
  el.focus();
  setCaret(el, el.textContent?.length ?? 0);
}

/** Caret offset corresponding to a click point, so focus-swap keeps the caret. */
export function offsetFromPoint(el: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;

  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer;
    offset = r.startOffset;
  } else {
    return null;
  }

  if (!el.contains(node)) return null;

  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(node, offset);
  return pre.toString().length;
}
