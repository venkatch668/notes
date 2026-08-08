import type { Block } from '../types/models';
import { formatDuration, formatShort, relativeLabel } from '../domain/dates';

/** The derived attribute chips shown after a task's text. */
export function TaskChips({ block }: { block: Block }) {
  const t = block.task;
  const chips: React.ReactNode[] = [];

  if (block.classification) {
    chips.push(
      <span key="cls" className={`badge rounded-pill chip chip--${block.classification}`}>
        {block.classification === 'professional' ? 'Professional' : 'Personal'}
      </span>,
    );
  }

  if (t?.priority) {
    const label = { high: 'High', medium: 'Medium', low: 'Low' }[t.priority];
    chips.push(
      <span key="prio" className={`badge rounded-pill chip chip--${t.priority}`}>
        {label}
      </span>,
    );
  }

  if (t?.due) {
    chips.push(
      <span key="due" className="badge rounded-pill chip chip--due">
        {relativeLabel(t.due) ?? formatShort(t.due)}
      </span>,
    );
  }

  if (t?.estimateMin) {
    chips.push(
      <span key="est" className="badge rounded-pill chip chip--time" title="Estimated effort">
        ~{formatDuration(t.estimateMin)}
      </span>,
    );
  }

  if (t?.actualMin) {
    chips.push(
      <span key="act" className="badge rounded-pill chip chip--time" title="Actual effort">
        {formatDuration(t.actualMin)}
      </span>,
    );
  }

  if (t?.carriedFrom) {
    chips.push(
      <span key="cf" className="badge rounded-pill chip chip--carried" title={`Carried forward from ${t.carriedFrom}`}>
        ↷ {formatShort(t.carriedFrom)}
      </span>,
    );
  }

  if (!chips.length) return null;
  return <span className="chips">{chips}</span>;
}
