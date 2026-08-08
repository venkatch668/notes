/**
 * The starting workspace for local mode.
 *
 * Deliberately EMPTY of notes. Earlier this file shipped a few days of
 * fabricated entries (Kafka, Gem Shop, groceries) so the UI had something to
 * render before a backend existed. Now that one does, inventing content is
 * actively harmful: it is indistinguishable from the user's real notes, it
 * makes a misconfigured deploy look like a working one, and nobody wants to
 * delete somebody else's example data before writing their first line.
 *
 * What it does create is the same default structure the backend's
 * `ensure_workspace()` creates — one notebook, three sections, no pages — so
 * local mode and server mode present the same empty notebook rather than two
 * different first-run experiences.
 */

import type { Notebook, Page, Section } from '../types/models';

export interface Workspace {
  version: number;
  notebooks: Notebook[];
  sections: Section[];
  pages: Page[];
}

/** Mirrors DEFAULT_NOTEBOOK / DEFAULT_SECTIONS in the backend service. */
export function seedWorkspace(): Workspace {
  const work: Notebook = { id: 'nb-work', name: 'Work Notebook', color: '#7719AA' };

  const sections: Section[] = [
    { id: 'sec-daily', notebookId: work.id, name: 'Daily Log', color: '#7719AA' },
    { id: 'sec-meetings', notebookId: work.id, name: 'Meetings', color: '#0078D4' },
    { id: 'sec-ideas', notebookId: work.id, name: 'Ideas', color: '#107C10' },
  ];

  // No pages. Today's note is created on first keystroke, exactly as it is
  // against the server.
  return { version: 1, notebooks: [work], sections, pages: [] };
}
