/**
 * Pure parsing: the typing grammar from design.md §1.4.
 *
 * Text is authored as plain text and stays that way; everything the UI renders
 * as a chip or a heading is *derived* here. Nothing in this module does I/O.
 */

import type { Block, BlockType, Classification, Priority, Task } from '../types/models';
import { parseDuration, resolveDueToken } from './dates';

/**
 * Block identity.
 *
 * Must be a real UUID: block ids are the primary key in Postgres, so the API
 * rejects anything else with 422 and the save silently fails. The previous
 * scheme (`b` + base36 timestamp) worked only because local mode never
 * validated ids.
 *
 * Client-generated on purpose — the editor needs a stable identity before the
 * block has ever reached the server, which is what makes offline editing and
 * scroll-to-block work across a save.
 */
export function newId(): string {
  // Available in every secure context (https and localhost). The fallback
  // covers plain-http dev servers and older browsers.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyTask(): Task {
  return {
    done: false,
    priority: null,
    due: null,
    estimateMin: null,
    actualMin: null,
    completedAt: null,
    reminderAt: null,
    carriedFrom: null,
    forwardedTo: null,
    carryCount: 0,
    droppedAt: null,
    originId: null,
  };
}

/**
 * A block's task with every field present.
 *
 * Blocks arriving from storage predate the fields added later, so reading
 * `block.task.carryCount` directly yields undefined on anything written before
 * day review existed. Read through this instead.
 */
export function taskOf(block: Block): Task {
  return { ...emptyTask(), ...block.task };
}

/**
 * Comparison key for "is this the same task?".
 *
 * Attribute tokens are stripped first, so re-prioritising a task does not make
 * it look like a different one.
 */
