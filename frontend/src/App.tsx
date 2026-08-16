import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block, Notebook, Page, PageSummary, Priority, SearchHit, Section } from './types/models';
import type { RibbonTab } from './types/ui';
import { api, offline, type SyncState } from './api';
import { addDays, startOfWeek, todayKey } from './domain/dates';
import { annotate, makeBlock, newId, taskKey, taskOf } from './domain/parse';
import { TitleBar, TabStrip, Toolbar, type RibbonActions } from './components/Chrome';
import { NotebookPane, PagePane, SectionPane } from './components/Panes';
import { NoteCanvas } from './components/NoteCanvas';
import { SearchPalette } from './components/SearchPalette';
import { AIPanel } from './components/AIPanel';
import { InsightsPanel } from './components/InsightsPanel';
import { DayReviewModal, type ReviewDecision } from './components/DayReviewModal';
import type { Citation } from './services/aiService';
import { MOBILE_QUERY, useMediaQuery } from './lib/useMediaQuery';

/**
 * The daily note lives in a section identified by NAME, not by a hardcoded id.
 *
 * Ids differ per backend — local mode invents readable ones ('sec-daily'),
 * Postgres generates UUIDs — so assuming either breaks the other. Against the
 * server a literal 'sec-daily' is not a valid UUID and the API rejects it with
 * 422 before it even checks the token.
 */
const DAILY_SECTION_NAME = 'Daily Log';

/**
 * A page must always have something to put the caret in, otherwise "open and
 * write" needs a click first. Not persisted until the user actually types.
 */
function withSeedBlock(p: Page): Page {
  return p.blocks.length ? p : { ...p, blocks: [makeBlock('TEXT', '')] };
}

/** Which day the review was last shown for. Local to the device on purpose. */
const REVIEWED_KEY = 'notebook.lastReviewedDay';

/** The stricter of two deadlines; null means "no deadline", so it never wins. */
function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

const PRIORITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

function strongerPriority(a: Priority, b: Priority): Priority {
  return (PRIORITY_RANK[b ?? ''] ?? 0) > (PRIORITY_RANK[a ?? ''] ?? 0) ? b : a;
}

