/**
 * Offline layer — a decorator around any `WorkspaceApi`.
 *
 * The sync model (design.md): **the server is authoritative, the browser keeps
 * a cache.** Reads prefer the network and fall back to the cache; writes apply
 * to the cache immediately and are queued if the network is unavailable, then
 * replayed in order on reconnect.
 *
 * Why a decorator rather than logic inside `HttpApi`: caching and queueing are
 * orthogonal to transport. This class knows nothing about URLs, and `HttpApi`
 * knows nothing about offline. Either can be tested or replaced alone.
 *
 * Deliberately NOT a CRDT. One user, usually one device at a time, block-level
 * granularity, and a server-side 409 to catch the rare genuine conflict — that
 * is proportionate. Multi-device simultaneous editing would need more.
 */

import type { WorkspaceApi } from './types';
import type {
  Block,
  Notebook,
  Page,
  PageSummary,
  SearchFilters,
  SearchHit,
  Section,
  WeeklyStats,
} from '../types/models';
import { ApiError } from './httpApi';

const CACHE_KEY = 'work-notebook:cache:v1';
const QUEUE_KEY = 'work-notebook:queue:v1';

interface CacheShape {
  notebooks: Notebook[];
  sections: Record<string, Section[]>;
  summaries: Record<string, PageSummary[]>;
  pages: Record<string, Page>;
  dailyByDate: Record<string, string>;
}

/** A write that has not yet reached the server. Replayed in FIFO order. */
type QueuedOp =
  | { kind: 'savePage'; pageId: string; page: Page; queuedAt: number }
  | { kind: 'claimDaily'; pageId: string; date: string; queuedAt: number }
  | { kind: 'createPage'; pageId: string; sectionId: string; title: string; queuedAt: number };

const emptyCache = (): CacheShape => ({
  notebooks: [],
  sections: {},
  summaries: {},
  pages: {},
  dailyByDate: {},
});

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota: the cache is expendable, the queue is not. Never let a cache
    // write failure take down the app.
    console.warn(`Could not persist ${key}`, err);
  }
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'conflict' | 'error';

export class OfflineApi implements WorkspaceApi {
  private cache: CacheShape = readJson(CACHE_KEY, emptyCache());
  private queue: QueuedOp[] = readJson(QUEUE_KEY, [] as QueuedOp[]);
  private flushing = false;

  /** Notified on every state change so the UI can show a sync indicator. */
  onStateChange: ((state: SyncState, pending: number) => void) | null = null;

  constructor(private readonly remote: WorkspaceApi) {
    window.addEventListener('online', () => void this.flush());
    if (navigator.onLine) void this.flush();
  }

  /* ------------------------------------------------------------ plumbing */

  private saveCache(): void {
    writeJson(CACHE_KEY, this.cache);
  }

  private saveQueue(): void {
    writeJson(QUEUE_KEY, this.queue);
    this.emit(navigator.onLine ? 'idle' : 'offline');
  }

