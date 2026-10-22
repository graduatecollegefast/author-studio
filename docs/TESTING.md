# Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Unit | `npm test` | AI adapters (request shape, refusals, truncation, rate limits), evidence matching, discovery mapping, schema strictness, pricing, routing, spending limits, manuscript extraction and cleanup, autosave controller (debounce, single flight, retry, conflict, flush), file validation and signature checks, filename sanitizing, form schemas, library filtering, the upload verification function |
| Database / RLS | `npm run test:db` | Profiles, anon lockout, cross-author isolation (read/update/delete/insert), owner spoofing, owner_id immutability, chapter creation, save with revision check, word-count rollups, automatic snapshots, checkpoints, restore, scene ordering, private storage folders, bucket MIME limits, cascading delete, discovery saving and dedupe, cross-author isolation of discoveries, approval into characters, dated character history, relationships, world elements and events, append-only usage |
| End to end | `npm run test:e2e` | The Phase 1 acceptance flow in a real browser, archive/restore/delete, autosave failure and crash recovery, manuscript import, AI analysis with the offline test model (estimate, run, declined passage, dropped invented quotes, review, bulk approval, Character and World Bible, spending limit block) |

The database and browser suites need a Supabase instance and create throwaway users. **Never run them against production.** Set:
```
SUPABASE_URL=...  SUPABASE_ANON_KEY=...  SUPABASE_SERVICE_ROLE_KEY=...
```

## Local Supabase
- With Docker: `supabase start` (Supabase CLI), then `supabase db reset` to apply migrations.
- Without Docker: `scripts/local-stack/start.sh --reset` runs Postgres, GoTrue, PostgREST, and the Storage API from their open-source builds (set `AUTH_BIN`, `POSTGREST_BIN`, `STORAGE_SRC`). Keys are written to `.local-stack/keys.env`.

Accessibility: `e2e/design.spec.ts` runs axe (WCAG 2.0/2.1 A and AA) on every page in dark and light themes and on the Writing Studio in all three modes, and fails on contrast that axe cannot verify. `src/styles/tokens.test.ts` checks every declared color pair against WCAG ratios (manuscript text at 7:1).

## Last verified run (Phase 2 complete)
Fresh database built from all 8 migrations, then: typecheck pass, 165/165 unit, 20/20 database/RLS, 10/10 end to end (including accessibility on the new pages), production build pass.

The end to end suite starts the functions server with `AI_MOCK=1`, so no provider key or spending is needed.
