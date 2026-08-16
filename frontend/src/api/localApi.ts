/**
 * localStorage implementation of `WorkspaceApi`.
 *
 * Deliberately simple: correctness and shape-fidelity matter more than speed
 * here, because search and analytics move to Postgres/Python in the next phase.
 * Everything is awaited so that swapping in the HTTP client is a drop-in.
 */

import type { WorkspaceApi } from './types';
import type {
  Block,
  Citation,
  DayReflection,
  Goal,
  Notebook,
  Page,
  PageSummary,
  SearchFilters,
  SearchHit,
  Section,
  WeeklyStats,
  WeekSummary,
} from '../types/models';
import { displayText, newId, taskOf } from '../domain/parse';
import { addDays, rangeDays, todayKey } from '../domain/dates';
import { seedWorkspace } from '../mock/seed';

const KEY = 'work-notebook:v1';

interface Db {
  version: number;
  notebooks: Notebook[];
  sections: Section[];
  pages: Page[];
  // Optional: a store written by an older build has neither, and defaulting
  // them on read is cheaper than a migration for two arrays.
  reflections?: DayReflection[];
  weeks?: WeekSummary[];
}

function load(): Db {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const db = JSON.parse(raw) as Db;
      if (db && Array.isArray(db.pages)) return db;
    } catch {
      // Corrupt payload: fall through to a fresh seed rather than dying on boot.
      console.warn('Stored workspace was unreadable; reseeding.');
    }
  }
  const seeded = seedWorkspace();
  localStorage.setItem(KEY, JSON.stringify(seeded));
  return seeded;
}

let db: Db | null = null;
function get(): Db {
  if (!db) db = load();
  return db;
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(get()));
  } catch (err) {
    // Quota is the realistic failure. Surface it without discarding memory state.
    console.error('Save failed (storage quota?):', err);
    throw new Error('QuotaError');
  }
}

function activityOf(page: Page): number {
  const blocks = page.blocks.filter((b) => b.text.trim() || b.type === 'DIVIDER').length;
  const done = page.blocks.filter((b) => b.task?.done).length;
  return Math.max(0, Math.min(4, Math.round(blocks / 4 + done / 2)));
}

function summarize(page: Page): PageSummary {
  const first = page.blocks.find((b) => b.text.trim() && b.type !== 'HEADING');
  return {
    id: page.id,
    sectionId: page.sectionId,
    kind: page.kind,
    title: page.title,
    date: page.date,
    updatedAt: page.updatedAt,
    preview: first ? displayText(first).slice(0, 90) : '',
    activity: activityOf(page),
  };
}

function headingAbove(page: Page, blockId: string): string | null {
  const idx = page.blocks.findIndex((b) => b.id === blockId);
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (page.blocks[i].type === 'HEADING') return displayText(page.blocks[i]);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Query parsing — the subset from design.md §5.2                      *
 * ------------------------------------------------------------------ */

interface ParsedQuery {
  terms: string[];
  phrases: string[];
  filters: SearchFilters;
}

export function parseQuery(raw: string): ParsedQuery {
  const filters: SearchFilters = {};
  const terms: string[] = [];
  const phrases: string[] = [];

  const phraseRe = /"([^"]+)"/g;
  let rest = raw.replace(phraseRe, (_m, p) => {
    phrases.push(p.toLowerCase());
    return ' ';
  });

  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    const [k, v] = tok.includes(':') ? tok.split(':', 2) : ['', tok];
    switch (k.toLowerCase()) {
      case 'tag':
        (filters.tags ??= []).push(v.toLowerCase().replace(/^#/, ''));
        break;
      case 'is':
        if (v === 'task') filters.isTask = true;
        else if (v === 'done') { filters.isTask = true; filters.done = true; }
        else if (v === 'pending') { filters.isTask = true; filters.done = false; }
        break;
      case 'priority':
        filters.priority = v as SearchFilters['priority'];
        break;
      case 'before':
        filters.to = v;
        break;
      case 'after':
        filters.from = v;
        break;
      default:
        if (tok.startsWith('#')) (filters.tags ??= []).push(tok.slice(1).toLowerCase());
        else terms.push(tok.toLowerCase());
    }
  }
  return { terms, phrases, filters };
}

