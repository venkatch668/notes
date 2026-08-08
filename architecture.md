# Architecture — Personal Work Notebook

Companion documents: [requirements.md](requirements.md) (what to build),
[design.md](design.md) (how each subsystem is designed in detail).

## 1. Existing repository

Inspected before any design decision was made. The repo is a five-file static PWA:

| File | Role today |
|---|---|
| `index.html` | Shell + all CSS inline in a `<style>` block. Mounts `#root`. |
| `app.js` | React 18 imported from `esm.sh`, `React.createElement` (no JSX), a hardcoded `NOTEBOOKS` array, four presentational components, `localStorage` for UI selection state. |
| `manifest.json` | PWA manifest ("OneNote Todo"). |
| `service-worker.js` | Cache-first precache of the five assets, network fallback. |
| `icon.svg` | App icon. |

Characteristics that matter: **no build step, no bundler, no package.json, no
dependencies beyond CDN React, no server, no tests.** State is UI selection only;
there is no domain model, no persistence of user content, and the note content is
static demo data.

## 2. Stack decision

**React + TypeScript (Vite) on the front, Python (FastAPI + Postgres) on the
back.** Chosen for scale: the product accumulates years of notes, and search,
embeddings, and RAG are the features that decide whether it stays useful at that
size. Those belong in a real database and a real service, not in browser storage.

| Layer | Choice | Why |
|---|---|---|
| UI | React 18 + TypeScript, Vite | Types are load-bearing once the block/task model has this many derived fields. Vite gives HMR and a real build. |
| Styling | Plain CSS with design tokens | The UI is a faithful OneNote clone; a component library would fight it the whole way. One token file owns all color. |
| API | FastAPI + Pydantic | Pydantic models mirror the TypeScript types 1:1, so the contract is enforced on both ends. |
| Store | Postgres | One engine covers relational data, full-text search (`tsvector`), and semantic search (`pgvector`) — no second datastore. |
| AI | Provider interface, key held server-side | Swappable model; the browser never holds an API key. |

**Migration state.** Phase A (current) is frontend-only: the app runs against a
localStorage implementation of the API interface, so the UI is fully usable and
demoable before any Python exists. Phase B replaces that one module with an HTTP
client. Nothing above `src/api/` changes — that is the entire point of the seam.

What the earlier zero-build PWA at the repo root gave us: a working reference for
the visual direction. It is superseded by `frontend/` and can be deleted once the
new UI is signed off.

## 3. Layering

```
┌──────────────────────────────────────────────────────────┐
│ UI                 React components, keyboard, DnD       │
│                    No business rules, no storage access  │
├──────────────────────────────────────────────────────────┤
│ Application        NoteService   TaskService             │
│ Services           SearchService AIService               │
│                    AnalyticsService AuthService          │
├──────────────────────────────────────────────────────────┤
│ Domain             Block/Task/Tag models, parsing,       │
│                    invariants, pure functions, no I/O    │
├──────────────────────────────────────────────────────────┤
│ Data Access        Repositories + SearchIndex            │
│                    (interface, not an implementation)    │
├──────────────────────────────────────────────────────────┤
│ Storage            localStorage today                    │
│                    IndexedDB / HTTP later                │
└──────────────────────────────────────────────────────────┘
```

Dependency rule: arrows point down only. Domain imports nothing. UI never
imports a repository. Services are the only layer that composes across modules.

## 4. Modules

Phase A, as built:

```
frontend/
  src/
    types/
      models.ts          domain types — the wire contract with Python
      ui.ts              ribbon tabs, quick ranges
    domain/              pure, no I/O, directly unit-testable
      dates.ts           day keys, ranges, @due and ~duration parsing
      parse.ts           typing grammar, inline tokens, annotate(), paste
    lib/
      caret.ts           contenteditable caret helpers
    api/
      types.ts           WorkspaceApi — THE seam
      localApi.ts        localStorage implementation (Phase A)
      httpApi.ts         FastAPI client                (Phase B)
    services/
      aiService.ts       tool layer + provider interface + local provider
    components/
      Chrome.tsx         title bar, ribbon tabs, toolbar
      Panes.tsx          notebook / section / page panes, month calendar
      NoteCanvas.tsx     page surface, block operations, carry-forward
      BlockRow.tsx       one editable block; keyboard + drag behaviour
      Inline.tsx         inline markup renderer, search highlighting
      Chips.tsx          derived task attribute chips
      SearchPalette.tsx  Ctrl+K search with filters
      AIPanel.tsx        assistant thread with citations
      InsightsPanel.tsx  weekly analytics
    styles/
      tokens.css         all color and metrics live here
      app.css            the OneNote visual system
```

