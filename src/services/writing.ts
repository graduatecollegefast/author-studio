import { supabase } from '@/lib/supabase/client'
import type { InsertMode } from '@/lib/ai/commands'
import { logActivity } from './books'
import { AppError, throwIfError } from './errors'

async function callFunction(name: string, body: unknown): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new AppError('You are signed out. Sign in again to continue.')
  let res: Response
  try {
    res = await fetch(`/.netlify/functions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AppError('Could not reach the server. Check your connection.')
  }
  if (res.ok || res.status === 202) return
  const out = (await res.json().catch(() => ({}))) as { error?: string }
  throw new AppError(out.error ?? 'The server could not complete the request.')
}

// ---------------------------------------------------------------------------
// Writing Studio proposals
// ---------------------------------------------------------------------------
export interface Proposal {
  id: string
  scene_id: string
  book_id: string
  command: string
  instruction: string | null
  original_text: string
  proposed_text: string
  insert_mode: InsertMode
  selection_from: number | null
  selection_to: number | null
  status: 'generating' | 'pending' | 'accepted' | 'rejected' | 'edited' | 'failed'
  notes: string | null
  error: string | null
  model: string | null
  base_revision: number
  created_at: string
}

const PROPOSAL_COLUMNS =
  'id, scene_id, book_id, command, instruction, original_text, proposed_text, insert_mode, selection_from, selection_to, status, notes, error, model, base_revision, created_at'

export async function requestProposal(o: {
  bookId: string
  sceneId: string
  revision: number
  command: string
  insertMode: InsertMode
  instruction: string
  selection: { from: number; to: number; text: string } | null
}): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await supabase.from('revision_proposals').insert({
    id,
    book_id: o.bookId,
    scene_id: o.sceneId,
    base_revision: o.revision,
    command: o.command,
    insert_mode: o.insertMode,
    instruction: o.instruction.trim() || null,
    original_text: o.selection?.text ?? '',
    selection_from: o.selection?.from ?? null,
    selection_to: o.selection?.to ?? null,
    status: 'generating',
  })
  throwIfError(error)
  await callFunction('ai-write-background', { proposalId: id })
  return id
}

export async function getProposal(id: string): Promise<Proposal> {
  const { data, error } = await supabase.from('revision_proposals').select(PROPOSAL_COLUMNS).eq('id', id).single()
  throwIfError(error)
  return data as Proposal
}

export async function recentProposals(sceneId: string): Promise<Proposal[]> {
  const { data, error } = await supabase
    .from('revision_proposals')
    .select(PROPOSAL_COLUMNS)
    .eq('scene_id', sceneId)
    .in('status', ['generating', 'pending', 'failed'])
    .order('created_at', { ascending: false })
    .limit(10)
  throwIfError(error)
  return (data ?? []) as Proposal[]
}

export async function closeProposal(id: string, status: 'accepted' | 'rejected' | 'edited', finalText?: string) {
  const { error } = await supabase
    .from('revision_proposals')
    .update({ status, ...(finalText !== undefined ? { proposed_text: finalText } : {}) })
    .eq('id', id)
  throwIfError(error)
}

/** New scenes or a new chapter from an accepted draft, placed after the current scene or chapter. */
export async function insertDraft(o: {
  bookId: string
  scenes: Array<{ title: string; content: unknown; text: string }>
  afterSceneId?: string | null
  afterChapterId?: string | null
  chapterTitle?: string | null
}): Promise<{ chapter_id: string; scene_ids: string[] }> {
  const { data, error } = await supabase.rpc('insert_drafted_scenes', {
    p_book_id: o.bookId,
    p_scenes: o.scenes,
    p_after_scene_id: o.afterSceneId ?? null,
    p_after_chapter_id: o.afterChapterId ?? null,
    p_chapter_title: o.chapterTitle ?? null,
  })
  throwIfError(error)
  return data as { chapter_id: string; scene_ids: string[] }
}

// ---------------------------------------------------------------------------
// Small AI jobs
// ---------------------------------------------------------------------------
export type AssistKind = 'decide_question' | 'question_options' | 'idea_links' | 'analyze_style'

export async function startAssist(kind: AssistKind, id: string) {
  await callFunction('ai-assist-background', { kind, id })
}

export async function assistStatus(kind: AssistKind, id: string): Promise<{ status: string; error: string | null } | null> {
  const { data, error } = await supabase.from('ai_tasks').select('status, error').eq('idempotency_key', `assist:${kind}:${id}`).maybeSingle()
  throwIfError(error)
  return data as { status: string; error: string | null } | null
}

/** Start a small job and wait for it to finish (polls its task row). */
export async function runAssistAndWait(kind: AssistKind, id: string, timeoutMs = 180_000): Promise<void> {
  await startAssist(kind, id)
  const until = Date.now() + timeoutMs
  for (;;) {
    const s = await assistStatus(kind, id)
    if (s?.status === 'completed') return
    if (s?.status === 'failed') throw new AppError(s.error ?? 'The AI could not finish.')
    if (Date.now() > until) throw new AppError('This is taking longer than expected. Check back in a minute.')
    await new Promise((r) => setTimeout(r, 1500))
  }
}

// ---------------------------------------------------------------------------
// Clarification questions
// ---------------------------------------------------------------------------
export interface Question {
  id: string
  book_id: string | null
  ai_task_id: string | null
  question: string
  context: string | null
  options: string[]
  status: 'open' | 'answered' | 'skipped' | 'saved_for_later' | 'ai_decided'
  answer: string | null
  reasoning: string | null
  is_provisional: boolean
  answered_by: 'author' | 'ai' | null
  created_at: string
}

export async function listQuestions(bookId?: string): Promise<Question[]> {
  let q = supabase
    .from('clarification_questions')
    .select('id, book_id, ai_task_id, question, context, options, status, answer, reasoning, is_provisional, answered_by, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (bookId) q = q.eq('book_id', bookId)
  const { data, error } = await q
  throwIfError(error)
  return (data ?? []) as Question[]
}

export async function answerQuestion(id: string, answer: string, option?: string) {
  const { error } = await supabase
    .from('clarification_questions')
    .update({ status: 'answered', answer: answer.trim(), chosen_option: option ?? null, answered_by: 'author', is_provisional: false, answered_at: new Date().toISOString() })
    .eq('id', id)
  throwIfError(error)
}

export async function setQuestionStatus(id: string, status: 'open' | 'skipped' | 'saved_for_later') {
  const { error } = await supabase
    .from('clarification_questions')
    .update({ status, ...(status === 'open' ? { answer: null, answered_by: null, is_provisional: false, answered_at: null } : {}) })
    .eq('id', id)
  throwIfError(error)
}

/** The author agrees with the AI's provisional decision. It stays a decision, not canon. */
export async function confirmDecision(id: string) {
  const { error } = await supabase.from('clarification_questions').update({ is_provisional: false, status: 'answered' }).eq('id', id)
  throwIfError(error)
}

/** Record a confirmed decision as approved canon for the book (author approval). */
export async function decisionToCanon(q: Question) {
  if (!q.book_id || !q.answer) throw new AppError('Only answered questions can become canon.')
  const { data: book } = await supabase.from('books').select('title').eq('id', q.book_id).single()
  const { error } = await supabase.from('canon_facts').insert({
    book_id: q.book_id,
    entity_type: 'book',
    entity_label: book?.title ?? 'Book',
    attribute: 'decision',
    value: `${q.question} ${q.answer}`.slice(0, 2000),
    statement_type: 'author_confirmed',
    status: 'approved',
    approved_at: new Date().toISOString(),
    confidence: 1,
    category: 'plot',
  })
  throwIfError(error)
  if (q.is_provisional) await confirmDecision(q.id)
}

// ---------------------------------------------------------------------------
// Style profiles
// ---------------------------------------------------------------------------
export interface StyleProfile {
  id: string
  scope: 'author' | 'pen_name' | 'series' | 'book'
  name: string
  pen_name: string | null
  series_id: string | null
  book_id: string | null
  profile: Record<string, string>
  summary: string | null
  preferences: string | null
  source_book_ids: string[]
  sample_words: number
  analyzed_at: string | null
  updated_at: string
}

export async function listProfiles(): Promise<StyleProfile[]> {
  const { data, error } = await supabase.from('writing_profiles').select('*').order('scope').order('name')
  throwIfError(error)
  return (data ?? []) as StyleProfile[]
}

export async function createProfile(p: { scope: StyleProfile['scope']; name: string; pen_name?: string | null; series_id?: string | null; book_id?: string | null }): Promise<string> {
  const { data, error } = await supabase.from('writing_profiles').insert({ ...p, name: p.name.trim() }).select('id').single()
  throwIfError(error)
  await logActivity('style_profile.created', 'writing_profile', data!.id, {})
  return data!.id
}

export async function updateProfile(id: string, patch: Partial<Pick<StyleProfile, 'name' | 'profile' | 'summary' | 'preferences'>>) {
  const { error } = await supabase.from('writing_profiles').update(patch).eq('id', id)
  throwIfError(error)
}

export async function deleteProfile(id: string) {
  const { error } = await supabase.from('writing_profiles').delete().eq('id', id)
  throwIfError(error)
}

// ---------------------------------------------------------------------------
// Per-book AI settings
// ---------------------------------------------------------------------------
export async function setBookAI(bookId: string, patch: { ai_mode?: string; style_profile_id?: string | null }) {
  const { error } = await supabase.from('books').update(patch).eq('id', bookId)
  throwIfError(error)
}

export async function listCrossovers(bookId: string): Promise<string[]> {
  const { data, error } = await supabase.from('book_crossovers').select('universe_id').eq('book_id', bookId)
  throwIfError(error)
  return (data ?? []).map((r) => r.universe_id as string)
}

export async function setCrossovers(bookId: string, universeIds: string[]) {
  const current = await listCrossovers(bookId)
  const add = universeIds.filter((u) => !current.includes(u))
  const remove = current.filter((u) => !universeIds.includes(u))
  if (remove.length) throwIfError((await supabase.from('book_crossovers').delete().eq('book_id', bookId).in('universe_id', remove)).error)
  if (add.length) throwIfError((await supabase.from('book_crossovers').insert(add.map((u) => ({ book_id: bookId, universe_id: u })))).error)
}

// ---------------------------------------------------------------------------
// Full Creative Partner
// ---------------------------------------------------------------------------
export interface PartnerInput {
  concept: string
  direction: string
  chapters: number
  scenesPerChapter: number
  wordsPerScene: number
}

export interface PartnerTask {
  id: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  input: PartnerInput | null
  output: {
    stage: 'analyze' | 'awaiting_answers' | 'plan' | 'awaiting_approval' | 'drafting' | 'continuity' | 'complete'
    scenes_total: number
    scenes_done: number
    questions_asked: number
    draft_estimate_usd?: number
  } | null
  error: string | null
  actual_cost_usd: number | null
  locked_at: string | null
  updated_at: string
}

export async function getPartnerTask(bookId: string): Promise<PartnerTask | null> {
  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, status, input, output, error, actual_cost_usd, locked_at, updated_at')
    .eq('idempotency_key', `partner:${bookId}`)
    .maybeSingle()
  throwIfError(error)
  return data as PartnerTask | null
}

export const runPartner = (bookId: string, action: 'start' | 'resume' | 'approve_plan' | 'restart', input: PartnerInput | null = null) =>
  callFunction('creative-partner-background', { bookId, action, input })

export async function setPartnerStatus(taskId: string, status: 'paused' | 'cancelled') {
  const { error } = await supabase.from('ai_tasks').update({ status }).eq('id', taskId).eq('status', 'running')
  throwIfError(error)
}

export interface StoryPlan {
  id: string
  kind: 'concept' | 'analysis' | 'premise' | 'character_arcs' | 'outline' | 'chapter' | 'scene'
  chapter_index: number | null
  scene_index: number | null
  title: string
  content: string
  status: 'draft' | 'approved' | 'drafted' | 'redraft'
  chapter_id: string | null
  scene_id: string | null
}

export async function listPlans(bookId: string): Promise<StoryPlan[]> {
  const { data, error } = await supabase
    .from('story_plans')
    .select('id, kind, chapter_index, scene_index, title, content, status, chapter_id, scene_id')
    .eq('book_id', bookId)
    .order('chapter_index', { nullsFirst: true })
    .order('scene_index', { nullsFirst: true })
  throwIfError(error)
  return (data ?? []) as StoryPlan[]
}

export async function updatePlan(id: string, patch: { title?: string; content?: string; status?: StoryPlan['status'] }) {
  const { error } = await supabase.from('story_plans').update(patch).eq('id', id)
  throwIfError(error)
}

// ---------------------------------------------------------------------------
// Ideas Vault
// ---------------------------------------------------------------------------
export const IDEA_CATEGORIES = [
  ['book_idea', 'Book idea'],
  ['character_idea', 'Character idea'],
  ['plot_twist', 'Plot twist'],
  ['dialogue', 'Dialogue'],
  ['scene', 'Scene'],
  ['setting', 'Setting'],
  ['relationship', 'Relationship'],
  ['theme', 'Theme'],
  ['ending', 'Ending'],
  ['spin_off', 'Spin-off'],
  ['general_note', 'General note'],
] as const
export const IDEA_STATUSES = ['new', 'developing', 'used', 'archived'] as const

export interface Idea {
  id: string
  title: string
  description: string | null
  category: (typeof IDEA_CATEGORIES)[number][0]
  tags: string[]
  status: (typeof IDEA_STATUSES)[number]
  book_id: string | null
  series_id: string | null
  universe_id: string | null
  suggested_links: Array<{ type: string; id: string; label: string; reason: string }>
  converted_entity_type: string | null
  converted_entity_id: string | null
  created_at: string
  idea_characters: Array<{ character_id: string }>
}

export async function listIdeas(): Promise<Idea[]> {
  const { data, error } = await supabase.from('ideas').select('*, idea_characters(character_id)').order('created_at', { ascending: false }).limit(2000)
  throwIfError(error)
  return (data ?? []) as Idea[]
}

export type IdeaInput = Pick<Idea, 'title' | 'description' | 'category' | 'tags' | 'status' | 'book_id' | 'series_id' | 'universe_id'> & { id?: string; characterIds: string[] }

export async function saveIdea(i: IdeaInput): Promise<string> {
  const { id, characterIds, ...row } = i
  const clean = { ...row, title: row.title.trim(), description: row.description?.trim() || null }
  const res = id ? await supabase.from('ideas').update(clean).eq('id', id).select('id').single() : await supabase.from('ideas').insert(clean).select('id').single()
  throwIfError(res.error)
  const ideaId = res.data!.id as string
  await supabase.from('idea_characters').delete().eq('idea_id', ideaId)
  if (characterIds.length) throwIfError((await supabase.from('idea_characters').insert(characterIds.map((c) => ({ idea_id: ideaId, character_id: c })))).error)
  return ideaId
}

export async function deleteIdea(id: string) {
  const { error } = await supabase.from('ideas').delete().eq('id', id)
  throwIfError(error)
}

/** Turn an idea into a book, character, plot thread, or scene. The idea is kept and marked used. */
export async function convertIdea(
  idea: Idea,
  to: 'book' | 'character' | 'plot_thread' | 'scene',
  target?: { bookId?: string; chapterId?: string },
): Promise<{ type: string; id: string; bookId?: string }> {
  let id: string
  let bookId: string | undefined
  if (to === 'book') {
    const { data, error } = await supabase
      .from('books')
      .insert({ title: idea.title, description: idea.description, writing_status: 'idea', book_type: 'work_in_progress' })
      .select('id')
      .single()
    throwIfError(error)
    id = data!.id
    bookId = id
    if (idea.series_id) await supabase.from('series_books').insert({ series_id: idea.series_id, book_id: id })
    if (idea.universe_id) await supabase.from('book_universes').insert({ universe_id: idea.universe_id, book_id: id })
  } else if (to === 'character') {
    const { data, error } = await supabase
      .from('characters')
      .insert({ full_name: idea.title, notes: idea.description, universe_id: idea.universe_id, first_appearance_book_id: idea.book_id })
      .select('id')
      .single()
    throwIfError(error)
    id = data!.id
  } else if (to === 'plot_thread') {
    const { data, error } = await supabase
      .from('plot_threads')
      .insert({ title: idea.title, description: idea.description, series_id: idea.series_id, universe_id: idea.universe_id, book_id: idea.book_id, kind: idea.category === 'spin_off' || idea.category === 'book_idea' ? 'future_idea' : 'thread' })
      .select('id')
      .single()
    throwIfError(error)
    id = data!.id
  } else {
    if (!target?.bookId || !target.chapterId) throw new AppError('Choose a book and chapter for the new scene.')
    const { data: last } = await supabase.from('scenes').select('id').eq('chapter_id', target.chapterId).order('position', { ascending: false }).limit(1).maybeSingle()
    const text = idea.description?.trim() || idea.title
    const content = { type: 'doc', content: text.split(/\n\s*\n/).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.trim() }] })) }
    const { data, error } = await supabase.rpc('insert_drafted_scenes', {
      p_book_id: target.bookId,
      p_scenes: [{ title: idea.title, content, text }],
      p_after_scene_id: last?.id ?? null,
      p_after_chapter_id: null,
      p_chapter_title: null,
    })
    throwIfError(error)
    id = (data as { scene_ids: string[] }).scene_ids[0]
    bookId = target.bookId
  }
  const { error } = await supabase.from('ideas').update({ status: 'used', converted_entity_type: to, converted_entity_id: id }).eq('id', idea.id)
  throwIfError(error)
  return { type: to, id, bookId }
}
