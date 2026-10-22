# Security and privacy

- Private repository, HTTPS (Netlify), Supabase Auth, RLS on every author table, `anon` has no table access.
- Private storage buckets with per-user folder policies; files are served only through short-lived signed URLs.
- Netlify Functions verify the session token and query as the user. Owner IDs from the browser are never trusted.
- Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_ALLOW_SIGNUP` reach the browser. AI keys (Phase 2+) will live only in Netlify environment variables.
- Function errors are logged without request bodies, so manuscript text is not written to logs. No analytics or third-party scripts; fonts are self-hosted.
- Security headers in `netlify.toml` (no framing, no sniffing, no indexing).
- Deleting a book removes its database rows and stored files.

## Not yet in place
- Account-level deletion and full backup/restore: Phase 5.
- AI provider data handling notes: written when providers are added in Phase 2, based on each provider's current published policy.
- The function rate limit is per instance (best effort), not a global quota.
- Supabase manages encryption at rest and its own backups per your plan; this app adds no extra guarantees beyond that.