Phase B (planned):

```
backend/
  app/
    api/routes/          notes, pages, search, tasks, ai, analytics
    domain/              block/task rules mirrored from the frontend
    services/            note, task, search, ai, analytics
    db/                  SQLAlchemy models, migrations
    ai/                  provider interface, tool layer, RAG pipeline
```

## 5. Key architectural decisions

**AD-1 — One note per date is the aggregate root.** `DailyNote` keyed by
`YYYY-MM-DD` is the unit of load, save, and cache. Tasks are not a separate
collection; they are `CHECKBOX` blocks, projected into a task view on read. This
is what keeps the UX from drifting into task-management: there is no task table
to manage, only text you wrote.

**AD-2 — Search is an index, never a scan.** Phase B puts it in Postgres: a
`tsvector` column with a GIN index for keyword search, `pgvector` for semantic,
fused at query time. Phase A ships a straightforward linear scan in
`localApi.search` — honest for a few hundred seeded notes, and deliberately
behind the same `WorkspaceApi.search` signature so replacing it is invisible to
the UI. This is the one place the current code knowingly does not meet NFR-3;
the interface is what makes that a scheduling decision rather than a rewrite.

**AD-3 — The LLM gets tools, not a database.** `ai/tools.js` exposes four
read-only functions returning shaped DTOs with hard caps on result size. The
model cannot express a query the tool layer did not anticipate, cannot write, and
cannot read outside the requested date scope. Prompt injection from note content
is therefore bounded to influencing *text*, not *access*.

**AD-4 — Provider behind an interface, local provider as default.** `AIProvider`
exposes a single `answer(question, retrievedContext)`. The shipped local provider
implements it extractively — it composes answers out of retrieved notes with no
network call and no key. A hosted Claude provider slots in during Phase B, where
the key lives on the Python side and never reaches the browser.

**AD-5 — Hybrid retrieval, gracefully degraded.** Keyword and semantic results
are fused with reciprocal rank fusion. If no embeddings exist, fusion is a no-op
over one list. Semantic search is thus an enhancement, never a dependency.

**AD-6 — Block-level identity.** Every block carries a stable `id`. Search
results, AI citations, drag-and-drop, and scroll-to-match all address blocks by
id, so none of them break when surrounding text is edited.

## 6. Cross-cutting concerns

| Concern | Approach |
|---|---|
| Persistence failure | Every write goes through one `storage.js` chokepoint; quota errors surface a non-blocking banner and the in-memory note stays intact. |
| Data safety | JSON export/import; schema `version` field on the workspace root enables forward migration. |
| Performance | Debounced autosave (400 ms idle), incremental reindex of changed blocks only, virtualized rendering above ~300 blocks. |
| Privacy | Default configuration performs zero network calls after asset load. |
| Accessibility | Landmarks, labeled controls, full keyboard reachability, AA contrast. |
| Testability | Domain is pure and directly unit-testable; services take injected repos. |

## 7. Deployment

Phase A: `npm run build` produces a static `dist/` served from any static host.

Phase B: the SPA is served as static assets; FastAPI serves `/api` behind the
same origin (Vite already proxies `/api` to `127.0.0.1:8000` in development, so
no code changes between dev and prod). Postgres runs as a managed instance or a
container. Docker Compose ties the three together for local work.

## 8. Phasing

| Phase | Contents | Status |
|---|---|---|
| A1 | OneNote shell, block editor, checkbox tasks, tags, priority, date navigation, calendar, local persistence, search, insights, local AI panel | **built** |
| A2 | Selection popover with AI note actions, proposal/approval diff, attachments, drag-and-drop polish, virtualized long notes | next |
| B1 | FastAPI + Postgres, real auth, `httpApi.ts` swap, server-side full-text search | |
| B2 | Embeddings + pgvector, hybrid retrieval, hosted model provider, server-side RAG and insights | |
| B3 | Voice input, reminders, recurring tasks, PWA/offline sync | |

The seams for the later phases exist now (`WorkspaceApi`, `AIProvider`, the tool
layer); the machinery does not.
