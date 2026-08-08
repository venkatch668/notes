# Design — Personal Work Notebook

Companion documents: [requirements.md](requirements.md), [architecture.md](architecture.md).
This document covers UX, components, system, data model, search, AI/RAG, services,
deployment, and security.

---

## 1. UX architecture

### 1.1 The one screen

A faithful OneNote frame — purple chrome, ribbon, three navigation panes — with
the daily note as the default page.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ N  Work Notebook   [🔍 Search all notebooks  Ctrl K]  Insights ✨ ⬤     │ purple
├──────────────────────────────────────────────────────────────────────────┤
│  File │ Home │ Insert │ Draw │ View │ Help                               │ purple
├──────────────────────────────────────────────────────────────────────────┤
│ B I {} │ H1 H2 H3 ¶ │ • 1. │ ☑ To Do  🏷 Professional  🏷 Personal      │ grey
├──────────┬──────────┬────────────┬───────────────────────────┬──────────┤
│NOTEBOOKS │ JUMP TO  │ PAGES      │  Friday, August 8, 2026   │  ✨      │
│▪ Work    │ Today    │ Aug 8  ●●● │  ──────────────────────── │  Assist- │
│▪ Personal│ Yesterday│ Aug 7  ●●  │  ## Morning               │  ant     │
│          │ This Week│ Aug 6  ●●●●│  ☐ Finish architecture    │          │
│          │ SECTIONS │ Aug 5  ●   │      High  ~2h  Profess.  │  (Ctrl J)│
│          │ ▪Daily Log│           │  ☑ Review PR #123   45m   │          │
│          │ ▪Meetings │ ◀ Aug ▶   │                           │          │
│          │ ▪Ideas    │ M T W T F │  ## Meeting with platform │          │
│          │           │ . . 6 7 8 │  Discussed Kafka flow...  │          │
│          │           │   ●● ●●●● │  ☐ Buy groceries  Personal│          │
└──────────┴──────────┴────────────┴───────────────────────────┴──────────┘
   200px      190px       236px          fluid, 860px sheet       360px
```

The canvas is the hero: white paper with faint rule lines, the widest and
brightest region, everything else in Fluent greys. The AI panel is off-screen
until invoked. Formatting works from both the ribbon and markdown shortcuts —
the ribbon is what makes it read as OneNote, the shortcuts are what make it fast.

**Reconciling the OneNote frame with "one note per day".** The frame has
notebooks, sections, and pages; the workflow does not require using them. The app
opens on today's page in the **Daily Log** section, created automatically, with
the caret already in it. Sections and free pages exist for material that is not a
day — meeting notes, long-lived idea pages — but nothing has to be created before
writing.

### 1.2 Primary loop

`Open → caret already in today's note → type → check off → close.`

No dialog, no project picker, no "new note" button. Today's note is created
lazily on first keystroke, so an untouched day leaves no empty record.

### 1.3 Keyboard map

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Search palette |
| `⌘J` | Toggle AI panel |
| `⌘[` / `⌘]` | Previous / next day with content |
| `⌘T` | Jump to today |
| `Enter` | New block, same type |
| `Shift+Enter` | Soft line break inside block |
| `Backspace` at offset 0 | Merge into previous block |
| `Tab` / `Shift+Tab` | Indent / outdent list item |
| `Alt+↑` / `Alt+↓` | Move block up / down |
| `⌘Enter` | Toggle checkbox on current block |
| `/` at block start | Block-type menu |

### 1.4 Typing grammar

Typed at the start of a block, converts immediately:

| Input | Becomes |
|---|---|
| `# ` `## ` `### ` | HEADING level 1–3 |
| `- ` or `* ` | BULLET |
| `1. ` | NUMBER |
| `[] ` or `[ ] ` | CHECKBOX (unchecked) |
| `[x] ` | CHECKBOX (done) |
| ` ``` ` | CODE |
| `---` | DIVIDER |
| `\|a\|b\|` | TABLE seed row |

Inline anywhere:

| Token | Meaning |
|---|---|
| `#tag` | Tag; `#professional` / `#personal` are classification |
| `!high` `!med` `!low` | Task priority |
| `@tomorrow` `@fri` `@2026-08-12` | Due date |
| `~2h` `~30m` | Estimate |
| `=45m` | Actual effort |
| `**b**` `*i*` `` `c` `` `[t](url)` | Inline formatting |

