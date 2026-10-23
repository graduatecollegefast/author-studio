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

## Phase 4: AI writing partner (complete)
- Retrieval-based memory (`netlify/functions/_shared/context`): every AI request gets a controlled context package with source references and size budgets: the task, the book, its connected series and universes, relevant approved canon, character details by book, timeline events, matching passages from connected books (PostgreSQL full-text search), the chosen style profile, the outline and surrounding scenes, and the author's answered questions. Canon from unrelated universes never enters a request unless the author ticks a crossover universe on the book's Details tab.
- Writing Studio side panel with AI, Story Bible references (characters and places in the scene), notes, continuity warnings for the scene, and history.
- All 17 AI writing commands. Every result is a proposal with Accept, Reject, Regenerate and Edit Before Inserting. Selected text is replaced only on Accept, only if it is unchanged, and only after a checkpoint of the earlier text. Drafted scenes and chapters are added as new scenes or chapters after the current one, never over existing text.
- Three AI modes per book: Writing Assistant (no whole-scene drafting), Collaborative Co-Writer (drafts from the author's direction), Full Creative Partner.
- Full Creative Partner: a resumable job that analyzes the concept and connected canon, asks questions, writes a premise, character arcs, an outline and scene plans for the author to edit and approve, then drafts one scene at a time, saving each before the next, and finishes with a continuity check. Pause, stop, resume, edit the plan, and mark scenes for redraft (the earlier draft stays in version history). Spending limits apply throughout.
- Intelligent questions: stored per book, never asked twice. Answer, skip, save for later, let the AI decide (stored as a provisional decision, not canon), view possible options, confirm a decision, or add it to canon.
- Writing style profiles at author, pen name, series and book level: Analyze My Voice and Update Writing Profile learn from samples of the author's chapters and store descriptions only (long quotations are removed). Edit Style Preferences, Compare Styles, and Use This Style for Drafting.
- Ideas Vault: title, description, category, tags, characters, related book, series and universe, status and date. AI suggests connections to existing projects; ideas turn into a new book, character, plot thread or scene.
- Declined requests explain the limit and are never sent to another provider.

## Phase 5: Editorial Studio and exports (complete)
- Editorial Studio: Developmental, Line Editing, Copyediting, Dialogue, Continuity and Reader Perspective reviews of the whole book or chosen chapters, with a cost estimate first, progress, stop and resume, and the same spending limits as other AI work.
- Every finding shows the exact passage it is about, its chapter and scene, severity, category, what the issue is and why the change helps. Findings whose passage is not word for word in the chapter are dropped. A finding is never shown twice.
- Suggested revisions are approved, edited then approved, or rejected one at a time. Approving replaces only that passage inside its paragraph, keeps the surrounding bold and italic, saves the scene before the change as a "Before editorial revision" version, and saves the result as a new revision. If the passage changed since the review, nothing is applied. The whole manuscript is never replaced.
- Exports in DOCX, EPUB, PDF (6 x 9 inch, embedded Newsreader font), TXT and Markdown: complete manuscript, chosen chapters, book outline, character profiles, Character Bible, World Bible, series overview, story timeline and project notes. Chapter order and titles, paragraphs, scene breaks, bold and italic are kept.
- Download history: every export is kept in a private storage folder to download again or remove.
- Complete project backup: one ZIP with every table of the author's work (books, chapters, scenes, versions, Story Bible, timelines, relationships, ideas, notes, reviews, settings) plus uploaded manuscripts and covers. Restore adds the whole backup as a copy with new ids and its files; it never replaces or removes anything, and a failed restore removes what it added.
- Account deletion in Settings: typed confirmation, removes stored files, then the account and everything it owns.

## Series review (AI Writing Partner)
- AI Writing Partner > Series review compares a book with the books before it in its series (by reading order).
- Free: lists the characters from earlier books who appear in this book (by name, alias or nickname), how often, and whether they are linked to this book; links them in one click; flags duplicate character records; shows how many discoveries in earlier books still wait for review.
- AI: for each chosen character, their profile, approved canon and passages from the earlier books are compared with every passage that mentions them now; then each chapter is compared with the earlier passages that share its names and places. Each finding quotes both books word for word (anything that cannot be found is dropped), is saved as a continuity finding, and appears here, in the Continuity Checker and in the Editorial Studio. Nothing in the books, canon or profiles changes. Resumable, with an estimate first and the usual spending limits.

## Phase 6
As defined in the specification: find and replace, drag-and-drop reordering, resizable panels, polish, audits, and full test coverage.