  private emit(state: SyncState): void {
    this.onStateChange?.(state, this.queue.length);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  /** True when the failure means "no network", as opposed to a real API error. */
  private isNetworkFailure(err: unknown): boolean {
    return !(err instanceof ApiError);
  }

  private enqueue(op: QueuedOp): void {
    // A page only needs its newest save: superseding older entries keeps the
    // queue bounded during a long offline editing session.
    if (op.kind === 'savePage') {
      this.queue = this.queue.filter((q) => !(q.kind === 'savePage' && q.pageId === op.pageId));
    }
    this.queue.push(op);
    this.saveQueue();
  }

  /**
   * Replays queued writes in order. Stops at the first network failure so
   * ordering is preserved; drops operations the server rejects permanently,
   * because retrying a 4xx forever would wedge the queue.
   */
  async flush(): Promise<void> {
    if (this.flushing || !this.queue.length || !navigator.onLine) return;

    this.flushing = true;
    this.emit('syncing');

    try {
      while (this.queue.length) {
        const op = this.queue[0];
        try {
          await this.apply(op);
          this.queue.shift();
          this.saveQueue();
        } catch (err) {
          if (this.isNetworkFailure(err)) {
            this.emit('offline');
            return; // keep the queue intact; try again on reconnect
          }
          if (err instanceof ApiError && err.isConflict) {
            // The server has a newer version. Its copy wins; we drop our queued
            // write rather than clobbering, and refresh the cache from it.
            this.queue.shift();
            this.saveQueue();
            await this.refreshPage(op).catch(() => undefined);
            this.emit('conflict');
            continue;
          }
          console.error('Dropping unreplayable operation', op, err);
          this.queue.shift();
          this.saveQueue();
          this.emit('error');
        }
      }
      this.emit('idle');
    } finally {
      this.flushing = false;
    }
  }

  private async apply(op: QueuedOp): Promise<void> {
    switch (op.kind) {
      case 'claimDaily':
        await this.remote.getOrCreateDaily('', op.date);
        return;
      case 'createPage':
        await this.remote.createPage(op.sectionId, op.title);
        return;
      case 'savePage': {
        const saved = await this.remote.savePage(op.page);
        this.cache.pages[op.pageId] = { ...op.page, updatedAt: saved.updatedAt };
        this.saveCache();
        return;
      }
    }
  }

  private async refreshPage(op: QueuedOp): Promise<void> {
    const fresh = await this.remote.getPage(op.pageId);
    if (fresh) {
      this.cache.pages[fresh.id] = fresh;
      this.saveCache();
    }
  }

  /**
   * Read helper: try the network, cache the result, fall back to the cache when
   * offline. A cache miss while offline is the only case that can still fail.
   */
  private async readThrough<T>(
    fetcher: () => Promise<T>,
    cached: () => T | undefined,
    store: (value: T) => void,
  ): Promise<T> {
    try {
      const value = await fetcher();
      store(value);
      this.saveCache();
      return value;
    } catch (err) {
      const fallback = cached();
      if (fallback !== undefined) {
        if (this.isNetworkFailure(err)) this.emit('offline');
        return fallback;
      }
      throw err;
    }
  }

  /* -------------------------------------------------------------- reads */

  listNotebooks(): Promise<Notebook[]> {
    return this.readThrough(
      () => this.remote.listNotebooks(),
      () => (this.cache.notebooks.length ? this.cache.notebooks : undefined),
      (v) => {
        this.cache.notebooks = v;
      },
    );
  }

  listSections(notebookId: string): Promise<Section[]> {
    return this.readThrough(
      () => this.remote.listSections(notebookId),
      () => this.cache.sections[notebookId],
      (v) => {
        this.cache.sections[notebookId] = v;
      },
    );
  }

  listPages(sectionId: string): Promise<PageSummary[]> {
    return this.readThrough(
      () => this.remote.listPages(sectionId),
      () => this.cache.summaries[sectionId],
      (v) => {
        this.cache.summaries[sectionId] = v;
      },
    );
  }

  getPage(pageId: string): Promise<Page | null> {
    return this.readThrough(
      () => this.remote.getPage(pageId),
      () => this.cache.pages[pageId],
      (v) => {
        if (v) this.cache.pages[v.id] = v;
      },
    );
  }

  async getOrCreateDaily(sectionId: string, date: string): Promise<Page> {
    try {
      const page = await this.remote.getOrCreateDaily(sectionId, date);
      this.cache.pages[page.id] = page;
      this.cache.dailyByDate[date] = page.id;
      this.saveCache();
      return page;
    } catch (err) {
      if (!this.isNetworkFailure(err)) throw err;

      const knownId = this.cache.dailyByDate[date];
      const cached = knownId ? this.cache.pages[knownId] : undefined;
      if (cached) {
        this.emit('offline');
        return cached;
      }

      // Offline on a day that has no note yet. Create a provisional page with a
      // client-generated id and queue the claim — the backend's PUT /daily/{day}
      // is idempotent and accepts that id, so the note keeps its identity when
      // it syncs and queued edits still refer to something real.
      const provisional: Page = {
        id: crypto.randomUUID(),
        sectionId,
        kind: 'daily',
        title: date,
        date,
        blocks: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.cache.pages[provisional.id] = provisional;
      this.cache.dailyByDate[date] = provisional.id;
      this.saveCache();
      this.enqueue({
        kind: 'claimDaily',
        pageId: provisional.id,
        date,
        queuedAt: Date.now(),
      });
      this.emit('offline');
      return provisional;
    }
  }

  search(query: string, filters?: SearchFilters): Promise<SearchHit[]> {
    // Server-side full-text search has no offline equivalent worth faking;
    // an empty result is less misleading than a silently degraded one.
    return this.remote.search(query, filters).catch((err) => {
      if (this.isNetworkFailure(err)) {
        this.emit('offline');
        return [];
      }
      throw err;
    });
  }

  pendingBefore(date: string, limit?: number): Promise<Array<{ page: PageSummary; block: Block }>> {
    return this.remote.pendingBefore(date, limit).catch((err) => {
      if (this.isNetworkFailure(err)) return [];
      throw err;
    });
  }

  weeklyStats(weekStart: string): Promise<WeeklyStats> {
    return this.remote.weeklyStats(weekStart);
  }

  /* ------------------------------------------------------------- writes */

  async savePage(page: Page): Promise<Page> {
    // Cache first, unconditionally: what the user typed is never lost to a
    // network problem.
    this.cache.pages[page.id] = page;
    this.saveCache();

    if (!navigator.onLine) {
      this.enqueue({ kind: 'savePage', pageId: page.id, page, queuedAt: Date.now() });
      return page;
    }

    try {
      // Adopt the server's version stamp. Without this the cached page keeps
      // the timestamp it was loaded with, so the *next* save sends a stale
      // `baseUpdatedAt` and is rejected as a conflict — a self-inflicted 409
      // on the second keystroke pause.
      const saved = await this.remote.savePage(page);
      const merged = { ...page, updatedAt: saved.updatedAt };
      this.cache.pages[page.id] = merged;
      this.saveCache();
      return merged;
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) throw err; // caller must merge
      if (this.isNetworkFailure(err)) {
        this.enqueue({ kind: 'savePage', pageId: page.id, page, queuedAt: Date.now() });
        return page;
      }
      throw err;
    }
  }

  async createPage(sectionId: string, title: string): Promise<Page> {
    try {
      const page = await this.remote.createPage(sectionId, title);
      this.cache.pages[page.id] = page;
      this.saveCache();
      return page;
    } catch (err) {
      if (!this.isNetworkFailure(err)) throw err;

      const provisional: Page = {
        id: crypto.randomUUID(),
        sectionId,
        kind: 'free',
        title,
        date: null,
        blocks: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.cache.pages[provisional.id] = provisional;
      this.saveCache();
      this.enqueue({
        kind: 'createPage',
        pageId: provisional.id,
        sectionId,
        title,
        queuedAt: Date.now(),
      });
      return provisional;
    }
  }

  async deletePage(pageId: string): Promise<void> {
    delete this.cache.pages[pageId];
    this.saveCache();
    await this.remote.deletePage(pageId);
  }

  createNotebook(name: string): Promise<Notebook> {
    return this.remote.createNotebook(name);
  }

  createSection(notebookId: string, name: string): Promise<Section> {
    return this.remote.createSection(notebookId, name);
  }

  exportAll(): Promise<string> {
    return this.remote.exportAll();
  }

  importAll(json: string): Promise<void> {
    return this.remote.importAll(json);
  }
}