Tokens are parsed out of the text and rendered as chips; the raw token reappears
when the block regains focus, so the text stays the single source of truth.

### 1.5 Density and typography

One text column capped at 46rem for line length. 16px/1.7 body, tabular numerals
for durations. Sidebar 13px. Chips are small, low-saturation, and never louder
than the text they annotate. Professional = indigo, Personal = amber, applied
only to the chip, never the row background.

### 1.6 Carry-forward

Yesterday's unchecked tasks appear at the top of today's note in a dismissible
strip — not injected into the note. "Add all" / per-item add / "Not today".
Accepting copies the block with `carriedFrom` set, which is what powers the
"carried forward more than once" insight.

---

## 2. Component architecture

```
App
├─ AuthGate                     local profile, storage namespace
└─ Workspace
   ├─ Sidebar
   │  ├─ QuickDates             Today / Yesterday / Week / Month
   │  ├─ MonthCalendar          activity dots, month/year nav
   │  ├─ TagFilterList          tag chips with counts
   │  └─ InsightsButton
   ├─ NoteCanvas
   │  ├─ NoteHeader             date, classification split, counters
   │  ├─ CarryForwardStrip
   │  ├─ BlockList              DnD container, virtualized > 300
   │  │  └─ Block               dispatches on block.type
   │  │     ├─ TextBlock  HeadingBlock  BulletBlock  NumberBlock
   │  │     ├─ CheckboxBlock ── TaskChips, TaskPopover
   │  │     ├─ CodeBlock  TableBlock  ImageBlock  DividerBlock
   │  ├─ SelectionPopover       AI note actions (§6.5)
   │  └─ ProposalDiff           pending AI edits, approve/reject
   ├─ SearchPalette             ⌘K: query box, filters, results
   ├─ AIPanel                   ⌘J: thread, citations, tool trace
   └─ InsightsPanel             weekly aggregates
```

**Rules.** `Block` renders by looking `block.type` up in a registry, so a new
block type is one file plus one registry entry (FR-2.1). Components receive
services by props/context — they never import a repository. Only `Workspace`
holds note state; blocks are controlled and emit intents (`onChange`,
`onSplit`, `onMerge`, `onMove`), never mutate.

**Editing model.** Each block is its own `contenteditable` element, not one
document-wide editable. This gives per-block undo scoping, keeps React
reconciliation local to the edited block (NFR-2), and avoids the selection
bookkeeping that a single large editable requires.

---

## 3. System architecture

```
   User
    │
    ▼
┌────────────────────────────────────────────────────────┐
│ UI (React, no JSX, ES modules)                         │
└───────┬────────────────────────────────────────────────┘
        │ intents
        ▼
┌────────────────────────────────────────────────────────┐
│ Application Services                                   │
│  Note   Task   Search   Analytics   AI   Auth          │
└───┬──────────────┬─────────────────┬───────────────────┘
    │ pure calls   │ repo calls      │ tool calls
    ▼              ▼                 ▼
┌─────────┐  ┌──────────────┐  ┌──────────────────────┐
│ Domain  │  │ Data Access  │  │ AI tool layer        │
│ (pure)  │  │ noteRepo     │  │ searchNotes/getNote/ │
│         │  │ indexRepo    │  │ listTasks/getStats   │
│         │  │ vectorRepo   │  └──────────┬───────────┘
└─────────┘  └──────┬───────┘             │ shaped DTOs
                    │                     ▼
             ┌──────────────┐      ┌─────────────┐
             │ StorageAdapter│     │ AIProvider  │
             │ localStorage  │     │ local │ claude│
             └──────────────┘      └─────────────┘
```

Everything runs in the browser. The only outbound network call in the entire
system is `AIProvider.complete/embed` on the Claude provider, and only when the
user has configured it.

**Write path.** keystroke → block state → 400 ms debounce → `NoteService.save`
→ `noteRepo.put` + `indexRepo.update(changedBlocks)` → storage. Reindexing
touches only blocks whose text changed.

**Read path.** date → `noteRepo.get` (LRU-cached) → project tasks → render.

---

## 4. Data model

