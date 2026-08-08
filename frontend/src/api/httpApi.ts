/**
 * HTTP implementation of `WorkspaceApi`, talking to the FastAPI backend.
 *
 * This is the whole point of the interface in `types.ts`: swapping `localApi`
 * for this one changes where data lives without touching a single component.
 *
 * Auth is injected rather than imported — the client does not know or care
 * whether the token comes from Supabase, a test stub, or nothing at all.
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

export type TokenProvider = () => Promise<string | null>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** A 409 means the server copy is newer; the caller should merge, not retry. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

export class HttpApi implements WorkspaceApi {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: TokenProvider = async () => null,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken();

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      // The backend returns a consistent { error: { code, message } } envelope;
      // fall back gracefully if a proxy returns something else.
      let code = 'http_error';
      let message = response.statusText;
      let details: Record<string, unknown> = {};
      try {
        const body = await response.json();
        code = body?.error?.code ?? code;
        message = body?.error?.message ?? message;
        details = body?.error ?? {};
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(response.status, code, message, details);
    }

    return (await response.json()) as T;
  }

  /* ------------------------------------------------------ Notebooks */

  listNotebooks(): Promise<Notebook[]> {
    return this.request('/notebooks');
  }

  createNotebook(name: string): Promise<Notebook> {
    return this.request('/notebooks', { method: 'POST', body: JSON.stringify({ name }) });
  }

  listSections(notebookId: string): Promise<Section[]> {
    return this.request(`/notebooks/${notebookId}/sections`);
  }

  createSection(notebookId: string, name: string): Promise<Section> {
    return this.request('/sections', {
      method: 'POST',
      body: JSON.stringify({ notebookId, name }),
    });
  }

  /* ---------------------------------------------------------- Pages */

  listPages(sectionId: string): Promise<PageSummary[]> {
    return this.request(`/sections/${sectionId}/pages`);
  }

  getPage(pageId: string): Promise<Page | null> {
    return this.request<Page>(`/pages/${pageId}`).catch((err) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    });
  }

  /** The server owns "one note per day", so the section argument is advisory. */
  getOrCreateDaily(_sectionId: string, date: string): Promise<Page> {
    return this.request(`/daily/${date}`);
  }

  createPage(sectionId: string, title: string): Promise<Page> {
    return this.request('/pages', { method: 'POST', body: JSON.stringify({ sectionId, title }) });
  }

  async savePage(page: Page): Promise<Page> {
    return this.request<Page>(`/pages/${page.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: page.title,
        blocks: page.blocks,
        // Optimistic concurrency: tells the server which version we edited.
        baseUpdatedAt: new Date(page.updatedAt).toISOString(),
      }),
    });
  }

  async deletePage(pageId: string): Promise<void> {
    await this.request(`/pages/${pageId}`, { method: 'DELETE' });
  }

  /* --------------------------------------------------------- Search */

  search(query: string, filters: SearchFilters = {}): Promise<SearchHit[]> {
    const params = new URLSearchParams({ q: query });
    filters.tags?.forEach((t) => params.append('tag', t));
    if (filters.classification) params.set('classification', filters.classification);
    if (filters.done !== undefined) params.set('done', String(filters.done));
    if (filters.priority) params.set('priority', filters.priority);
    return this.request(`/search?${params}`);
  }

  pendingBefore(date: string, limit = 20): Promise<Array<{ page: PageSummary; block: Block }>> {
    return this.request(`/tasks/pending?before=${date}&limit=${limit}`);
  }

  weeklyStats(weekStart: string): Promise<WeeklyStats> {
    return this.request(`/stats/weekly?week_start=${weekStart}`);
  }

  /* ----------------------------------------------------- Portability */

  async exportAll(): Promise<string> {
    const notebooks = await this.listNotebooks();
    const pages = await this.request<PageSummary[]>('/pages');
    const full = await Promise.all(pages.map((p) => this.getPage(p.id)));
    return JSON.stringify({ version: 1, notebooks, pages: full.filter(Boolean) }, null, 2);
  }

  async importAll(): Promise<void> {
    // Bulk import needs a transactional server endpoint to be safe; adding a
    // half-working client-side loop would risk a partial overwrite.
    throw new Error('Import is not supported against the server yet');
  }
}

/** Where the API lives. Same-origin `/api/v1` in production, proxied in dev. */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
