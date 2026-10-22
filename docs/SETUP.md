# Setup and deployment

## 1. Supabase
1. Create a project at supabase.com (free tier works).
2. Apply migrations, in order, from `supabase/migrations/`:
   - With the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`, or
   - Paste each file into the SQL Editor and run it, oldest first.
   This creates every table, row-level security policy, the private `manuscripts` and `covers` buckets, and their storage policies.
3. Authentication settings (Dashboard > Authentication):
   - Sign In / Providers > Email: enabled.
   - **Turn off "Allow new users to sign up"** so the app stays private.
   - URL Configuration: Site URL = your Netlify URL; add `https://<your-site>.netlify.app/reset-password` and `http://localhost:5173/reset-password` to Redirect URLs.
4. Create your account: Authentication > Users > Add user (email + password, auto confirm).
5. Copy Project URL and the anon / publishable key from Project Settings > API.

## 2. Local environment
`.env.local` (never committed):
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
```
The service role key is not used in Phase 1. Do not put it in any `VITE_` variable.

## 3. GitHub
Create an empty **private** repository, then:
```bash
git remote add origin git@github.com:<owner>/author-studio.git
git push -u origin main
```

## 4. Netlify
1. Add new site > Import from Git > select the repository.
2. Build settings come from `netlify.toml` (build `npm run build`, publish `dist`, functions `netlify/functions`).
3. Site settings > Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (functions read these as a fallback; you may also set `SUPABASE_URL` and `SUPABASE_ANON_KEY`).
4. Deploy. Then add the site URL to Supabase Auth (step 1.3).

## 5. Verify the live app
1. Visit the site: you land on the sign-in page.
2. Sign in, create a book, upload a `.txt` manuscript: it should show **Validated** (this proves the Netlify Function and storage work).
3. Add a chapter, write, wait for "Saved", refresh: your text is still there.
4. Forgot password: the email link should land on `/reset-password`.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| "Supabase is not configured" on login | `VITE_` variables missing at build time. Set them in Netlify and redeploy. |
| Upload stays "Uploaded" with a verification error | Function cannot reach Supabase. Check `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set for the Functions scope. |
| 404 on refresh of a deep link | `netlify.toml` SPA redirect missing from the deploy. |
| Password reset link goes to the wrong site | Update Site URL and Redirect URLs in Supabase Auth. |
| "permission denied" errors | Migrations not fully applied. Re-run them in order. |
