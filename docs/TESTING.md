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

## Last verified run (Phase 1)
Fresh database built from the migrations, then: typecheck pass, 28/28 unit, 17/17 database/RLS, 3/3 end to end, production build pass.