export function taskKey(block: Block): string {
  return displayText(block)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeBlock(type: BlockType = 'TEXT', text = '', extra: Partial<Block> = {}): Block {
  const base: Block = {
    id: newId(),
    type,
    text,
    indent: 0,
    tags: [],
    classification: null,
    props: {},
    ...extra,
  };
  if (type === 'CHECKBOX' && !base.task) base.task = emptyTask();
  return annotate(base);
}

/* ------------------------------------------------------------------ *
 * Block-start shortcuts                                               *
 * ------------------------------------------------------------------ */

interface Shortcut {
  re: RegExp;
  apply: (m: RegExpExecArray, b: Block) => Block;
}

const SHORTCUTS: Shortcut[] = [
  {
    re: /^(#{1,3})\s(.*)$/,
    apply: (m, b) => ({
      ...b,
      type: 'HEADING',
      props: { ...b.props, level: m[1].length as 1 | 2 | 3 },
      text: m[2],
    }),
  },
  {
    re: /^\[( |x|X)?\]\s?(.*)$/,
    apply: (m, b) => ({
      ...b,
      type: 'CHECKBOX',
      task: { ...(b.task ?? emptyTask()), done: m[1]?.toLowerCase() === 'x' },
      text: m[2],
    }),
  },
  { re: /^[-*]\s(.*)$/, apply: (m, b) => ({ ...b, type: 'BULLET', text: m[1] }) },
  {
    re: /^(\d+)\.\s(.*)$/,
    apply: (m, b) => ({ ...b, type: 'NUMBER', props: { ...b.props, start: Number(m[1]) }, text: m[2] }),
  },
  { re: /^```(\w*)\s*(.*)$/, apply: (m, b) => ({ ...b, type: 'CODE', props: { lang: m[1] || 'text' }, text: m[2] }) },
  { re: /^(---|___|\*\*\*)$/, apply: (_m, b) => ({ ...b, type: 'DIVIDER', text: '' }) },
];

/**
 * Applies a block-start shortcut if the text now matches one. Returns the same
 * object when nothing matched, so callers can cheaply detect a no-op.
 */
export function applyShortcuts(block: Block): Block {
  if (block.type === 'CODE') return block; // inside a code block, markdown is literal
  for (const s of SHORTCUTS) {
    const m = s.re.exec(block.text);
    if (m) return annotate(s.apply(m, block));
  }
  return block;
}

/* ------------------------------------------------------------------ *
 * Inline tokens                                                       *
 * ------------------------------------------------------------------ */

const TAG_RE = /(^|\s)#([a-z0-9][a-z0-9_-]*)/gi;
const PRIORITY_RE = /(^|\s)!(high|med|medium|low)\b/gi;
const DUE_RE = /(^|\s)@([a-z0-9-]+)/gi;
const ESTIMATE_RE = /(^|\s)~(\d+(?:\.\d+)?h(?:\d+m)?|\d+m)\b/gi;
const ACTUAL_RE = /(^|\s)=(\d+(?:\.\d+)?h(?:\d+m)?|\d+m)\b/gi;

const PRIORITY_MAP: Record<string, Priority> = {
  high: 'high',
  med: 'medium',
  medium: 'medium',
  low: 'low',
};

export function extractTags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TAG_RE)) out.push(m[2].toLowerCase());
  return [...new Set(out)];
}

export function classificationOf(tags: string[]): Classification {
  if (tags.includes('professional') || tags.includes('work')) return 'professional';
  if (tags.includes('personal')) return 'personal';
  return null;
}

/**
 * Recomputes every derived field from `text`. Called after any text change so
 * tags, classification and task attributes can never drift from the prose.
 */
export function annotate(block: Block): Block {
  const tags = extractTags(block.text);
  const next: Block = { ...block, tags, classification: classificationOf(tags) };

  if (next.type === 'CHECKBOX') {
    // Defaults first, stored value second: tasks written before a field
    // existed come back from storage without it, and every `task.carryCount`
    // read downstream would be undefined rather than 0.
    const task: Task = { ...emptyTask(), ...next.task };

    const pm = [...next.text.matchAll(PRIORITY_RE)].pop();
    task.priority = pm ? PRIORITY_MAP[pm[2].toLowerCase()] ?? null : null;

    const dm = [...next.text.matchAll(DUE_RE)].pop();
    task.due = dm ? resolveDueToken(dm[2]) : null;

    const em = [...next.text.matchAll(ESTIMATE_RE)].pop();
    task.estimateMin = em ? parseDuration(em[2]) : null;

    const am = [...next.text.matchAll(ACTUAL_RE)].pop();
    task.actualMin = am ? parseDuration(am[2]) : null;

    next.task = task;
  } else if (next.task) {
    delete next.task;
  }

  return next;
}

/** The text with all attribute tokens removed — what the reader sees. */
export function displayText(block: Block): string {
  let t = block.text;
  if (block.type === 'CHECKBOX') {
    t = t
      .replace(PRIORITY_RE, '$1')
      .replace(DUE_RE, '$1')
      .replace(ESTIMATE_RE, '$1')
      .replace(ACTUAL_RE, '$1');
  }
  return t.replace(/\s{2,}/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Inline formatting → token tree (never innerHTML; see design.md §9)  *
 * ------------------------------------------------------------------ */

export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'link'; value: string; href: string };

const SAFE_SCHEME = /^(https?:|mailto:)/i;

const INLINE_RE =
  /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|((?:^|\s)#[a-z0-9][a-z0-9_-]*)/gi;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;

  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', value: text.slice(last, at) });

    const raw = m[0];
    if (m[1]) out.push({ kind: 'bold', value: raw.slice(2, -2) });
    else if (m[2]) out.push({ kind: 'italic', value: raw.slice(1, -1) });
    else if (m[3]) out.push({ kind: 'code', value: raw.slice(1, -1) });
    else if (m[4]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw)!;
      // Anything not http/https/mailto degrades to plain text rather than
      // becoming a javascript: sink.
      if (SAFE_SCHEME.test(lm[2])) out.push({ kind: 'link', value: lm[1], href: lm[2] });
      else out.push({ kind: 'text', value: lm[1] });
    } else if (m[5]) {
      const lead = raw.startsWith('#') ? '' : raw[0];
      if (lead) out.push({ kind: 'text', value: lead });
      out.push({ kind: 'tag', value: raw.trim().slice(1) });
    }

    last = at + raw.length;
  }

  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/* ------------------------------------------------------------------ *
 * Paste                                                               *
 * ------------------------------------------------------------------ */

/** Plain text → blocks, using the same grammar as typing (FR-2.6). */
export function parsePastedText(text: string): Block[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => applyShortcuts(makeBlock('TEXT', line.trimEnd())))
    .filter((b, i, arr) => b.text !== '' || b.type !== 'TEXT' || (i > 0 && i < arr.length - 1));
}
