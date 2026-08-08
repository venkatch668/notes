# Work Notebook — frontend

React + TypeScript + Bootstrap 5 (Vite). OneNote-style UI over a one-note-per-day
workflow. Installable PWA, deployed to GitHub Pages.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/
npm run typecheck
```

## Where things are

| Path | What |
|---|---|
| `src/api/types.ts` | `WorkspaceApi` — the seam the Python backend will implement |
| `src/api/localApi.ts` | localStorage implementation used today |
| `src/domain/` | Pure logic: typing grammar, tokens, dates. No I/O. |
| `src/components/` | OneNote chrome, panes, editor, search, AI, insights |
| `src/styles/tokens.css` | Every color and metric in the UI |
| `src/styles/bootstrap-theme.css` | Bootstrap's variables retuned to the OneNote palette |
| `src/pwa.ts` | Service worker registration (defers updates until the tab is idle) |
| `public/` | PWA icons and favicon |

## Styling layers

Loaded in this order, each winning over the last:

1. `bootstrap.min.css` — Reboot, grid, utilities, forms, buttons, badges
2. `bootstrap-theme.css` — Bootstrap's `--bs-*` variables set to OneNote values
3. `app.css` — the OneNote chrome itself (title bar, ribbon, panes, canvas, blocks)

Bootstrap supplies the plumbing; the distinctive OneNote surfaces stay custom.
That split is what keeps it from looking like a generic Bootstrap app.

## PWA / deploy

`npm run build` emits `dist/` with a generated service worker. The production
base path is `/notes/` (GitHub Pages); override with `BASE_PATH=/ npm run build`
for a root domain. Pushing to `main` deploys via `.github/workflows/deploy.yml`.

## Backend

Not built yet. When it lands, add `src/api/httpApi.ts` implementing
`WorkspaceApi` and swap the export in `localApi.ts`'s consumers — nothing else
changes. See `../architecture.md` §2.

## Keyboard

`Ctrl K` search · `Ctrl J` assistant · `Ctrl [` / `Ctrl ]` previous / next day
`#` heading · `-` bullet · `1.` numbered · `[]` task · ` ``` ` code · `---` divider
`!high` priority · `@tomorrow` due · `~2h` estimate · `=45m` actual · `#tag`
`Alt+↑/↓` move block · `Tab` indent
