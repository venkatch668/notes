/**
 * Domain model. Mirrors the entities in design.md §4.
 *
 * These shapes are the contract between the UI and the API layer. When the
 * Python backend arrives it must serialize exactly these shapes, so nothing
 * above `src/api` has to change.
 */

export type Classification = 'professional' | 'personal' | null;

export type Priority = 'high' | 'medium' | 'low' | null;

export type BlockType =
  | 'TEXT'
  | 'HEADING'
  | 'CHECKBOX'
  | 'BULLET'
  | 'NUMBER'
  | 'TABLE'
  | 'CODE'
  | 'IMAGE'
  | 'DIVIDER';

export interface Task {
  done: boolean;
  priority: Priority;
  /** ISO day string, 'YYYY-MM-DD'. */
  due: string | null;
  estimateMin: number | null;
  actualMin: number | null;
  completedAt: number | null;
  reminderAt: string | null;
  /** Source date when this task was carried forward from an earlier day. */
  carriedFrom: string | null;
  /**
   * Block id this task moved to during a day review.
   *
   * Set on the *source* block, which is what settles it: a task is only a
   * carry-forward candidate while it is unchecked, not forwarded and not
   * dropped. Without this the same task is re-offered every single morning,
   * because completing it on today's copy says nothing about the original.
   */
  forwardedTo: string | null;
  /** Hops so far. 0 = authored here; drives the age warning on the chip. */
  carryCount: number;
  /** Explicitly abandoned, so "open" can mean live work rather than debris. */
  droppedAt: number | null;
  /** Origin block id, preserved across every hop, so a merge can match on it. */
  originId: string | null;
}

/** Type-specific payload. Adding a block type means adding a variant here. */
export interface BlockProps {
  level?: 1 | 2 | 3;
  lang?: string;
  rows?: string[][];
  header?: boolean;
  src?: string;
  alt?: string;
  start?: number;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Raw authored text. The single source of truth; chips are derived from it. */
  text: string;
  indent: number;
  tags: string[];
  classification: Classification;
  props: BlockProps;
  /** Present iff type === 'CHECKBOX'. */
  task?: Task;
}

export type PageKind = 'daily' | 'free';

export interface Page {
  id: string;
  sectionId: string;
  kind: PageKind;
  title: string;
  /** Set iff kind === 'daily'. ISO day string, and unique within the section. */
  date: string | null;
  blocks: Block[];
  createdAt: number;
  updatedAt: number;
}

export interface Section {
  id: string;
  notebookId: string;
  name: string;
  /** OneNote section tab color. */
  color: string;
}

export interface Notebook {
  id: string;
  name: string;
  color: string;
}

/** Lightweight page descriptor for the page list — avoids loading block content. */
export interface PageSummary {
  id: string;
  sectionId: string;
  kind: PageKind;
  title: string;
  date: string | null;
  updatedAt: number;
  preview: string;
  /** 0–4, drives the activity dots in the page list. */
  activity: number;
}

/**
 * One day's close: what you meant to do, and what happened.
 *
 * Deliberately not stored as blocks in the note. The note is free-form text you
 * own; this is structured data the retro reads, and mixing them would mean
 * parsing prose to answer "did the week match the intent".
 */
export interface DayReflection {
  /** ISO day string. Unique per user — the day *is* the identity. */
  date: string;
  intent: string;
  wentWell: string;
  blockers: string;
  /** Snapshots taken at close time, not live aggregates. Editing the note a */
  focusMinutes: number;
  /** month later must not rewrite what that day felt like. */
  tasksDone: number;
  tasksOpen: number;
}

/** A focus commitment for a week. `tag` is what makes it measurable. */
export interface Goal {
  text: string;
  tag: string | null;
  targetMin: number;
}

export interface GoalScore extends Goal {
  /** Counted from focus-timer totals, never generated. */
  actualMin: number;
}

export interface WeekSummary {
  weekStart: string;
  narrative: string;
  highlights: string[];
  dropped: string[];
  focusByTag: Record<string, number>;
  /** Goals for the week *after* `weekStart`. */
  goals: Goal[];
  /** How the goals set at the previous close actually went. */
  goalScores: GoalScore[];
  generatedAt: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * A pointer back to the block an answer came from.
 *
 * Lives here rather than in the AI service so the API layer can name it
 * without importing upwards into a service — the dependency only ever points
 * from services down to the domain.
 */
export interface Citation {
  date: string | null;
  pageId: string;
  blockId: string;
  label: string;
}

export interface SearchFilters {
  from?: string;
  to?: string;
  tags?: string[];
  classification?: Classification;
  done?: boolean;
  priority?: Priority;
  isTask?: boolean;
}

export interface SearchHit {
  pageId: string;
  blockId: string;
  date: string | null;
  title: string;
  type: BlockType;
  heading: string | null;
  snippet: string;
  /** Character ranges inside `snippet` to highlight. */
  spans: Array<[number, number]>;
  score: number;
}

export interface WeeklyStats {
  from: string;
  to: string;
  tasksTotal: number;
  tasksDone: number;
  carriedForward: number;
  highPriorityDone: number;
  professional: number;
  personal: number;
  estimateMin: number;
  actualMin: number;
  topTags: Array<{ tag: string; count: number }>;
  bestDay: string | null;
  perDay: Array<{ date: string; done: number; total: number }>;
}
