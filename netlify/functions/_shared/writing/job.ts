// Generate one Writing Studio proposal. The proposal row is created by the app with status
// 'generating'; this fills it in. Text is never written into the manuscript here.
import type { SupabaseClient } from '@supabase/supabase-js'
import { estimateTokens, resolveRoute } from '../../../../src/lib/ai/catalog'
import { commandById } from '../../../../src/lib/ai/commands'
import { availableProviders, callCost, checkBudget, loadSettings, ProviderDeclined, ProviderError, runStructured, runText, spending } from '../ai'
import { buildContext } from '../context/package'
import { insertQuestions, QUESTIONS_SCHEMA, type NewQuestion } from './questions'
import { DECLINED_HELP, MODE_NOTES, WRITER_RULES, writeInput } from './prompts'

export async function runWrite(db: SupabaseClient, proposalId: string): Promise<{ status: string }> {
  const { data: p } = await db
    .from('revision_proposals')
    .select('id, scene_id, book_id, command, instruction, original_text, status, insert_mode')
    .eq('id', proposalId)
    .maybeSingle()
  if (!p) return { status: 'not_found' }
  if (p.status !== 'generating') return { status: 'already_done' }
  const fail = async (error: string) => {
    await db.from('revision_proposals').update({ status: 'failed', error: error.slice(0, 1000) }).eq('id', proposalId)
    return { status: 'failed' }
  }

  const cmd = commandById(p.command ?? '')
  if (!cmd) return fail('Unknown command.')
  const { data: scene } = await db.from('scenes').select('id, book_id, title, content_text').eq('id', p.scene_id).maybeSingle()
  if (!scene || scene.book_id !== p.book_id) return fail('The scene no longer exists.')
  const { data: book } = await db.from('books').select('ai_mode').eq('id', p.book_id).single()

  const settings = await loadSettings(db)
  const route = resolveRoute(cmd.taskType, settings.routing, availableProviders())
  if (!route) return fail('AI is not set up on the server yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables.')

  try {
    const selection = String(p.original_text ?? '')
    const direction = String(p.instruction ?? '')
    const ctx = await buildContext(db, {
      bookId: p.book_id,
      sceneId: p.scene_id,
      focusText: [selection, direction].join('\n'),
      task: cmd.label,
      maxChars: 36_000,
    })
    const system = `${WRITER_RULES}\n\n${MODE_NOTES[book?.ai_mode ?? 'assistant'] ?? ''}`
    const input = writeInput({
      context: ctx.text,
      sceneTitle: scene.title,
      sceneText: scene.content_text ?? '',
      selection,
      direction,
      request: cmd.instruction + (selection ? ' The selected passage is in the <manuscript selection="true"> block.' : ''),
    })
    const estimate = callCost(route, estimateTokens(system.length + input.length), cmd.maxOutputTokens)
    const budget = checkBudget(settings, await spending(db), 0, estimate)
    if (!budget.ok) return fail(budget.reason!.replace(/^Paused: this/, 'This request'))

    if (cmd.id === 'questions') {
      const r = await runStructured<{ questions: NewQuestion[] }>(db, {
        route,
        taskType: cmd.taskType,
        taskId: null,
        request: {
          system,
          input: `${input}\n\nReturn up to 5 questions. Skip anything already answered in "Decisions already made" or settled by canon. Give 2 to 4 short options for each where sensible, and one sentence of context explaining why it matters.`,
          schema: QUESTIONS_SCHEMA as unknown as Record<string, unknown>,
          schemaName: 'clarification_questions',
          maxOutputTokens: cmd.maxOutputTokens,
        },
      })
      const qs = Array.isArray(r.data?.questions) ? r.data.questions : []
      const added = await insertQuestions(db, p.book_id, null, qs)
      const notes = added
        ? `${added} new ${added === 1 ? 'question was' : 'questions were'} added to your Questions list:\n\n${qs.map((q) => `- ${q.question}`).join('\n')}`
        : 'No new questions: everything the AI wanted to ask is already answered or already on your list.'
      await db.from('revision_proposals').update({ status: 'pending', notes, model: route.model }).eq('id', proposalId)
      return { status: 'pending' }
    }

    const r = await runText(db, { route, taskType: cmd.taskType, taskId: null, request: { system, input, maxOutputTokens: cmd.maxOutputTokens } })
    const text = r.text.trim()
    if (!text) return fail('The AI returned nothing. Try again.')
    const patch =
      cmd.insertMode === 'notes'
        ? { status: 'pending', notes: text, model: route.model }
        : {
            status: 'pending',
            proposed_text: text,
            model: route.model,
            notes: r.truncated ? 'This draft reached the length limit and may end mid-thought. Edit before inserting, or regenerate.' : null,
          }
    await db.from('revision_proposals').update(patch).eq('id', proposalId)
    return { status: 'pending' }
  } catch (err) {
    if (err instanceof ProviderDeclined) return fail(DECLINED_HELP)
    console.error('write failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
    return fail(err instanceof ProviderError ? err.message : 'Something went wrong while writing. Try again.')
  }
}
