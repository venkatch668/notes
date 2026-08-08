# Work Notebook

A OneNote-style personal work notebook. One note per day: open it, capture
everything you do, check things off, and search it years later.

**Live:** https://venkatch668.github.io/notes/

## Repository

| Path | What |
|---|---|
| `frontend/` | The application — React + TypeScript + Vite + Bootstrap 5. Installable PWA. |
| `requirements.md` | What the product must do (FR/NFR, MVP acceptance criteria). |
| `architecture.md` | Stack decision, layering, modules, key decisions, phasing. |
| `design.md` | UX, components, data model, search, AI/RAG, services, deployment, security. |
| `legacy-pwa/` | The superseded prototype. Safe to delete. |

## Run it

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

## Deploy

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable it once under
**Settings → Pages → Source → GitHub Actions**.

## Status

The UI is complete and runs against a localStorage implementation of the
`WorkspaceApi` interface. The Python (FastAPI + Postgres) backend is the next
phase and slots in behind that same interface — see `architecture.md` §2.
