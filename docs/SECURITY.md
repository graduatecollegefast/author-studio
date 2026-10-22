# Security and privacy

- Private repository, HTTPS (Netlify), Supabase Auth, RLS on every author table, `anon` has no table access.
- Private storage buckets with per-user folder policies; files are served only through short-lived signed URLs.
- Netlify Functions verify the session token and query as the user. Owner IDs from the browser are never trusted.
- Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_ALLOW_SIGNUP` reach the browser. AI keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) live only in Netlify environment variables and are never stored in the database or sent to the browser. The `ai-status` function reports only whether a provider is configured.
- Function errors are logged without request bodies, so manuscript text is not written to logs. No analytics or third-party scripts; fonts are self-hosted.
- Security headers in `netlify.toml` (no framing, no sniffing, no indexing).
- Deleting a book removes its database rows and stored files.

## AI providers
- Manuscript passages are sent to the provider you configure (Anthropic or OpenAI) only when you start an analysis. Nothing is sent in the background otherwise.
- Requests go from Netlify Functions straight to the provider's API. No training opt-in is enabled by this app. OpenAI requests set `store: false`.
- Each provider's own terms govern retention and use of API data; read them before analyzing private work: Anthropic (https://www.anthropic.com/legal/commercial-terms, https://privacy.anthropic.com) and OpenAI (https://openai.com/policies/business-terms, https://platform.openai.com/docs/guides/your-data). This app makes no promise of zero retention.
- Manuscript text is never written to function logs; errors are logged by type and a short provider message only.
- Mature content: a provider may decline a passage under its own policy. The passage is marked declined, the rest of the book continues, and the request is never resent to a different provider.
- `AI_MOCK=1` switches the server to an offline test model for automated tests. Never set it on the live site.

## Not yet in place
- Account-level deletion and full backup/restore: Phase 5.
- The function rate limit is per instance (best effort), not a global quota.
- Supabase manages encryption at rest and its own backups per your plan; this app adds no extra guarantees beyond that.
