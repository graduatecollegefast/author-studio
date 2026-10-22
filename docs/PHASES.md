# Phases

## Phase 1: Functional foundation (complete)
Acceptance: log in, create a book, upload a manuscript, open a chapter, edit text, refresh, and find the work saved. Verified by `e2e/phase1.spec.ts`.

Navigation shows later-phase sections greyed out with their phase number; they become links when built.

### Known limitations
- Uploaded files are stored and verified but not yet read: text extraction, chapter splitting, and import into the editor arrive in Phase 2 (extraction and analysis statuses show "Not Started").
- Find and replace, drag-and-drop reordering, resizable panels, and selected-text AI actions are later phases (reordering uses up/down controls now).
- Display preferences (theme, text size) are stored per device.

## Phase 2: Manuscript intelligence (next)
Extraction for DOCX/PDF/EPUB/TXT/MD with OCR warning for scanned PDFs, chunking into `document_chunks`, resumable background analysis jobs (`ai_tasks` with idempotency keys), Claude/OpenAI adapters with usage and spend tracking, discoveries with evidence into `canon_facts`/`fact_sources`, review and bulk approval, Character Bible and World Bible screens.

## Phase 3 to 6
As defined in the specification: series and universes, relationships, timelines, continuity; AI creative partner and writing modes; editorial studio and exports; polish, audits, and full test coverage.
