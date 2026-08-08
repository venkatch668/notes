import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block, Notebook, Page, PageSummary, SearchHit, Section } from './types/models';
import type { RibbonTab } from './types/ui';
import { api, offline, type SyncState } from './api';
import { addDays, startOfWeek, todayKey } from './domain/dates';
import { annotate, makeBlock } from './domain/parse';
import { TitleBar, TabStrip, Toolbar, type RibbonActions } from './components/Chrome';
import { NotebookPane, PagePane, SectionPane } from './components/Panes';
import { NoteCanvas } from './components/NoteCanvas';
import { SearchPalette } from './components/SearchPalette';
import { AIPanel } from './components/AIPanel';
import { InsightsPanel } from './components/InsightsPanel';
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
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);

  const activeBlockId = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

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
    api.pendingBefore(page.date).then((items) => {
      // Anything already present on today's page is not a carry-forward candidate.
      const here = new Set(page.blocks.map((b) => b.text.trim()));
      setCarry(items.filter(({ block }) => !here.has(block.text.trim())));
    });
  }, [page?.date, page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* -------------------------------------------------------------- saving */

  // Bumped on every edit so a save that lands late cannot overwrite newer
  // state with the version stamp of an older one.
  const revision = useRef(0);

  const changePage = useCallback((next: Page) => {
    setPage(next);
    const rev = (revision.current += 1);

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const saved = await api.savePage(next);
        // Adopt the server's timestamp so the following save is not rejected as
        // stale. Only the stamp — never the blocks, which would clobber
        // anything typed while the request was in flight.
        if (saved && revision.current === rev) {
          setPage((cur) => (cur && cur.id === saved.id ? { ...cur, updatedAt: saved.updatedAt } : cur));
        }
      } catch (err) {
        console.error('Save failed', err);
      }
    }, 400);
  }, []);

  /* ---------------------------------------------------------- navigation */

  const openDate = useCallback(async (date: string) => {
    const p = await api.getOrCreateDaily(dailySectionId.current ?? '', date);
    if (dailySectionId.current) setSectionId(dailySectionId.current);
    setPage(withSeedBlock(p));
    setCarryDismissed(false);
    closeNavOnMobile();
  }, [closeNavOnMobile]);

  const openPage = useCallback(async (pageId: string) => {
    const p = await api.getPage(pageId);
    if (p) setPage(withSeedBlock(p));
    closeNavOnMobile();
  }, [closeNavOnMobile]);

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

  const acceptCarry = async (items: Array<{ page: PageSummary; block: Block }>) => {
    if (!page) return;
    const added = items.map(({ page: src, block }) =>
      annotate({
        ...block,
        id: makeBlock().id,
        task: { ...(block.task ?? {}), done: false, completedAt: null, carriedFrom: src.date } as Block['task'],
      }),
    );
    changePage({ ...page, blocks: [...page.blocks, ...added] });
    setCarry((prev) => prev.filter((c) => !items.some((i) => i.block.id === c.block.id)));
  };

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
            onAcceptCarry={acceptCarry}
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

      {searchOpen && (
        <SearchPalette
          onClose={() => setSearchOpen(false)}
          onOpenHit={(h: SearchHit) => jumpTo(h)}
        />
      )}
    </div>
  );
}