function snippetAround(text: string, needles: string[]): { snippet: string; spans: Array<[number, number]> } {
  const lower = text.toLowerCase();
  let first = -1;
  for (const n of needles) {
    const i = lower.indexOf(n);
    if (i >= 0 && (first === -1 || i < first)) first = i;
  }
  const start = first < 0 ? 0 : Math.max(0, first - 40);
  const raw = text.slice(start, start + 180);
  const prefix = start > 0 ? '…' : '';
  const snippet = prefix + raw + (start + 180 < text.length ? '…' : '');

  const spans: Array<[number, number]> = [];
  const sl = snippet.toLowerCase();
  for (const n of needles) {
    let i = sl.indexOf(n);
    while (i >= 0) {
      spans.push([i, i + n.length]);
      i = sl.indexOf(n, i + n.length);
    }
  }
  return { snippet, spans: spans.sort((a, b) => a[0] - b[0]) };
}

function matchesFilters(page: Page, block: Block, f: SearchFilters): boolean {
  if (f.isTask && block.type !== 'CHECKBOX') return false;
  if (f.done !== undefined && block.task?.done !== f.done) return false;
  if (f.priority && block.task?.priority !== f.priority) return false;
  if (f.classification && block.classification !== f.classification) return false;
  if (f.tags?.length && !f.tags.every((t) => block.tags.includes(t))) return false;
  if (f.from && (page.date ?? '9999') < f.from) return false;
  if (f.to && (page.date ?? '0000') > f.to) return false;
  return true;
}

/** Field weights from design.md §5.2. */
function fieldWeight(block: Block): number {
  if (block.type === 'HEADING') return 3;
  if (block.type === 'CHECKBOX') return 2;
  return 1;
}

export class LocalApi implements WorkspaceApi {
  async listNotebooks(): Promise<Notebook[]> {
    return get().notebooks;
  }

  async listSections(notebookId: string): Promise<Section[]> {
    return get().sections.filter((s) => s.notebookId === notebookId);
  }

