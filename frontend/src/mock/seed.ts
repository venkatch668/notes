/**
 * Seed content so the UI has something real to render on first run.
 * Replaced wholesale once the Python backend owns the data.
 */

import type { Block, Notebook, Page, Section } from '../types/models';
import { applyShortcuts, makeBlock, newId } from '../domain/parse';
import { addDays, todayKey } from '../domain/dates';

const lines = (src: string): Block[] =>
  src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => applyShortcuts(makeBlock('TEXT', l)));

export function seedWorkspace(): {
  version: number;
  notebooks: Notebook[];
  sections: Section[];
  pages: Page[];
} {
  const work: Notebook = { id: 'nb-work', name: 'Work Notebook', color: '#7719AA' };
  const personal: Notebook = { id: 'nb-personal', name: 'Personal', color: '#CA5010' };

  const sections: Section[] = [
    { id: 'sec-daily', notebookId: work.id, name: 'Daily Log', color: '#7719AA' },
    { id: 'sec-meetings', notebookId: work.id, name: 'Meetings', color: '#0078D4' },
    { id: 'sec-ideas', notebookId: work.id, name: 'Ideas', color: '#107C10' },
    { id: 'sec-home', notebookId: personal.id, name: 'Home', color: '#CA5010' },
  ];

  const t = todayKey();

  const daily: Array<[string, string]> = [
    [
      t,
      `## Morning
      [] Finish architecture design !high ~2h #professional
      [x] Review PR #123 =45m #professional
      ## Meeting with platform team
      Discussed Kafka notification flow and the retry semantics for the Gem Shop release.
      [] Verify Kafka notification flow @tomorrow !high #professional #meeting
      ## Personal
      [] Buy groceries !med #personal
      ## Ideas
      - Improve onboarding
      - AI recommendation engine
      - Weekly productivity report`,
    ],
    [
      addDays(t, -1),
      `## Tasks
      [x] Draft the requirements doc =1h30m #professional
      [x] 1:1 with Priya =30m #professional #meeting
      [] Follow up on the Gem Shop rollout plan !high #professional
      ## Notes
      Gem Shop release is gated on the notification consumer being idempotent.
      ## Personal
      [x] Gym =1h #personal`,
    ],
    [
      addDays(t, -2),
      `## Tasks
      [x] Fix flaky integration test =2h #professional
      [x] Sprint planning =1h #professional #meeting
      [] Write the postmortem for the cache incident !med #professional
      ## Ideas
      - Cache warm-up on deploy could remove the cold-start spike`,
    ],
    [
      addDays(t, -3),
      `## Tasks
      [x] Ship the search index migration !high =3h #professional
      ## Notes
      Migration took longer than the 2h estimate; the backfill was the slow part.
      ## Personal
      [x] Call the bank =20m #personal`,
    ],
  ];

  const pages: Page[] = daily.map(([date, body]) => ({
    id: newId(),
    sectionId: 'sec-daily',
    kind: 'daily' as const,
    title: date,
    date,
    blocks: lines(body),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));

  pages.push({
    id: newId(),
    sectionId: 'sec-meetings',
    kind: 'free',
    title: 'Platform sync — Kafka notifications',
    date: null,
    blocks: lines(`# Platform sync
      Attendees: platform team, me
      ## Decisions
      - Notification consumer must be idempotent before the Gem Shop release
      - Retry with exponential backoff, dead-letter after 5 attempts
      ## Actions
      [] Verify Kafka notification flow @tomorrow !high #professional
      [] Document the dead-letter runbook #professional`),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  pages.push({
    id: newId(),
    sectionId: 'sec-ideas',
    kind: 'free',
    title: 'Game Recommendations',
    date: null,
    blocks: lines(`# Game Recommendations
      Idea: surface recommendations from play history rather than purchase history.
      - Cold start is the hard part
      - Could reuse the embedding pipeline from search
      [] Prototype the ranking model !low #professional #idea`),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  pages.push({
    id: newId(),
    sectionId: 'sec-home',
    kind: 'free',
    title: 'Vacation ideas',
    date: null,
    blocks: lines(`# Vacation ideas
      - Coorg in October
      - Long weekend in Goa
      [] Check flight prices !low #personal`),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return { version: 1, notebooks: [work, personal], sections, pages };
}
