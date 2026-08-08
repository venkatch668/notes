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
  savePage(page: Page): Promise<void>;
  deletePage(pageId: string): Promise<void>;

  createSection(notebookId: string, name: string): Promise<Section>;
  createNotebook(name: string): Promise<Notebook>;

  search(query: string, filters?: SearchFilters): Promise<SearchHit[]>;
  /** Unchecked tasks from days before `date`, for the carry-forward strip. */
  pendingBefore(date: string, limit?: number): Promise<Array<{ page: PageSummary; block: Block }>>;
  weeklyStats(weekStart: string): Promise<WeeklyStats>;

  exportAll(): Promise<string>;
  importAll(json: string): Promise<void>;
}
