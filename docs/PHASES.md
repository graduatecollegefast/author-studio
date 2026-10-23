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

## Phase 2: Manuscript intelligence (complete)

### 2A: Reading manuscripts (complete)
- Text extraction for DOCX, PDF, EPUB, TXT and Markdown in a Netlify Background Function, started automatically after upload verification. Progress on the file record and an `ai_tasks` job row; safe to re-run.
- Chapter detection (headings and lines like "Chapter Twelve", "Prologue", "Part Two"), scene breaks ("* * *", "#", rules), bold and italic kept.
- PDF: paragraph reconstruction, running headers and page numbers removed, hyphenated line breaks joined. Scanned PDFs are marked **Needs OCR** and never imported as empty text.
- EPUB: reads the spine, skips navigation, scripts and styles, refuses archives that expand past 300 MB.
- Searchable `document_chunks` (about 6,000 characters each, on paragraph boundaries) with exact character offsets and chapter labels for cited analysis.
- Preview and import: choose chapters, import after existing chapters. Each chapter comes in whole; scene breaks stay in the text as divider lines. Imports do not count toward daily word goals.
- Print-layout cleanup (books exported from a PDF or print file): running headers and footers with the title or author name, page numbers, paragraphs split across pages, line-end hyphenation turned into spaces, drop caps whose first line sits in a text box. The Word reader reads the document directly, including text boxes and tables, and never reads header or footer parts. Title page, copyright and "Also by" pages are flagged as front matter and not imported unless chosen.
- Re-importing a file can replace the chapters it imported before; chapters edited since are always kept.

### 2B: AI analysis (complete)
- Provider layer (`netlify/functions/_shared/ai`): Claude Messages API and OpenAI Responses API adapters behind one interface (structured JSON output, retries with backoff for rate limits and overload, truncation retry, declines reported and never rerouted to another provider). Keys come only from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in Netlify environment variables.
- Model catalog and list prices in `src/lib/ai/catalog.ts` (verified 2026-10-22). Routing per task type: an economy model reads passages, a standard model does the whole-book analysis; both changeable in Settings.
- Spending controls: daily, monthly and per-job limits (Settings). An estimate is shown before a job; jobs that would pass a limit do not start, running jobs pause before passing one. Every call, including declined ones, is recorded in `ai_usage` with tokens and cost. Usage dashboard in Settings.
- Analyze Book (book page, AI analysis tab): a resumable background job over the file's searchable passages. Each passage is analyzed once; the job survives the 15 minute function limit by handing off to a new run, and can be stopped, resumed, or restarted.
- Discoveries: characters, relationships, world elements, timeline events per passage; plot, themes, style and series opportunities for the whole book. Each carries entity, value, statement type (narrator, character statement, belief, rumor, dream, flashback, AI inference, AI suggestion), confidence, the source file, location and a verbatim excerpt. Excerpts are checked against the text and items whose quotes cannot be found are dropped. The model can never mark anything author confirmed.
- Review: approve, reject, or edit then approve; bulk approval of high-confidence items (85% or more, never rumors, dreams, beliefs or AI suggestions). Approval files facts into the Story Bible: characters (matched by name, alias or first name), a dated state per book that never overwrites earlier canon, relationships, world elements linked to the book, timeline events, and book themes.
- Character Bible and World Bible screens: list, search, create, edit every profile field, custom fields, approved canon with its quotes, history over time, relationships, connected books.
- Prompt injection defenses: manuscript text is wrapped and labeled as data, its closing tag is neutralized, and model output is schema-validated and evidence-checked before it is saved.

## Phase 3: Story world (complete)
- Series & Universes: create, edit and delete series and universes. Books join series through a junction table, so a book can belong to several series. Each series keeps reading, chronological and publication order separately (reorder with the arrows). Planned and current book counts, genre, status, universe, description and notes.
- Universes hold series and standalone books, and show the shared characters, important places, organizations, world rules and major historical events across all of them, with a link to the master timeline.
- Series- and universe-wide plot threads, story arcs, unresolved mysteries and future book ideas, each with open/resolved status and the books where it opens and resolves.
- Relationship Map: choose a character to see a map of everyone connected to them, plus an accessible list. Pair relationships in every category (romantic, sexual, married, former partner, family, friendship, professional, rivalry, conflict, mentorship, custom) with current and past status, start and end periods and books, relevant books and timeline events, important changes, notes, and the approved quotes behind them. Group relationships (a triad, a household, a found family) with member roles, never forced into pairs.
- Story Timelines: universe, series, book, character and relationship timelines through filters, plus event type. Events take an exact date, an approximate date, a relative position or an unknown date, with start and end, location, characters, book and chapter, related relationships, flashback flag and reliability (confirmed, uncertain, unreliable narration). Story order and reveal order are separate views.
- Continuity Checker: a free check of approved canon against itself (birthday, eye color, skin tone, height that differ; two ages in one book), then an AI check of each chapter against the approved canon of every book in its series and universe. Only canon about the people, places and events a chapter mentions is sent, so chapters that mention nothing in canon are skipped at no cost. Each finding has an ID, book, chapter, scene, category, severity (critical, warning, suggestion), description, the established evidence with its source, the conflicting quote with its location, and a suggested fix. Findings whose quote is not in the chapter or whose canon reference does not exist are dropped. Actions: view evidence, accept suggested fix, mark intentional, dismiss, save for later, reopen, and open the scene. Nothing ever edits canon or manuscript text, and a finding you have reviewed is never shown again by a later check. Resumable, with an estimate before it starts and the same spending limits as analysis.

## Phase 4 to 6
As defined in the specification: AI creative partner and writing modes, writing style profile, intelligent questions, ideas vault; editorial studio and exports; polish, audits, and full test coverage.
