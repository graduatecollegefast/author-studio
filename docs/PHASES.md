# Phases

## Phase 1: Functional foundation (complete)
Acceptance: log in, create a book, upload a manuscript, open a chapter, edit text, refresh, and find the work saved. Verified by `e2e/phase1.spec.ts`.

Navigation shows later-phase sections greyed out with their phase number; they become links when built.

### Known limitations
- Uploaded files are stored and verified but not yet read: text extraction, chapter splitting, and import into the editor arrive in Phase 2 (extraction and analysis statuses show "Not Started").
- Find and replace, drag-and-drop reordering, resizable panels, and selected-text AI actions are later phases (reordering uses up/down controls now).
- Display preferences (theme, text size) are stored per device.

## Design system: Creative Flow (complete)
Palette, semantic color roles, three writing modes, typography controls, daily goal and session counter. See docs/DESIGN.md.

## Phase 2: Manuscript intelligence (in progress)

### 2A: Reading manuscripts (complete)
- Text extraction for DOCX, PDF, EPUB, TXT and Markdown in a Netlify Background Function, started automatically after upload verification. Progress on the file record and an `ai_tasks` job row; safe to re-run.
- Chapter detection (headings and lines like "Chapter Twelve", "Prologue", "Part Two"), scene breaks ("* * *", "#", rules), bold and italic kept.
- PDF: paragraph reconstruction, running headers and page numbers removed, hyphenated line breaks joined. Scanned PDFs are marked **Needs OCR** and never imported as empty text.
- EPUB: reads the spine, skips navigation, scripts and styles, refuses archives that expand past 300 MB.
- Searchable `document_chunks` (about 6,000 characters each, on paragraph boundaries) with exact character offsets and chapter labels for cited analysis.
- Preview and import: choose chapters, import after existing chapters as editable scenes. Imports do not count toward daily word goals.
- Print-layout cleanup (books exported from a PDF or print file): running headers and footers with the title or author name, page numbers, paragraphs split across pages, line-end hyphenation turned into spaces, drop caps whose first line sits in a text box. The Word reader reads the document directly, including text boxes and tables, and never reads header or footer parts. Title page, copyright and "Also by" pages are flagged as front matter and not imported unless chosen.
- Re-importing a file can replace the chapters it imported before; chapters edited since are always kept.

### 2B: AI analysis (next, needs an AI provider key)
Extraction for DOCX/PDF/EPUB/TXT/MD with OCR warning for scanned PDFs, chunking into `document_chunks`, resumable background analysis jobs (`ai_tasks` with idempotency keys), Claude/OpenAI adapters with usage and spend tracking, discoveries with evidence into `canon_facts`/`fact_sources`, review and bulk approval, Character Bible and World Bible screens.

## Phase 3 to 6
As defined in the specification: series and universes, relationships, timelines, continuity; AI creative partner and writing modes; editorial studio and exports; polish, audits, and full test coverage.