  async listPages(sectionId: string): Promise<PageSummary[]> {
    return get()
      .pages.filter((p) => p.sectionId === sectionId)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.updatedAt - a.updatedAt)
      .map(summarize);
  }

  async getPage(pageId: string): Promise<Page | null> {
    return get().pages.find((p) => p.id === pageId) ?? null;
  }

  async getOrCreateDaily(sectionId: string, date: string): Promise<Page> {
    const existing = get().pages.find((p) => p.sectionId === sectionId && p.date === date);
    if (existing) return existing;

    const page: Page = {
      id: newId(),
      sectionId,
      kind: 'daily',
      title: date,
      date,
      blocks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    get().pages.push(page);
    persist();
    return page;
  }

  async createPage(sectionId: string, title: string): Promise<Page> {
    const page: Page = {
      id: newId(),
      sectionId,
      kind: 'free',
      title,
      date: null,
      blocks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    get().pages.push(page);
    persist();
    return page;
  }

  async savePage(page: Page): Promise<Page> {
    const d = get();
    const i = d.pages.findIndex((p) => p.id === page.id);
    const next = { ...page, updatedAt: Date.now() };
    if (i >= 0) d.pages[i] = next;
    else d.pages.push(next);
    persist();
    return next;
  }

  async deletePage(pageId: string): Promise<void> {
    const d = get();
    d.pages = d.pages.filter((p) => p.id !== pageId);
    persist();
  }

  async createSection(notebookId: string, name: string): Promise<Section> {
    const palette = ['#7719AA', '#0078D4', '#107C10', '#CA5010', '#C239B3', '#008272'];
    const section: Section = {
      id: newId(),
      notebookId,
      name,
      color: palette[get().sections.length % palette.length],
    };
    get().sections.push(section);
    persist();
    return section;
  }

  async createNotebook(name: string): Promise<Notebook> {
    const palette = ['#7719AA', '#CA5010', '#0078D4', '#107C10'];
    const nb: Notebook = { id: newId(), name, color: palette[get().notebooks.length % palette.length] };
    get().notebooks.push(nb);
    persist();
    return nb;
  }

  async search(query: string, extra: SearchFilters = {}): Promise<SearchHit[]> {
    const { terms, phrases, filters } = parseQuery(query);
    const merged: SearchFilters = { ...filters, ...extra, tags: [...(filters.tags ?? []), ...(extra.tags ?? [])] };
    const needles = [...terms, ...phrases];
    const hits: SearchHit[] = [];
    const today = todayKey();

    for (const page of get().pages) {
      for (const block of page.blocks) {
        if (!matchesFilters(page, block, merged)) continue;

        const hay = `${block.text} ${block.tags.join(' ')}`.toLowerCase();
        let score = 0;

        if (needles.length === 0) {
          // Filter-only query (e.g. `is:pending priority:high`) — everything
          // passing the predicates is a hit, ranked by recency alone.
          score = 1;
        } else {
          for (const n of needles) {
            const occurrences = hay.split(n).length - 1;
            if (occurrences === 0) { score = 0; break; }
            score += occurrences * fieldWeight(block);
          }
        }
        if (score <= 0) continue;

        if (page.date) {
          const ageDays = Math.max(0, rangeDays(page.date, today).length - 1);
          score *= 1 + 0.3 * Math.exp(-ageDays / 45);
        }

        const { snippet, spans } = snippetAround(displayText(block), needles);
        hits.push({
          pageId: page.id,
          blockId: block.id,
          date: page.date,
          title: page.title,
          type: block.type,
          heading: headingAbove(page, block.id),
          snippet,
          spans,
          score,
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score || (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 100);
  }

  /**
   * Carry-forward candidates: tasks that are still genuinely live.
   *
   * A task leaves this list three ways — checked off, forwarded to a later day,
   * or explicitly dropped. Only `done` used to count, which is why a task
   * carried on Monday kept being offered again every morning for the rest of
   * the week: completing the copy never settled the original.
   *
   * Ordered by due date first so the overdue work is what you see, then by
   * recency. The limit is applied after sorting, not while collecting.
   */
  async pendingBefore(date: string, limit = 12): Promise<Array<{ page: PageSummary; block: Block }>> {
    const out: Array<{ page: PageSummary; block: Block }> = [];
    const pages = get().pages.filter((p) => p.date && p.date < date);

    for (const page of pages) {
      for (const block of page.blocks) {
        if (block.type !== 'CHECKBOX') continue;
        const task = taskOf(block);
        if (task.done || task.forwardedTo || task.droppedAt) continue;
        out.push({ page: summarize(page), block });
      }
    }

    // Undated tasks sort after dated ones rather than in front of them, which
    // is what a plain string compare against null would do.
    const dueKey = (b: Block) => taskOf(b).due ?? '9999-12-31';
    out.sort(
      (a, b) =>
        dueKey(a.block).localeCompare(dueKey(b.block)) ||
        (b.page.date ?? '').localeCompare(a.page.date ?? ''),
    );

    return out.slice(0, limit);
  }

  /* ----------------------------------------------------- Retrospection */

  async getReflection(date: string): Promise<DayReflection | null> {
    return get().reflections?.find((r) => r.date === date) ?? null;
  }

  async saveReflection(reflection: DayReflection): Promise<DayReflection> {
    const store = get();
    store.reflections = [
      ...(store.reflections ?? []).filter((r) => r.date !== reflection.date),
      reflection,
    ];
    persist();
    return reflection;
  }

  async getWeekSummary(weekStart: string): Promise<WeekSummary | null> {
    return get().weeks?.find((w) => w.weekStart === weekStart) ?? null;
  }

  /**
   * Local mode has no model, so the narrative is assembled from the numbers.
   *
   * Honest about what it is rather than pretending: the counted facts are the
   * same ones the hosted retro is given, just without the prose written around
   * them. Better than an empty panel and better than a fake summary.
   */
  async generateWeekSummary(weekStart: string): Promise<WeekSummary> {
    const stats = await this.weeklyStats(weekStart);
    const weekEnd = addDays(weekStart, 6);
    const pages = get().pages.filter((p) => p.date && p.date >= weekStart && p.date <= weekEnd);

    const focusByTag: Record<string, number> = {};
    const highlights: string[] = [];
    const dropped: string[] = [];

    for (const page of pages) {
      for (const block of page.blocks) {
        if (block.type !== 'CHECKBOX') continue;
        const task = taskOf(block);
        if (task.actualMin) {
          for (const tag of block.tags) {
            focusByTag[tag] = (focusByTag[tag] ?? 0) + task.actualMin;
          }
        }
        if (task.done && highlights.length < 5) highlights.push(displayText(block));
        if (task.droppedAt && dropped.length < 5) dropped.push(displayText(block));
      }
    }

    const pct = stats.tasksTotal ? Math.round((stats.tasksDone / stats.tasksTotal) * 100) : 0;
    const previous = await this.getWeekSummary(addDays(weekStart, -7));
    const goals = previous?.goals ?? [];

    const summary: WeekSummary = {
      weekStart,
      narrative: [
        `You completed ${stats.tasksDone} of ${stats.tasksTotal} tasks (${pct}%).`,
        stats.actualMin
          ? `You logged ${Math.round(stats.actualMin / 60)}h of focused time against ${Math.round(stats.estimateMin / 60)}h estimated.`
          : 'No focused time was logged this week — start a timer on a task to change that.',
        stats.carriedForward ? `${stats.carriedForward} task(s) carried forward.` : '',
        'Connect the backend with a Gemini key for a written retrospective.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      highlights,
      dropped,
      focusByTag,
      goals: (await this.getWeekSummary(weekStart))?.goals ?? [],
      goalScores: goals.map((g) => ({ ...g, actualMin: focusByTag[g.tag ?? ''] ?? 0 })),
      generatedAt: new Date().toISOString(),
    };

    const store = get();
    store.weeks = [...(store.weeks ?? []).filter((w) => w.weekStart !== weekStart), summary];
    persist();
    return summary;
  }

  async saveGoals(weekStart: string, goals: Goal[]): Promise<WeekSummary> {
    const store = get();
    const existing = store.weeks?.find((w) => w.weekStart === weekStart);
    const next: WeekSummary = existing
      ? { ...existing, goals }
      : {
          weekStart,
          narrative: '',
          highlights: [],
          dropped: [],
          focusByTag: {},
          goals,
          goalScores: [],
          generatedAt: null,
        };
    store.weeks = [...(store.weeks ?? []).filter((w) => w.weekStart !== weekStart), next];
    persist();
    return next;
  }

  /* ---------------------------------------------------------------- AI */

  async aiEnabled(): Promise<boolean> {
    // No backend, so no key can be held safely. The caller falls back to the
    // local extractive provider.
    return false;
  }

  async chat(): Promise<{ text: string; citations: Citation[] }> {
    throw new Error('The hosted assistant needs the backend. Using local answers instead.');
  }

  async weeklyStats(weekStart: string): Promise<WeeklyStats> {
    const weekEnd = addDays(weekStart, 6);
    const days = rangeDays(weekStart, weekEnd);
    const pages = get().pages.filter((p) => p.date && p.date >= weekStart && p.date <= weekEnd);

    const stats: WeeklyStats = {
      from: weekStart,
      to: weekEnd,
      tasksTotal: 0,
      tasksDone: 0,
      carriedForward: 0,
      highPriorityDone: 0,
      professional: 0,
      personal: 0,
      estimateMin: 0,
      actualMin: 0,
      topTags: [],
      bestDay: null,
      perDay: days.map((date) => ({ date, done: 0, total: 0 })),
    };

    const tagCounts = new Map<string, number>();

    for (const page of pages) {
      const bucket = stats.perDay.find((d) => d.date === page.date);
      for (const block of page.blocks) {
        for (const t of block.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
        if (block.classification === 'professional') stats.professional += 1;
        if (block.classification === 'personal') stats.personal += 1;

        const task = block.task;
        if (!task) continue;

        stats.tasksTotal += 1;
        if (bucket) bucket.total += 1;
        if (task.carriedFrom) stats.carriedForward += 1;
        stats.estimateMin += task.estimateMin ?? 0;
        stats.actualMin += task.actualMin ?? 0;
        if (task.done) {
          stats.tasksDone += 1;
          if (bucket) bucket.done += 1;
          if (task.priority === 'high') stats.highPriorityDone += 1;
        }
      }
    }

    stats.topTags = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const best = [...stats.perDay].sort((a, b) => b.done - a.done)[0];
    stats.bestDay = best && best.done > 0 ? best.date : null;

    return stats;
  }

  async exportAll(): Promise<string> {
    return JSON.stringify(get(), null, 2);
  }

  async importAll(json: string): Promise<void> {
    const parsed = JSON.parse(json) as Db;
    if (!parsed || !Array.isArray(parsed.pages) || !Array.isArray(parsed.notebooks)) {
      throw new Error('ValidationError: not a workspace export');
    }
    db = parsed;
    persist();
  }
}

export const api: WorkspaceApi = new LocalApi();
