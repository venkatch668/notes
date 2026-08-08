/**
 * AI service — retrieval first, generation second (design.md §6).
 *
 * The default provider is local and extractive: it answers by retrieving and
 * summarizing your own notes, with no network call and no API key. A Claude
 * provider slots in behind `AIProvider` once the Python backend can hold the
 * key server-side, which is where it belongs.
 *
 * The provider only ever sees the output of the tool layer below — never the
 * store, never a query language.
 */

import type { WorkspaceApi } from '../api/types';
import type { Block, PageSummary, SearchHit, WeeklyStats } from '../types/models';
import { addDays, formatShort, startOfWeek, todayKey } from '../domain/dates';
import { displayText } from '../domain/parse';

export interface Citation {
  date: string | null;
  pageId: string;
  blockId: string;
  label: string;
}

export interface AiAnswer {
  text: string;
  citations: Citation[];
}

export interface AIProvider {
  readonly name: string;
  readonly needsKey: boolean;
  answer(question: string, ctx: RetrievedContext): Promise<AiAnswer>;
}

export interface RetrievedContext {
  hits: SearchHit[];
  stats: WeeklyStats | null;
  pending: Array<{ page: PageSummary; block: Block }>;
}

/* ------------------------------------------------------------ Tool layer */

/**
 * The complete surface a provider may touch. Read-only, size-capped, and
 * returning shaped DTOs — the containment boundary from design.md §6.2.
 */
export function makeTools(api: WorkspaceApi) {
  return {
    async searchNotes(query: string, limit = 40): Promise<SearchHit[]> {
      const hits = await api.search(query);
      return hits.slice(0, Math.min(limit, 40));
    },
    async listPending(before: string, limit = 20) {
      return api.pendingBefore(before, Math.min(limit, 200));
    },
    async getStats(weekStart: string): Promise<WeeklyStats> {
      return api.weeklyStats(weekStart);
    },
  };
}

/* -------------------------------------------------- Local (default) model */

const STOP = new Set([
  'what', 'did', 'i', 'my', 'the', 'a', 'an', 'on', 'in', 'of', 'to', 'for', 'me',
  'show', 'find', 'all', 'about', 'was', 'were', 'is', 'are', 'this', 'that',
  'week', 'month', 'today', 'yesterday', 'everything', 'related', 'notes', 'note',
  'work', 'working', 'accomplish', 'accomplished', 'summarize', 'summary',
]);

export function keywordsOf(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s#-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function bullet(hit: SearchHit): string {
  const when = hit.date ? formatShort(hit.date) : hit.title;
  return `• ${when} — ${hit.snippet.trim()}`;
}

export const localProvider: AIProvider = {
  name: 'Local (on-device, extractive)',
  needsKey: false,

  async answer(question, ctx) {
    const q = question.toLowerCase();
    const cite = (hits: SearchHit[]): Citation[] =>
      hits.slice(0, 6).map((h) => ({
        date: h.date,
        pageId: h.pageId,
        blockId: h.blockId,
        label: h.date ? formatShort(h.date) : h.title,
      }));

    // Accomplishments / summary
    if (/accomplish|summar|productiv|spend|spent|time on/.test(q) && ctx.stats) {
      const s = ctx.stats;
      const pct = s.tasksTotal ? Math.round((s.tasksDone / s.tasksTotal) * 100) : 0;
      const lines = [
        `You completed ${s.tasksDone} of ${s.tasksTotal} tasks this week (${pct}%).`,
      ];
      if (s.highPriorityDone) lines.push(`${s.highPriorityDone} of them were high priority.`);
      if (s.professional || s.personal) {
        lines.push(`Professional vs personal entries: ${s.professional} / ${s.personal}.`);
      }
      if (s.estimateMin && s.actualMin) {
        const delta = Math.round(((s.actualMin - s.estimateMin) / s.estimateMin) * 100);
        lines.push(
          `Logged ${Math.round(s.actualMin / 60)}h against ${Math.round(s.estimateMin / 60)}h estimated (${delta >= 0 ? '+' : ''}${delta}%).`,
        );
      }
      if (s.carriedForward) lines.push(`${s.carriedForward} task(s) were carried forward.`);
      if (s.bestDay) lines.push(`Most productive day: ${formatShort(s.bestDay)}.`);
      if (s.topTags.length) {
        lines.push(`Main topics: ${s.topTags.map((t) => `#${t.tag}`).join(', ')}.`);
      }
      if (ctx.hits.length) {
        lines.push('', 'Highlights:', ...ctx.hits.slice(0, 5).map(bullet));
      }
      return { text: lines.join('\n'), citations: cite(ctx.hits) };
    }

    // Pending / carried forward
    if (/pending|carry|carried|still|outstanding|commitment|left over/.test(q)) {
      if (!ctx.pending.length) return { text: 'Nothing is outstanding — every task is checked off.', citations: [] };
      const lines = [
        `${ctx.pending.length} task(s) still open:`,
        ...ctx.pending.slice(0, 12).map(
          ({ page, block }) => `• ${page.date ? formatShort(page.date) : page.title} — ${displayText(block)}`,
        ),
      ];
      return {
        text: lines.join('\n'),
        citations: ctx.pending.slice(0, 6).map(({ page, block }) => ({
          date: page.date,
          pageId: page.id,
          blockId: block.id,
          label: page.date ? formatShort(page.date) : page.title,
        })),
      };
    }

    // Topic lookup
    if (!ctx.hits.length) {
      return {
        text: "I could not find anything matching that in your notes.\n\nTry a narrower keyword, or use Ctrl+K search with a filter like `is:pending` or `tag:professional`.",
        citations: [],
      };
    }

    const byDate = new Map<string, SearchHit[]>();
    for (const h of ctx.hits.slice(0, 14)) {
      const k = h.date ?? h.title;
      byDate.set(k, [...(byDate.get(k) ?? []), h]);
    }

    const lines = [`Found ${ctx.hits.length} matching entries across ${byDate.size} notes:`, ''];
    for (const [, hits] of byDate) lines.push(bullet(hits[0]));

    return { text: lines.join('\n'), citations: cite(ctx.hits) };
  },
};

/* ------------------------------------------------------------ Orchestrator */

export class AiService {
  private tools: ReturnType<typeof makeTools>;

  constructor(
    api: WorkspaceApi,
    private provider: AIProvider = localProvider,
  ) {
    this.tools = makeTools(api);
  }

  get providerName(): string {
    return this.provider.name;
  }

  /** retrieve → build context → generate (design.md §6.1). */
  async ask(question: string): Promise<AiAnswer> {
    const words = keywordsOf(question);
    const query = words.join(' ');

    const [hits, pending, stats] = await Promise.all([
      query ? this.tools.searchNotes(query) : Promise.resolve<SearchHit[]>([]),
      this.tools.listPending(addDays(todayKey(), 1)),
      this.tools.getStats(startOfWeek(todayKey())),
    ]);

    return this.provider.answer(question, { hits, pending, stats });
  }
}

export const SUGGESTIONS = [
  'What did I accomplish this week?',
  'What commitments are still pending?',
  'Show everything related to Kafka',
  'Summarize my professional work this week',
  'What did I capture about Game Recommendations?',
];