```js
/** @typedef {Object} Workspace
 *  @property {number} version        schema version, for migrations
 *  @property {string} userId
 *  @property {Object} settings       theme, aiProvider, scaffold prefs
 */

/** @typedef {Object} DailyNote
 *  @property {string}   date         'YYYY-MM-DD' — primary key
 *  @property {NoteBlock[]} blocks    ordered
 *  @property {string[]} tags         denormalized union of block tags
 *  @property {number}   createdAt
 *  @property {number}   updatedAt
 */

/** @typedef {Object} NoteBlock
 *  @property {string} id             stable, survives edits
 *  @property {BlockType} type        TEXT|HEADING|CHECKBOX|BULLET|
 *                                    NUMBER|TABLE|CODE|IMAGE|DIVIDER
 *  @property {string} text           raw authored text, source of truth
 *  @property {number} indent         0..n, list nesting
 *  @property {string[]} tags         parsed from text
 *  @property {'professional'|'personal'|null} classification
 *  @property {Object} props          type-specific bag (see below)
 *  @property {Task}  [task]          present iff type === 'CHECKBOX'
 */

/** @typedef {Object} Task
 *  @property {boolean} done
 *  @property {'high'|'medium'|'low'|null} priority
 *  @property {string|null} due          'YYYY-MM-DD'
 *  @property {number|null} estimateMin
 *  @property {number|null} actualMin
 *  @property {number|null} completedAt
 *  @property {string|null} reminderAt
 *  @property {string|null} carriedFrom  source date, for carry-forward chains
 */
```

`props` by type: `HEADING {level}`, `CODE {lang}`, `TABLE {rows: string[][],
header: boolean}`, `IMAGE {src, alt}`, `NUMBER {start}`. New block types add a
`props` shape and a renderer — no schema migration, satisfying FR-2.1.

Supporting entities:

| Entity | Shape | Storage key |
|---|---|---|
| `Tag` | derived, not stored: `{name, count, lastUsed}` computed from the index | — |
| `Attachment` | `{id, noteDate, blockId, mime, name, dataUrl}` | `att:<id>` |
| `AIConversation` | `{id, createdAt, messages[{role, content, citations[]}]}` | `conv:<id>` |
| `AIInsight` | `{id, period:'week'|'month', start, end, stats, bullets[], generatedAt}` | `insight:<period>:<start>` |

**Key layout** (namespaced by user, so multi-profile is a prefix change):

```
nb:<uid>:workspace          Workspace
nb:<uid>:note:2026-08-08    DailyNote
nb:<uid>:index:meta         {docCount, avgLen, version}
nb:<uid>:index:post:<term>  Posting[]  — sharded by term
nb:<uid>:vec:<date>         Float32 embeddings (optional)
```

Why one record per note and one per term: both are small, independently
writable, and avoid rewriting a monolithic blob on every keystroke — the single
biggest scaling hazard of a localStorage design.

---

## 5. Search architecture

### 5.1 Index

An inverted index built at save time.

```
tokenize(text) → lowercase → strip punctuation → split
               → drop stopwords → light stemmer (plural/-ing/-ed)

postings[term] = [ { date, blockId, tf, field } ... ]
   field ∈ { heading, task, text, tag }   → used for field weighting
```

`indexRepo` writes only the postings lists whose terms changed, computed by
diffing the block's previous and current token multisets. A note edit therefore
costs O(changed terms), not O(corpus).

### 5.2 Query pipeline

```
raw query
  │  parseQuery()
  ▼
{ terms[], phrases[], filters{tag, is, priority, before, after} }
  │
  ├─► keyword: fetch postings per term → intersect/union → BM25 score
  │            field boosts: heading ×3, task ×2, tag ×2.5, text ×1
  │            recency boost: ×(1 + 0.3·e^(−ageDays/45))
  │
  └─► semantic (optional): embed(query) → cosine over vectorRepo
                           → top 50
  │
  ▼  reciprocal rank fusion:  score = Σ 1/(60 + rank_i)
  ▼  filter by structured predicates
  ▼  group by date, snippet-extract around best match
  ▼  results[] { date, blockId, type, heading, snippet, spans[], score }
```

### 5.3 Scale

Cost is proportional to matched postings, never to note count. Postings are
sharded per term, so a query loads only the few keys it needs. Measured target:
< 100 ms at 10k notes (NFR-3). Growth path if postings outgrow localStorage
quota: `indexRepo` moves to IndexedDB behind the same interface — one module,
no callers change.

### 5.4 Results UX

