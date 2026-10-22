# Author Studio AI

A private writing, manuscript management, and story universe platform for one author (multi-author ready).

**Status: Phase 1 (Functional Foundation) complete and verified.** See `docs/PHASES.md` for what is built and what comes next.

## Stack
React 19, TypeScript, Vite, Tailwind CSS 4, shadcn-style components (Radix), React Router 7, TanStack Query, Zod, TipTap 3.
Supabase (Postgres, Auth, private Storage, row-level security). Netlify (hosting + Functions).

## Phase 1 features
- Email/password sign-in, password reset, protected routes, persistent sessions, sign out, account settings. Public sign-up is off unless `VITE_ALLOW_SIGNUP=true`.
- Dashboard with live Supabase data: continue writing, active manuscripts, recently opened, recent uploads, word totals.
- My Library: grid/list, search, filter, sort, create, edit metadata, cover upload, archive/restore, permanent delete with typed confirmation.
- Manuscript uploads (DOCX, PDF, EPUB, TXT, MD, up to 100 MB, multiple at once) to a private bucket, with server-side signature checks, version numbering, and a "current manuscript" marker.
- Chapters and scenes: add, rename, reorder, delete.
- Writing Studio: TipTap editor with bold, italic, headings, quotes, scene breaks, undo/redo, live word counts, focus mode, full screen, dark/light writing surface.
- Autosave: debounced, single-flight, retries with backoff, conflict detection across windows, crash-recovery buffer, unsaved-changes warning, Ctrl+S.
- Version history: automatic snapshots (at most every 10 minutes), manual checkpoints, preview, restore (current text is preserved first).
- Accessibility: keyboard navigation, focus rings, labelled controls, text size, high contrast, reduced motion.

## Quick start
```bash
npm install
cp .env.example .env.local      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev:functions &         # local Netlify Functions on :8888 (or use `netlify dev`)
npm run dev                     # http://localhost:5173
```
Full setup (Supabase, GitHub, Netlify): `docs/SETUP.md`. Tests: `docs/TESTING.md`.

## Scripts
| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run dev:functions` | Run Netlify Functions locally |
| `npm run build` | Typecheck and production build |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | Database, RLS, and storage integration tests (needs a Supabase) |
| `npm run test:e2e` | Browser acceptance tests (Playwright, needs a Supabase) |
