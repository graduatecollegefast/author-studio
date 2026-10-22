# Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Unit | `npm test` | Autosave controller (debounce, single flight, retry, conflict, flush), file validation and signature checks, filename sanitizing, form schemas, library filtering, the upload verification function |
| Database / RLS | `npm run test:db` | Profiles, anon lockout, cross-author isolation (read/update/delete/insert), owner spoofing, owner_id immutability, chapter creation, save with revision check, word-count rollups, automatic snapshots, checkpoints, restore, scene ordering, private storage folders, bucket MIME limits, cascading delete |
| End to end | `npm run test:e2e` | The Phase 1 acceptance flow in a real browser, archive/restore/delete, autosave failure and crash recovery |

The database and browser suites need a Supabase instance and create throwaway users. **Never run them against production.** Set:
```
SUPABASE_URL=...  SUPABASE_ANON_KEY=...  SUPABASE_SERVICE_ROLE_KEY=...
```

## Local Supabase
- With Docker: `supabase start` (Supabase CLI), then `supabase db reset` to apply migrations.
- Without Docker: `scripts/local-stack/start.sh --reset` runs Postgres, GoTrue, PostgREST, and the Storage API from their open-source builds (set `AUTH_BIN`, `POSTGREST_BIN`, `STORAGE_SRC`). Keys are written to `.local-stack/keys.env`.

Accessibility: `e2e/design.spec.ts` runs axe (WCAG 2.0/2.1 A and AA) on every page in dark and light themes and on the Writing Studio in all three modes, and fails on contrast that axe cannot verify. `src/styles/tokens.test.ts` checks every declared color pair against WCAG ratios (manuscript text at 7:1).

## Last verified run (Design system + Phase 2A)
Fresh database built from all 6 migrations, then: typecheck pass, 145/145 unit, 19/19 database/RLS, 8/8 end to end (including accessibility), production build pass.