Grouped by date, newest first. Each row: date, block-type icon, enclosing
heading, snippet with `<mark>` spans. Filter chips for date range,
professional/personal, tag, done/pending, priority. Selecting a result opens the
note, scrolls the block into view, and flashes its background for 1.2 s.

---

## 6. AI / RAG architecture

### 6.1 Flow

```
question
   ▼
AIService.ask()
   ▼
retrieve()  ── hybrid search (§5.2), scoped by any date filter in the question
   ▼
select()    ── top-k blocks, deduped by date, budgeted to ~6k tokens,
               each carrying its date + blockId
   ▼
buildContext() ── grounded prompt:
               "Answer only from the notes below. Cite dates.
                If the notes do not contain it, say so."
   ▼
AIProvider.complete()
   ▼
answer + citations[{date, blockId}]  → rendered as clickable chips
```

### 6.2 Tool layer (the containment boundary)

The model never sees storage, keys, or a query language. It sees four functions:

| Tool | Signature | Caps |
|---|---|---|
| `searchNotes` | `(query, {from, to, tags, isTask, done, priority})` | ≤ 40 results, snippets only |
| `getNote` | `(date)` | one note, read-only projection |
| `listTasks` | `({from, to, done, priority, classification})` | ≤ 200 tasks |
| `getStats` | `({from, to})` | precomputed aggregates from §7 |

All are read-only, all validate and clamp their arguments, all return shaped
DTOs. Consequences: an injected instruction inside a note can at worst change
what the model *says*, never what it can *reach* or *write* (AD-3).

### 6.3 Provider interface

```js
/** @typedef {Object} AIProvider
 *  @property {(messages, opts) => Promise<{text, usage}>} complete
 *  @property {(texts) => Promise<Float32Array[]>}         embed
 *  @property {{name, needsKey, supportsEmbeddings}}       capabilities
 */
```

- **`local.js` (default, offline).** `complete` is extractive: it ranks retrieved
  blocks and assembles a structured, templated answer — bullet lists of matching
  tasks, counts, dates. Deterministic and honest about being extractive.
  `embed` is a hashed bag-of-words projection, giving weak-but-real semantic
  recall at zero cost.
- **`anthropic.js` (opt-in).** Calls the Claude API with a user-supplied key held
  in workspace settings. Same interface, better prose. Swapping providers is a
  settings change; no calling code moves (AD-4).

### 6.4 Embeddings

Computed lazily per note on idle, stored in `vectorRepo` keyed by date, at note
granularity (not block) to bound storage. Missing embeddings simply mean
keyword-only retrieval for that note — degradation, not failure (AD-5).

### 6.5 In-note assistance

Selection popover actions map to prompt templates over the selected blocks:
Summarize, Rewrite, Convert to task, Extract action items, Meeting summary,
Categorize, Suggest priority, Find related notes.

Output never lands in the note directly. It becomes a `Proposal`:

```
Proposal { kind: 'insert'|'replace'|'annotate', targetBlockId, blocks[] }
```

rendered as a diff strip with Approve / Edit / Reject. Approval is what applies
it (FR-8.2). This is the difference between an assistant and an editor that
overwrites your notebook.

---

## 7. API / service architecture

Services are plain modules with injected dependencies — the same signatures that
would sit behind HTTP if this ever grows a server.

| Service | Operations |
|---|---|
| `AuthService` | `getProfile()`, `signIn(name)`, `signOut()`, `namespace()` |
| `NoteService` | `open(date)`, `save(note)`, `upsertBlock`, `moveBlock`, `insertScaffold`, `datesWithActivity(range)`, `export()`, `import()` |
| `TaskService` | `toggle(date, blockId)`, `setAttrs(date, blockId, attrs)`, `pendingBefore(date)`, `carryForward(tasks, toDate)` |
| `SearchService` | `parseQuery(raw)`, `search(query, filters)`, `reindex(note)`, `suggestTags(prefix)` |
| `AnalyticsService` | `weekly(start)`, `monthly(start)`, `streaks()`, `effortAccuracy(range)` |
| `AIService` | `ask(question, threadId)`, `noteAction(kind, blocks)`, `weeklySummary(start)` |

Conventions: services are stateless apart from caches; all dates are ISO day
strings; all mutations return the new aggregate; errors are typed
(`QuotaError`, `ProviderError`, `ValidationError`) so the UI can respond
specifically rather than showing a generic failure.

