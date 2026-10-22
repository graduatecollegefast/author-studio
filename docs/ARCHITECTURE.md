# Architecture

## Layers
- `src/pages`: route screens. `src/components`: UI by area (layout, library, editor, ui). `src/services`: all Supabase calls. `src/hooks/queries.ts`: TanStack Query keys and hooks. `src/lib`: framework-free logic (autosave, validation, schemas).
- `netlify/functions`: server endpoints. `_shared/auth.ts` verifies the Supabase access token and returns a client that acts as that user, so RLS applies to server code too. No service role key is used.
- `supabase/migrations`: schema, RLS, storage, and database functions.

## Data model
All 33 tables from the spec exist now (plus `relationship_group_members`, `story_event_characters`, `idea_characters` junctions), so later phases add features, not schema rewrites. Highlights:
- Every author row has `owner_id`. Children reference parents through composite `(id, owner_id)` foreign keys, so a row can never point at another author's parent even though FK checks bypass RLS. `owner_id` cannot change after insert.
- Books link to series and universes through junction tables (`series_books`, `book_universes`).
- Manuscript text lives in `scenes.content` (TipTap JSON) with `content_text` for search and word counts. A chapter always has at least one scene.
- `canon_facts` + `fact_sources` carry statement type (narrator, rumor, dream, AI inference...), confidence, review status, validity period, and supersession, ready for Phase 2.

## Saving manuscripts safely
1. The editor sends changes through `AutosaveController` (1.2 s debounce, one request at a time, exponential retry).
2. `save_scene(scene, content, text, expected_revision)` updates only if the revision matches, otherwise returns HTTP 409 (`REVISION_CONFLICT`). The UI then asks which version to keep and checkpoints the other.
3. A trigger snapshots the previous text into `scene_versions` before it is overwritten (throttled to one automatic snapshot per scene per 10 minutes). Checkpoints and restores add their own versions. Restore preserves the current text first.
4. Unsaved edits are mirrored to a per-scene browser recovery buffer and offered back after a crash. Supabase remains the source of truth.

## Uploads
Browser validation, then a `pending` record, then direct upload to `manuscripts/<user>/<book>/<file>`, then `manuscript-verify` reads the first 4 KB with a range request, checks size and file signature, and marks the record `validated` or `rejected` (rejected bytes are deleted). Buckets enforce size and MIME limits; storage policies restrict each author to their own folder.
