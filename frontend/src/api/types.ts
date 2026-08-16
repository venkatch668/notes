import type {
  Block,
  ChatMessage,
  DayReflection,
  Goal,
  Notebook,
  Page,
  PageSummary,
  SearchFilters,
  SearchHit,
  Section,
  Citation,
  WeeklyStats,
  WeekSummary,
} from '../types/models';

/**
 * The single seam between the UI and persistence.
 *
 * `LocalApi` implements this against localStorage today. The Python/FastAPI
 * backend will get an `HttpApi` implementing the same interface, and nothing
 * above this file changes — see architecture.md.
 */
export interface WorkspaceApi {
  listNotebooks(): Promise<Notebook[]>;
  listSections(notebookId: string): Promise<Section[]>;
  listPages(sectionId: string): Promise<PageSummary[]>;

  getPage(pageId: string): Promise<Page | null>;
  /** Returns the daily page for `date`, creating it if absent (FR-1.1). */
  getOrCreateDaily(sectionId: string, date: string): Promise<Page>;
  createPage(sectionId: string, title: string): Promise<Page>;
  /**
   * Persists a page and returns the stored version.
   *
   * Returning the page matters: the caller must adopt the server's new
   * `updatedAt`, otherwise its next save still carries the old one and the
   * optimistic-concurrency check rejects it as stale.
   */
  savePage(page: Page): Promise<Page>;
  deletePage(pageId: string): Promise<void>;

  createSection(notebookId: string, name: string): Promise<Section>;
  createNotebook(name: string): Promise<Notebook>;

  search(query: string, filters?: SearchFilters): Promise<SearchHit[]>;
  /** Unchecked tasks from days before `date`, for the carry-forward strip. */
  pendingBefore(date: string, limit?: number): Promise<Array<{ page: PageSummary; block: Block }>>;
  weeklyStats(weekStart: string): Promise<WeeklyStats>;

  /* ------------------------------------------------------- Retrospection */

  /** Null when the day has not been closed — a normal state, not an error. */
  getReflection(date: string): Promise<DayReflection | null>;
  saveReflection(reflection: DayReflection): Promise<DayReflection>;

  getWeekSummary(weekStart: string): Promise<WeekSummary | null>;
  /** Costs a model call, so it is only ever triggered deliberately. */
  generateWeekSummary(weekStart: string): Promise<WeekSummary>;
  /** Goals for the week following `weekStart`. */
  saveGoals(weekStart: string, goals: Goal[]): Promise<WeekSummary>;

  /* ------------------------------------------------------------------ AI */

  /** Whether a hosted model is configured, so the client can pick a provider. */
  aiEnabled(): Promise<boolean>;
  chat(messages: ChatMessage[]): Promise<{ text: string; citations: Citation[] }>;

  exportAll(): Promise<string>;
  importAll(json: string): Promise<void>;
}