`AnalyticsService` computes FR-9 metrics — completion ratio, carry-forward
depth, professional/personal split, estimate-vs-actual, top topics, most
productive day — from the index, with no LLM in the path. The AI panel *phrases*
insights; it does not *compute* them.

---

## 8. Deployment architecture

**Phase A (current)** — frontend only:

```
vite build → dist/  →  any static host
                        └─ browser localStorage (notes, settings)
                        └─ zero network calls at runtime
```

**Phase B** — with the Python backend:

```
        ┌──────────────┐
Browser │ React SPA    │  static assets, same origin
        └──────┬───────┘
               │ /api  (Vite proxies this in dev, nginx in prod)
        ┌──────▼───────┐
        │ FastAPI      │  uvicorn workers
        │  routes      │
        │  services    │
        └──────┬───────┘
               │ SQLAlchemy
        ┌──────▼───────┐        ┌─────────────────┐
        │ Postgres     │        │ Model provider  │
        │  + tsvector  │        │ (key server-    │
        │  + pgvector  │        │  side only)     │
        └──────────────┘        └─────────────────┘
```

- Same origin for SPA and API, so no CORS and no token in a third-party context.
- Docker Compose for local development: web, api, db.
- Migrations with Alembic; the `version` field on the workspace export covers
  user-facing import/export compatibility (FR-10.3).
- The API key lives only in the backend environment — the browser never sees it,
  which is the main security reason the Python tier is worth its cost.

---

## 9. Security considerations

| Risk | Mitigation |
|---|---|
| **Data egress** | Zero network calls after asset load in the default configuration. The Claude provider is opt-in and sends only the retrieved excerpts for one question — never the whole corpus. The settings screen states this plainly before a key is accepted. |
| **API key handling** | Key lives in workspace settings, never in a URL or log, never sent anywhere but the provider endpoint. Browser-held keys are inherently visible to the page, so the UI recommends a scoped/limited key. |
| **Prompt injection from note content** | Retrieved note text is delimited and labeled as untrusted data in the prompt; the model's capabilities are bounded by the four read-only tools (§6.2), so injected instructions cannot reach storage or trigger writes. All AI edits require explicit approval (§6.5). |
| **XSS via note content** | No `innerHTML` on user content. Inline formatting is parsed into a token tree and rendered as React elements. `IMAGE` accepts only `data:` and `https:` URLs; link `href` is scheme-allowlisted (`http`, `https`, `mailto`) and rendered with `rel="noopener noreferrer"`. |
| **Pasted HTML** | Paste is coerced to plain text and re-parsed by the same grammar (FR-2.6); no foreign markup enters the model. |
| **Supply chain** | CDN imports are version-pinned (`react@18.3.1`) and precached by the service worker, so post-install the app does not refetch them. Subresource integrity where the CDN supports it. |
| **Storage quota exhaustion** | Writes are wrapped; `QuotaError` surfaces a banner with export guidance and leaves in-memory state intact so nothing typed is lost. |
| **Local device access** | Local-first means device compromise means data compromise. Acknowledged and stated, not papered over: the local profile is a workspace separator, not a security boundary. Real authentication arrives with `AuthService` swapped for an IdP, at which point the boundary becomes meaningful. |
| **Import of untrusted JSON** | Import validates schema version and shape, rejects unknown block types rather than rendering them, and never evals content. |

---

## 10. Traceability

| Requirement | Where designed |
|---|---|
| FR-1 daily note | §1.2, §4 (`DailyNote`), §7 `NoteService` |
| FR-2 editing | §1.4, §2 (block registry, per-block contenteditable) |
| FR-3 tags | §1.4, §4 (`classification`), §5.1 (tag field) |
| FR-4 tasks | §1.6, §4 (`Task`), §7 `TaskService` |
| FR-5 navigation | §1.1, §2 `Sidebar`/`MonthCalendar` |
| FR-6 search | §5 entire |
| FR-7 AI assistant | §6.1–6.4 |
| FR-8 note assistance | §6.5 |
| FR-9 insights | §7 `AnalyticsService` |
| FR-10 persistence/identity | §4 key layout, §8 |
| NFR-3 search scale | §5.3 |
| NFR-6 privacy | §9 row 1 |
| NFR-7 storage swap | §4, §5.3, `StorageAdapter` |