export default function App() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [pages, setPages] = useState<PageSummary[]>([]);

  // Null until discovered from the API. Never guessed.
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const dailySectionId = useRef<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);

  const [tab, setTab] = useState<RibbonTab>('Home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);

  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [sync, setSync] = useState<{ state: SyncState; pending: number }>({
    state: 'idle',
    pending: 0,
  });
  const [navOpen, setNavOpen] = useState(!isMobile);

  const [carry, setCarry] = useState<Array<{ page: PageSummary; block: Block }>>([]);
  const [carryDismissed, setCarryDismissed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);

  const activeBlockId = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNavOpen(!isMobile);
  }, [isMobile]);

  // Surface sync state from the offline layer, when there is one.
  useEffect(() => {
    const layer = offline;
    if (!layer) return;
    layer.onStateChange = (state, pending) => setSync({ state, pending });
    return () => {
      layer.onStateChange = null;
    };
  }, []);

  // On a phone the drawer covers the note, so any navigation choice should
  // close it — otherwise every tap needs a second tap to see the result.
  const closeNavOnMobile = useCallback(() => {
    if (isMobile) setNavOpen(false);
  }, [isMobile]);

  /* ------------------------------------------------------------- loading */

  useEffect(() => {
    (async () => {
      const nbs = await api.listNotebooks();
      setNotebooks(nbs);
      if (!nbs.length) return;

      const firstNotebook = nbs[0];
      setNotebookId(firstNotebook.id);

      const secs = await api.listSections(firstNotebook.id);
      setSections(secs);

      const daily = secs.find((s) => s.name === DAILY_SECTION_NAME) ?? secs[0];
      dailySectionId.current = daily?.id ?? null;
      setSectionId(daily?.id ?? null);

      const today = await api.getOrCreateDaily(daily?.id ?? '', todayKey());
      setPage(withSeedBlock(today));
    })();
  }, []);

  useEffect(() => {
    if (!notebookId) return;
    api.listSections(notebookId).then((s) => {
      setSections(s);
      if (!s.some((x) => x.id === sectionId) && s[0]) setSectionId(s[0].id);
    });
  }, [notebookId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshPages = useCallback(async () => {
    if (!sectionId) return;
    setPages(await api.listPages(sectionId));
  }, [sectionId]);

  useEffect(() => {
    refreshPages();
  }, [refreshPages, page?.updatedAt]);

  useEffect(() => {
    if (!page?.date || page.date !== todayKey()) {
      setCarry([]);
      return;
    }
    // No client-side text dedupe any more: a task already present on today's
    // page is a *merge* target, not something to hide, and the source is
    // settled server-side by `forwardedTo` rather than guessed at here.
    api.pendingBefore(page.date).then(setCarry);
  }, [page?.date, page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --------------------------------------------------------- day rollover */

  /**
   * Open the review on the first sight of a new day.
   *
   * Tied to opening the app rather than to a 00:00 timer: a timer only fires
   * if the tab happens to be open at midnight, and the point of the review is
   * that you are there to make the decisions. `visibilitychange` covers the
   * common case of a tab left open overnight.
   */
  useEffect(() => {
    if (!page?.date || page.date !== todayKey()) return;

    const check = () => {
      const today = todayKey();
      if (localStorage.getItem(REVIEWED_KEY) === today) return;
      setReviewOpen(true);
    };

    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [page?.date]);

  // Stamped on close, not on apply: dismissing the review is also a decision,
  // and re-prompting on every tab focus would make it noise rather than a
  // ritual. The toolbar button reopens it deliberately.
  const closeReview = useCallback(() => {
    localStorage.setItem(REVIEWED_KEY, todayKey());
    setReviewOpen(false);
  }, []);

  /* -------------------------------------------------------------- saving */

  // Edits only touch local state; nothing reaches the server until the user
  // clicks Save. Bumped on every edit so a save that lands late cannot
  // overwrite newer state with the version stamp of an older one.
  const revision = useRef(0);

  const changePage = useCallback((next: Page) => {
    setPage(next);
    setDirty(true);
    revision.current += 1;
  }, []);

  const savePage = useCallback(async () => {
    if (!page) return true;
    const rev = revision.current;
    setSaving(true);
    try {
      const saved = await api.savePage(page);
      if (saved && revision.current === rev) {
        // Adopt the server's timestamp so the next save is not rejected as
        // stale, but keep the locally-typed blocks — a request in flight
        // must never clobber what was typed after it was sent.
        setPage((cur) => (cur && cur.id === saved.id ? { ...cur, updatedAt: saved.updatedAt } : cur));
        setDirty(false);
      }
      return true;
    } catch (err) {
      console.error('Save failed', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [page]);

  // Unsaved edits are only in memory — warn before a hard reload/close loses them.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Ask before navigating away from a page with unsaved edits: returns true
  // if it's safe to proceed (saved, discarded, or nothing was dirty).
  const confirmLeave = useCallback(async () => {
    if (!dirty) return true;
    const choice = window.confirm('This page has unsaved changes. Save them before leaving?\n\nOK = save, Cancel = discard and continue.');
    if (choice) return savePage();
    setDirty(false);
    return true;
  }, [dirty, savePage]);

  /* ---------------------------------------------------------- navigation */

  const openDate = useCallback(async (date: string) => {
    if (!(await confirmLeave())) return;
    const p = await api.getOrCreateDaily(dailySectionId.current ?? '', date);
    if (dailySectionId.current) setSectionId(dailySectionId.current);
    setPage(withSeedBlock(p));
    setCarryDismissed(false);
    closeNavOnMobile();
  }, [closeNavOnMobile, confirmLeave]);

  const openPage = useCallback(async (pageId: string) => {
    if (!(await confirmLeave())) return;
    const p = await api.getPage(pageId);
    if (p) setPage(withSeedBlock(p));
    closeNavOnMobile();
  }, [closeNavOnMobile, confirmLeave]);

  const jumpTo = useCallback(
    async (hit: { pageId: string; blockId: string }) => {
      await openPage(hit.pageId);
      setSearchOpen(false);
      setFlashBlockId(hit.blockId);
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-block-id="${hit.blockId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      window.setTimeout(() => setFlashBlockId(null), 1400);
    },
    [openPage],
  );

  /* --------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'j') {
        e.preventDefault();
        setAiOpen((v) => !v);
        setInsightsOpen(false);
      } else if (e.key === '[' && page?.date) {
        e.preventDefault();
        openDate(addDays(page.date, -1));
      } else if (e.key === ']' && page?.date) {
        e.preventDefault();
        openDate(addDays(page.date, 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page?.date, openDate]);

  /* ------------------------------------------------------ carry-forward */

  /**
   * Apply the morning review.
   *
   * Three writes happen here, in this order, and the order matters: today's
   * page gets the carried tasks, every source page is settled so the same task
   * is never offered again, and only then is the day stamped as reviewed. If a
   * source write fails the whole thing throws, the modal shows it, and the day
   * stays unreviewed so nothing is silently half-applied.
   */
  const applyReview = useCallback(
    async (decisions: Map<string, ReviewDecision>, intent: string) => {
      if (!page) return;

      const byId = new Map(carry.map((c) => [c.block.id, c]));
      let blocks = [...page.blocks];

      /** Where each source block ended up, so the source can point at it. */
      const landed = new Map<string, string>();

      for (const [blockId, decision] of decisions) {
        const item = byId.get(blockId);
        if (!item || decision.action !== 'carry') continue;

        const source = item.block;
        const src = taskOf(source);
        const originId = src.originId ?? source.id;

        // Match on the origin id first: it survives rewording the task, which
        // a text comparison does not. Text is the fallback for a task typed
        // out again by hand on today's page rather than carried.
        const key = taskKey(source);
        const existing = blocks.find((b) => {
          if (b.type !== 'CHECKBOX') return false;
          const t = taskOf(b);
          if (t.done || t.droppedAt) return false;
          return (t.originId ?? b.id) === originId || taskKey(b) === key;
        });

        if (existing) {
          // Merge rather than append. Today's wording wins; the strictest
          // deadline and the highest priority win, because carrying a task
          // should never quietly relax it.
          const t = taskOf(existing);
          const merged = annotate({
            ...existing,
            task: {
              ...t,
              originId,
              carriedFrom: earlier(t.carriedFrom, item.page.date),
              carryCount: Math.max(t.carryCount, src.carryCount) + 1,
              due: decision.due ?? earlier(t.due, src.due),
              priority: strongerPriority(t.priority, src.priority),
              estimateMin: t.estimateMin ?? src.estimateMin,
            },
          });
          blocks = blocks.map((b) => (b.id === existing.id ? merged : b));
          landed.set(source.id, existing.id);
        } else {
          const created = annotate({
            ...source,
            id: newId(),
            task: {
              ...src,
              done: false,
              completedAt: null,
              forwardedTo: null,
              droppedAt: null,
              originId,
              carriedFrom: item.page.date,
              carryCount: src.carryCount + 1,
              due: decision.due ?? src.due,
            },
          });
          blocks = [...blocks, created];
          landed.set(source.id, created.id);
        }
      }

      // The intent is stored, not written into the note. It is the one record
      // of what you *meant* to do, and the weekly retro scores the week against
      // it — parsing that back out of prose would be guesswork.
      if (intent) {
        const existing = await api.getReflection(page.date!).catch(() => null);
        await api.saveReflection({
          date: page.date!,
          intent,
          wentWell: existing?.wentWell ?? '',
          blockers: existing?.blockers ?? '',
          focusMinutes: existing?.focusMinutes ?? 0,
          tasksDone: existing?.tasksDone ?? 0,
          tasksOpen: existing?.tasksOpen ?? 0,
        });
      }

      // Settle the sources, one page at a time. Sequential on purpose: each
      // save carries an `updatedAt` for the optimistic-concurrency check, and
      // firing them in parallel against the same page would race.
      const touched = new Map<string, Array<{ blockId: string; decision: ReviewDecision }>>();
      for (const [blockId, decision] of decisions) {
        const item = byId.get(blockId);
        if (!item || decision.action === 'skip') continue;
        const list = touched.get(item.page.id) ?? [];
        list.push({ blockId, decision });
        touched.set(item.page.id, list);
      }

      for (const [pageId, entries] of touched) {
        const src = await api.getPage(pageId);
        if (!src) continue;
        const nextBlocks = src.blocks.map((b) => {
          const entry = entries.find((e) => e.blockId === b.id);
          if (!entry || b.type !== 'CHECKBOX') return b;
          const t = taskOf(b);
          return {
            ...b,
            task:
              entry.decision.action === 'drop'
                ? { ...t, droppedAt: Date.now() }
                : { ...t, forwardedTo: landed.get(b.id) ?? null },
          };
        });
        await api.savePage({ ...src, blocks: nextBlocks });
      }

      changePage({ ...page, blocks });
      setCarry((prev) => prev.filter((c) => !decisions.has(c.block.id)));
    },
    [page, carry, changePage],
  );

  /* ------------------------------------------------------ ribbon actions */

  const mutateActive = (fn: (b: Block) => Block) => {
    if (!page) return;
    const id = activeBlockId.current ?? page.blocks[page.blocks.length - 1]?.id;
    if (!id) return;
    changePage({ ...page, blocks: page.blocks.map((b) => (b.id === id ? annotate(fn(b)) : b)) });
  };

  const actions: RibbonActions = {
    setBlockType: (type, level) =>
      mutateActive((b) => ({
        ...b,
        type,
        props: type === 'HEADING' ? { level: level ?? 2 } : {},
        task: type === 'CHECKBOX' ? (b.task ?? undefined) : undefined,
      })),
    wrapInline: (marker) => mutateActive((b) => ({ ...b, text: `${b.text}${marker}text${marker}` })),
    addTag: (tag) =>
      mutateActive((b) => (b.tags.includes(tag) ? b : { ...b, text: `${b.text.trimEnd()} #${tag}` })),
    insertTemplate: () => {
      if (!page) return;
      const created = ['Morning', 'Tasks', 'Meetings', 'Notes', 'Ideas', 'Personal', 'End of Day'].flatMap(
        (n) => [makeBlock('HEADING', n, { props: { level: 2 } }), makeBlock('TEXT', '')],
      );
      changePage({ ...page, blocks: [...page.blocks, ...created] });
    },
    newPage: async () => {
      if (!sectionId) return;
      if (!(await confirmLeave())) return;
      const p = await api.createPage(sectionId, 'Untitled page');
      setPage(withSeedBlock(p));
      refreshPages();
    },
    today: () => openDate(todayKey()),
    exportJson: async () => {
      const json = await api.exportAll();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `work-notebook-${todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  };

  /* ------------------------------------------------------------ derived */

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of pages) m[p.sectionId] = (m[p.sectionId] ?? 0) + 1;
    return m;
  }, [pages]);

  const quick = useMemo(() => {
    if (!page?.date) return null;
    if (page.date === todayKey()) return 'today';
    if (page.date === addDays(todayKey(), -1)) return 'yesterday';
    if (page.date >= startOfWeek(todayKey())) return 'week';
    return 'month';
  }, [page?.date]);

  const notebookName = notebooks.find((n) => n.id === notebookId)?.name ?? 'Work Notebook';
  const sidePanel = aiOpen || insightsOpen;

  return (
    <div className="app">
      <TitleBar
        notebookName={notebookName}
        aiOpen={aiOpen}
        insightsOpen={insightsOpen}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        syncState={sync.state}
        syncPending={sync.pending}
        onSearch={() => setSearchOpen(true)}
        onToggleAi={() => {
          setAiOpen((v) => !v);
          setInsightsOpen(false);
        }}
        onToggleInsights={() => {
          setInsightsOpen((v) => !v);
          setAiOpen(false);
        }}
      />

      <TabStrip active={tab} onSelect={setTab} />
      <Toolbar tab={tab} actions={actions} />

      <div
        className={[
          'workspace',
          sidePanel ? 'workspace--ai' : '',
          navOpen ? 'workspace--nav' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isMobile && navOpen && (
          <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden />
        )}

        <nav className={`nav ${navOpen ? 'nav--open' : ''}`} aria-label="Notebook navigation">
        <NotebookPane
          notebooks={notebooks}
          activeId={notebookId}
          onSelect={setNotebookId}
          onAdd={async () => {
            const name = window.prompt('Notebook name');
            if (name) {
              await api.createNotebook(name);
              setNotebooks(await api.listNotebooks());
            }
          }}
        />

        <SectionPane
          sections={sections}
          activeId={sectionId}
          counts={counts}
          quick={quick}
          onSelect={setSectionId}
          onQuick={(which) => {
            const t = todayKey();
            if (which === 'today') openDate(t);
            else if (which === 'yesterday') openDate(addDays(t, -1));
            else {
              if (dailySectionId.current) setSectionId(dailySectionId.current);
              setSearchOpen(true);
            }
          }}
          onAdd={async () => {
            if (!notebookId) return;
            const name = window.prompt('Section name');
            if (name) {
              await api.createSection(notebookId, name);
              setSections(await api.listSections(notebookId));
            }
          }}
        />

        <PagePane
          pages={pages}
          activeId={page?.id ?? null}
          activeDate={page?.date ?? null}
          onSelect={openPage}
          onSelectDate={openDate}
          onAdd={actions.newPage}
        />
        </nav>

        {page ? (
          <NoteCanvas
            page={page}
            carry={carryDismissed ? [] : carry}
            flashBlockId={flashBlockId}
            onChangePage={changePage}
            onReviewCarry={() => setReviewOpen(true)}
            onDismissCarry={() => setCarryDismissed(true)}
            onActiveBlock={(id) => {
              activeBlockId.current = id;
            }}
          />
        ) : (
          <div className="canvas">
            <div className="empty">Opening today’s note…</div>
          </div>
        )}

        {aiOpen && (
          <AIPanel
            onOpenCitation={(c: Citation) => jumpTo({ pageId: c.pageId, blockId: c.blockId })}
          />
        )}
        {insightsOpen && <InsightsPanel />}
      </div>

      {reviewOpen && page?.date === todayKey() && (
        <DayReviewModal
          today={page.date}
          sectionId={sectionId}
          pending={carry}
          onApply={applyReview}
          onClose={closeReview}
        />
      )}

      {searchOpen && (
        <SearchPalette
          onClose={() => setSearchOpen(false)}
          onOpenHit={(h: SearchHit) => jumpTo(h)}
        />
      )}

      {(dirty || saving) && (
        <div className="save-bar" role="status">
          <span className="save-bar__label">{saving ? 'Saving…' : 'Unsaved changes'}</span>
          <button
            type="button"
            className="save-bar__button"
            disabled={saving}
            onClick={() => void savePage()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
