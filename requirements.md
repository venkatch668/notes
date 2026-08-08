# Requirements — Personal Work Notebook

## 1. Product statement

A single-workspace daily notebook. The user opens the app, writes everything they
did today into **one note per day**, checks things off, and closes. Months later
they can search or ask the AI assistant what happened.

Anti-goals: multi-project management, boards, Kanban, per-task pages, assignment
workflows, anything that requires setup before writing.

## 2. Actors

| Actor | Description |
|---|---|
| User | Single owner of the workspace. Local-first, one identity per device profile. |
| AI Provider | Pluggable LLM backend. Optional — the app is fully usable without it. |

## 3. Functional requirements

### FR-1 Daily note
- FR-1.1 Exactly one `DailyNote` per calendar date. Created lazily on first write.
- FR-1.2 Opening the app lands on **today's** note with the caret ready in the editor.
- FR-1.3 A note is an ordered list of `NoteBlock`s. No mandatory sections.
- FR-1.4 Optional section scaffold (Morning / Tasks / Meetings / Notes / Ideas /
  Personal / End of Day) insertable in one action, never imposed.

### FR-2 Editing
- FR-2.1 Block types: `TEXT`, `HEADING`, `CHECKBOX`, `BULLET`, `NUMBER`, `TABLE`,
  `CODE`, `IMAGE`, `DIVIDER`. New types must be addable without migration.
- FR-2.2 Inline rich text: bold, italic, code, links, `#tags`.
- FR-2.3 Markdown-style shortcuts convert as you type: `#`, `##`, `###`, `-`, `1.`,
  `[]`, ` ``` `, `---`.
- FR-2.4 `Enter` creates the next block of the same kind; `Backspace` at offset 0
  merges into the previous block; `Tab`/`Shift+Tab` indent within lists.
- FR-2.5 Blocks are reorderable by drag and drop and by `Alt+↑/↓`.
- FR-2.6 Paste of plain text is parsed into blocks by the same rules as FR-2.3.
- FR-2.7 Autosave, debounced, with no explicit save action.

### FR-3 Tags and classification
- FR-3.1 Any `#tag` typed inline is indexed as a tag on that block and note.
- FR-3.2 `#professional` and `#personal` are reserved classification tags rendered
  with distinct colors.
- FR-3.3 A block inherits classification from the nearest preceding heading that
  carries one, unless it declares its own.
- FR-3.4 Tag filter chips in the sidebar filter the current note view and search.

### FR-4 Tasks
- FR-4.1 Any `CHECKBOX` block is a task. No separate task creation flow.
- FR-4.2 Task attributes: `done`, `priority` (high/medium/low), `due`, `estimate`,
  `actual`, `tags`, classification, `reminder`.
- FR-4.3 Attributes are set inline (`!high`, `@tomorrow`, `~2h`, `=45m`) or in a
  detail popover. Inline tokens are stripped from display text and shown as chips.
- FR-4.4 Toggling a task records `completedAt`.
- FR-4.5 Incomplete tasks from previous days are surfaced as *carry-forward*
  candidates on today's note; the user accepts or dismisses. Accepting copies the
  task and links `carriedFrom`.

### FR-5 Navigation
- FR-5.1 Sidebar: Today, Yesterday, This Week, This Month, Calendar.
- FR-5.2 Month calendar with per-day activity dots (0–4) derived from block count
  and completed tasks. Month and year navigation.
- FR-5.3 Clicking any date opens that day's single note.
- FR-5.4 `Ctrl/Cmd+[` and `]` step to previous/next day with content.

### FR-6 Search (first-class)
- FR-6.1 Global search across note text, headings, tasks, tags, dates.
- FR-6.2 Sub-100 ms for 10k notes: inverted index built from a persisted postings
  map, incrementally updated on save, never a full scan.
- FR-6.3 Result rows show date, matched snippet with highlighting, the enclosing
  heading, and block type.
- FR-6.4 Filters: date range, professional/personal, tags, done/pending, priority.
- FR-6.5 Clicking a result opens the note, scrolls to the block, and flashes the match.
- FR-6.6 Query syntax: bare terms, `"phrase"`, `tag:x`, `is:task`, `is:done`,
  `is:pending`, `priority:high`, `before:`/`after:` dates.

### FR-7 AI assistant
- FR-7.1 Optional side panel, hidden by default, opened with `Ctrl/Cmd+J`.
- FR-7.2 Answers questions over history via retrieval-then-generate. The model
  never receives a database handle or query language — only a fixed tool surface
  (`searchNotes`, `getNote`, `listTasks`, `getStats`) returning shaped DTOs.
- FR-7.3 Hybrid retrieval: keyword (BM25-lite) ∪ semantic (embedding cosine),
  reciprocal-rank-fused. Semantic tier is optional and degrades to keyword-only.
- FR-7.4 Every answer cites the dates it drew from; citations are clickable.
- FR-7.5 Provider is swappable behind one interface; a local heuristic provider
  ships as default so the feature works with no API key (deterministic,
  extractive answers rather than generated prose).

### FR-8 AI note assistance
- FR-8.1 Selection actions: Summarize, Rewrite, Convert to task, Extract action
  items, Meeting summary, Categorize, Suggest priority, Find related notes.
- FR-8.2 AI-proposed tasks appear as a **pending diff** the user must approve;
  nothing is written to the note without approval.

### FR-9 Insights
- FR-9.1 Weekly panel: completion ratio, pending, carried-forward counts,
  high-priority completions, professional vs personal split, estimate vs actual,
  top topics, meetings, ideas, most productive day.
- FR-9.2 Computed locally from indexed data; no LLM required.
- FR-9.3 At most six lines of prose. Concise and actionable.

### FR-10 Persistence and identity
- FR-10.1 Local-first storage; the app works fully offline.
- FR-10.2 A lightweight local profile gates the workspace and namespaces storage
  keys; the auth service is an interface so a real IdP can replace it.
- FR-10.3 Export/import the whole workspace as JSON.

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Cold load < 1 s on a warm cache. No build step, no bundler. |
| NFR-2 | Keystroke-to-render < 16 ms with 500 blocks in a note. |
| NFR-3 | Search < 100 ms at 10k notes / ~1M tokens. |
| NFR-4 | Offline-capable PWA, installable, all assets precached. |
| NFR-5 | Every feature reachable by keyboard. Visible focus rings throughout. |
| NFR-6 | Notes never leave the device unless the user configures an AI provider, and then only the retrieved excerpts for that one question. |
| NFR-7 | Storage layer is an interface; swapping localStorage → IndexedDB → server API touches one module. |
| NFR-8 | WCAG AA contrast; semantic landmarks; screen-reader labels on controls. |

## 5. Out of scope (this iteration)

Multi-user collaboration, sharing, server sync, mobile native apps, voice input,
recurring tasks, push reminders. Phase 4 in `design.md` reserves the seams.

## 6. Acceptance criteria for MVP (Phase 1)

1. Open app → today's note, empty, caret in editor, zero clicks to start typing.
2. Type `[] Ship the design doc !high #professional` → renders a task chip row.
3. Reload → content is intact.
4. Click Yesterday → yesterday's note; click Today → back, caret restored.
5. Search "design" → result row with date + highlighted snippet; click → jumps to block.
