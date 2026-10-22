// Resumable book analysis. Each passage (document chunk) is analyzed once and marked done,
// so a job that stops (time limit, budget pause, error, cancel) picks up where it left off.
import type { SupabaseClient } from '@supabase/supabase-js'
import { costUsd, estimateTokens, findModel, resolveRoute, type Route } from '../../../../src/lib/ai/catalog'
import { HttpError } from '../http'
import { availableProviders, checkBudget, loadSettings, ProviderDeclined, ProviderError, runStructured, spending, type AISettings } from '../ai'
import { chunkDiscoveries, synthesisDiscoveries } from './discoveries'
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM,
  extractionInput,
  SYNTHESIS_SCHEMA,
  SYNTHESIS_SYSTEM,
  synthesisInput,
  type ExtractionOutput,
  type SynthesisOutput,
} from './prompts'

export const STALE_LOCK_MS = 5 * 60 * 1000
const RUN_BUDGET_MS = 11 * 60 * 1000 // Background functions stop at 15 minutes.
const CONCURRENCY = 3
const EXTRACTION_OUTPUT_TOKENS = 4000
const SYNTHESIS_OUTPUT_TOKENS = 6000
// Planning figures for estimates: typical output per passage and per summary.
const EST_OUTPUT_PER_CHUNK = 1500
const EST_SUMMARY_TOKENS = 120
const EST_SYNTHESIS_OUTPUT = 2500

interface ChunkRow {
  id: string
  chunk_index: number
  chapter_label: string | null
  content: string
  char_start: number
  analysis_status: string
  summary: string | null
}

export interface AnalysisOutput {
  chunks_total: number
  chunks_done: number
  declined: number
  failed: number
  unverified_dropped: number
  discoveries: number
  synthesis_done: boolean
  extraction_model?: string
  synthesis_model?: string
}

export const taskKey = (fileId: string) => `analyze:${fileId}`

async function loadFile(db: SupabaseClient, fileId: string) {
  const { data: file, error } = await db.from('manuscript_files').select('id, book_id, extraction_status, original_name').eq('id', fileId).maybeSingle()
  if (error) throw new HttpError(500, 'Could not load the file record.')
  if (!file) throw new HttpError(404, 'File not found.')
  if (file.extraction_status !== 'completed') throw new HttpError(409, 'Read the text of this file before analyzing it.')
  const { data: book } = await db.from('books').select('id, title').eq('id', file.book_id).single()
  return { file, book: book as { id: string; title: string } }
}

async function loadChunks(db: SupabaseClient, fileId: string): Promise<ChunkRow[]> {
  const { data, error } = await db
    .from('document_chunks')
    .select('id, chunk_index, chapter_label, content, char_start, analysis_status, summary')
    .eq('manuscript_file_id', fileId)
    .order('chunk_index')
  if (error) throw new HttpError(500, 'Could not load the manuscript text.')
  return (data ?? []) as ChunkRow[]
}

function routeCost(route: Route | null, input: number, output: number): number {
  const m = route && findModel(route.provider, route.model)
  return m ? costUsd(m, input, output) : 0
}

const chunkInputTokens = (c: { content: string; chapter_label: string | null }) =>
  estimateTokens(EXTRACTION_SYSTEM.length + JSON.stringify(EXTRACTION_SCHEMA).length + c.content.length + 200)

export interface Estimate {
  bookTitle: string
  chunksTotal: number
  chunksRemaining: number
  synthesisRemaining: boolean
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  extraction: Route | null
  synthesis: Route | null
  providers: string[]
  settings: AISettings
  spent: { today: number; month: number }
  taskSpent: number
  allowed: boolean
  reason?: string
}

export async function estimateAnalysis(db: SupabaseClient, fileId: string): Promise<Estimate> {
  const { book } = await loadFile(db, fileId)
  const [chunks, settings, spent, task] = await Promise.all([
    loadChunks(db, fileId),
    loadSettings(db),
    spending(db),
    db.from('ai_tasks').select('actual_cost_usd, output, status').eq('idempotency_key', taskKey(fileId)).maybeSingle(),
  ])
  const providers = availableProviders()
  const extraction = resolveRoute('book_extraction', settings.routing, providers)
  const synthesis = resolveRoute('book_synthesis', settings.routing, providers)
  const remaining = chunks.filter((c) => c.analysis_status !== 'completed' && c.analysis_status !== 'declined')
  const synthesisRemaining = !(task.data?.output as AnalysisOutput | null)?.synthesis_done || task.data?.status !== 'completed'
  const exIn = remaining.reduce((n, c) => n + chunkInputTokens(c), 0)
  const exOut = remaining.length * EST_OUTPUT_PER_CHUNK
  const syIn = synthesisRemaining ? estimateTokens(SYNTHESIS_SYSTEM.length + JSON.stringify(SYNTHESIS_SCHEMA).length) + chunks.length * EST_SUMMARY_TOKENS : 0
  const syOut = synthesisRemaining ? EST_SYNTHESIS_OUTPUT : 0
  const cost = remaining.reduce((n, c) => n + routeCost(extraction, chunkInputTokens(c), EST_OUTPUT_PER_CHUNK), 0) + routeCost(synthesis, syIn, syOut)
  const taskSpent = Number(task.data?.actual_cost_usd ?? 0)
  let allowed = true
  let reason: string | undefined
  if (!providers.length || !extraction || !synthesis) {
    allowed = false
    reason = 'AI is not set up on the server yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables.'
  } else if (!chunks.length) {
    allowed = false
    reason = 'This file has no readable text to analyze. Read its text again first.'
  } else {
    // A restart starts the job's own spending over, so check against a fresh job.
    const b = checkBudget(settings, spent, 0, cost)
    if (!b.ok) {
      allowed = false
      reason = b.reason?.replace(/^Paused: this/, 'This')
    }
  }
  return {
    bookTitle: book.title,
    chunksTotal: chunks.length,
    chunksRemaining: remaining.length,
    synthesisRemaining,
    inputTokens: exIn + syIn,
    outputTokens: exOut + syOut,
    estimatedCostUsd: cost,
    extraction,
    synthesis,
    providers,
    settings,
    spent,
    taskSpent,
    allowed,
    reason,
  }
}

export type AnalysisAction = 'start' | 'resume' | 'restart'

export interface RunContext {
  /** Re-invoke the background function to continue after the time budget. */
  continueLater?: () => Promise<void>
  now?: () => number
}

export async function runAnalysis(db: SupabaseClient, fileId: string, action: AnalysisAction, ctx: RunContext = {}): Promise<{ status: string }> {
  const now = ctx.now ?? Date.now
  const startedAt = now()
  const { file, book } = await loadFile(db, fileId)
  const key = taskKey(fileId)

  // Create or claim the job. Only one run may hold the lock at a time.
  let { data: task } = await db.from('ai_tasks').select('*').eq('idempotency_key', key).maybeSingle()
  if (!task) {
    const ins = await db
      .from('ai_tasks')
      .insert({ task_type: 'book_analysis', idempotency_key: key, book_id: file.book_id, manuscript_file_id: fileId, status: 'queued', attempts: 0 })
      .select('*')
      .single()
    if (ins.error) {
      // Lost a race with another start; read the winner.
      task = (await db.from('ai_tasks').select('*').eq('idempotency_key', key).single()).data
    } else task = ins.data
  }
  if (!task) throw new HttpError(500, 'Could not create the analysis job.')
  // Optimistic claim: succeeds only if nobody changed the lock since we read it.
  if (task.locked_at && now() - new Date(task.locked_at).getTime() < STALE_LOCK_MS) return { status: 'already_running' }
  const claimQuery = db.from('ai_tasks').update({ locked_at: new Date(now()).toISOString() }).eq('id', task.id)
  const claim = await (task.locked_at ? claimQuery.eq('locked_at', task.locked_at) : claimQuery.is('locked_at', null)).select('id')
  if (!claim.data?.length) return { status: 'already_running' }

  const release = (patch: Record<string, unknown>) => db.from('ai_tasks').update({ ...patch, locked_at: null }).eq('id', task!.id)

  try {
    if (action === 'restart') {
      // Unreviewed discoveries from the earlier run go; anything approved or rejected stays.
      await db.from('canon_facts').delete().eq('ai_task_id', task.id).eq('status', 'proposed')
      await db.from('document_chunks').update({ analysis_status: 'pending', summary: null, analysis_error: null, processed_at: null }).eq('manuscript_file_id', fileId)
    }
    const restartOutput = action === 'restart' || !task.output
    const settings = await loadSettings(db)
    const providers = availableProviders()
    const extraction = resolveRoute('book_extraction', settings.routing, providers)
    const synthesis = resolveRoute('book_synthesis', settings.routing, providers)
    if (!extraction || !synthesis) {
      await release({ status: 'failed', error: 'AI is not set up on the server yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables.' })
      return { status: 'failed' }
    }

    let chunks = await loadChunks(db, fileId)
    if (!chunks.length) {
      await release({ status: 'failed', error: 'This file has no readable text to analyze.' })
      return { status: 'failed' }
    }
    const prev = (restartOutput ? {} : task.output) as Partial<AnalysisOutput>
    const out: AnalysisOutput = {
      chunks_total: chunks.length,
      chunks_done: chunks.filter((c) => c.analysis_status === 'completed').length,
      declined: chunks.filter((c) => c.analysis_status === 'declined').length,
      failed: 0,
      unverified_dropped: prev.unverified_dropped ?? 0,
      discoveries: prev.discoveries ?? 0,
      synthesis_done: action === 'restart' ? false : Boolean(prev.synthesis_done),
      extraction_model: extraction.model,
      synthesis_model: synthesis.model,
    }
    let taskSpent = action === 'restart' ? 0 : Number(task.actual_cost_usd ?? 0)
    const isNewRun = action !== 'resume' || task.status !== 'running'
    await db
      .from('ai_tasks')
      .update({
        status: 'running',
        error: null,
        total_steps: chunks.length + 1,
        completed_steps: out.chunks_done + out.declined,
        output: out,
        actual_cost_usd: taskSpent,
        attempts: (task.attempts ?? 0) + (isNewRun ? 1 : 0),
        started_at: isNewRun ? new Date(now()).toISOString() : task.started_at,
        completed_at: null,
        input: { file: file.original_name },
      })
      .eq('id', task.id)

    const todo = chunks.filter((c) => c.analysis_status !== 'completed' && c.analysis_status !== 'declined')

    // Refuse to start work the limits cannot cover.
    const remainingEstimate =
      todo.reduce((n, c) => n + routeCost(extraction, chunkInputTokens(c), EST_OUTPUT_PER_CHUNK), 0) +
      (out.synthesis_done ? 0 : routeCost(synthesis, chunks.length * EST_SUMMARY_TOKENS + 2000, EST_SYNTHESIS_OUTPUT))
    const pre = checkBudget(settings, await spending(db), taskSpent, remainingEstimate)
    if (!pre.ok) {
      await release({ status: 'paused', error: pre.reason, estimated_cost_usd: remainingEstimate })
      return { status: 'paused' }
    }
    await db.from('ai_tasks').update({ estimated_cost_usd: Number((taskSpent + remainingEstimate).toFixed(6)) }).eq('id', task.id)

    let stopReason: 'paused' | 'cancelled' | 'fatal' | 'time' | null = null
    let stopMessage = ''
    for (let i = 0; i < todo.length && !stopReason; i += CONCURRENCY) {
      if (now() - startedAt > RUN_BUDGET_MS) {
        stopReason = 'time'
        break
      }
      const { data: live } = await db.from('ai_tasks').select('status').eq('id', task.id).single()
      if (live?.status === 'cancelled') {
        stopReason = 'cancelled'
        break
      }
      const batch = todo.slice(i, i + CONCURRENCY)
      const batchEstimate = batch.reduce((n, c) => n + routeCost(extraction, chunkInputTokens(c), EST_OUTPUT_PER_CHUNK), 0)
      const budget = checkBudget(settings, await spending(db), taskSpent, batchEstimate)
      if (!budget.ok) {
        stopReason = 'paused'
        stopMessage = budget.reason!
        break
      }
      const results = await Promise.all(
        batch.map(async (c) => {
          try {
            const r = await runStructured<ExtractionOutput>(db, {
              route: extraction,
              taskType: 'book_extraction',
              taskId: task!.id,
              request: {
                system: EXTRACTION_SYSTEM,
                input: extractionInput(book.title, c.chapter_label, c.content),
                schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
                schemaName: 'chunk_discoveries',
                maxOutputTokens: EXTRACTION_OUTPUT_TOKENS,
              },
            })
            const { rows, unverified } = chunkDiscoveries(r.data, { content: c.content, charStart: c.char_start })
            const saved = await db.rpc('save_chunk_discoveries', {
              p_chunk_id: c.id,
              p_task_id: task!.id,
              p_summary: String(r.data?.summary ?? '').slice(0, 4000),
              p_facts: rows,
            })
            if (saved.error) throw new Error(`save discoveries: ${saved.error.message}`)
            return { ok: true as const, cost: r.cost, created: Number(saved.data ?? 0), unverified }
          } catch (err) {
            const cost = (err as { cost?: number }).cost ?? 0
            if (err instanceof ProviderDeclined) {
              await db.from('document_chunks').update({ analysis_status: 'declined', analysis_error: err.message }).eq('id', c.id)
              return { ok: false as const, declined: true, cost }
            }
            const message = err instanceof ProviderError ? err.message : 'Analysis of this passage failed.'
            console.error('chunk analysis failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
            await db.from('document_chunks').update({ analysis_status: 'failed', analysis_error: message.slice(0, 500) }).eq('id', c.id)
            const fatal = err instanceof ProviderError && !err.retryable
            return { ok: false as const, declined: false, cost, fatal, message }
          }
        }),
      )
      for (const r of results) {
        taskSpent += r.cost
        if (r.ok) {
          out.chunks_done++
          out.discoveries += r.created
          out.unverified_dropped += r.unverified
        } else if (r.declined) out.declined++
        else {
          out.failed++
          if (r.fatal) {
            stopReason = 'fatal'
            stopMessage = r.message
          }
        }
      }
      await db
        .from('ai_tasks')
        .update({
          completed_steps: out.chunks_done + out.declined,
          output: out,
          actual_cost_usd: Number(taskSpent.toFixed(6)),
          locked_at: new Date(now()).toISOString(),
        })
        .eq('id', task.id)
    }

    if (stopReason === 'time') {
      await release({ output: out })
      if (ctx.continueLater) await ctx.continueLater()
      return { status: 'continuing' }
    }
    if (stopReason === 'cancelled') {
      await release({ output: out, error: 'Stopped. Resume to continue where it left off.' })
      return { status: 'cancelled' }
    }
    if (stopReason === 'paused') {
      await release({ status: 'paused', output: out, error: stopMessage })
      return { status: 'paused' }
    }
    chunks = await loadChunks(db, fileId)
    const failed = chunks.filter((c) => c.analysis_status === 'failed' || c.analysis_status === 'pending').length
    if (stopReason === 'fatal' || failed > 0) {
      await release({
        status: 'failed',
        output: { ...out, failed },
        error:
          stopReason === 'fatal'
            ? stopMessage
            : `${failed} ${failed === 1 ? 'passage' : 'passages'} could not be analyzed. Resume to try ${failed === 1 ? 'it' : 'them'} again.`,
      })
      return { status: 'failed' }
    }

    // Whole-book analysis from the passage summaries.
    if (!out.synthesis_done) {
      const synEstimate = routeCost(synthesis, chunks.length * EST_SUMMARY_TOKENS + 2000, EST_SYNTHESIS_OUTPUT)
      const b = checkBudget(settings, await spending(db), taskSpent, synEstimate)
      if (!b.ok) {
        await release({ status: 'paused', output: out, error: b.reason })
        return { status: 'paused' }
      }
      const { data: chars } = await db
        .from('canon_facts')
        .select('entity_label')
        .eq('book_id', book.id)
        .eq('entity_type', 'character')
        .in('status', ['proposed', 'approved'])
        .limit(2000)
      const names = [...new Set((chars ?? []).map((c) => c.entity_label as string).filter(Boolean))]
      const summaries = chunks.filter((c) => c.summary).map((c) => ({ label: c.chapter_label, summary: c.summary! }))
      try {
        const r = await runStructured<SynthesisOutput>(db, {
          route: synthesis,
          taskType: 'book_synthesis',
          taskId: task.id,
          request: {
            system: SYNTHESIS_SYSTEM,
            input: synthesisInput(book.title, summaries, names),
            schema: SYNTHESIS_SCHEMA as unknown as Record<string, unknown>,
            schemaName: 'book_synthesis',
            maxOutputTokens: SYNTHESIS_OUTPUT_TOKENS,
          },
        })
        taskSpent += r.cost
        const rows = synthesisDiscoveries(r.data, book.title)
        await db.from('canon_facts').delete().eq('ai_task_id', task.id).eq('entity_type', 'book').eq('status', 'proposed')
        for (const row of rows) {
          const ins = await db
            .from('canon_facts')
            .insert({
              book_id: book.id,
              entity_type: row.entity_type,
              entity_label: row.entity_label,
              attribute: row.attribute,
              value: row.value,
              statement_type: row.statement_type,
              status: 'proposed',
              confidence: row.confidence,
              category: row.category,
              payload: row.payload,
              ai_task_id: task.id,
              manuscript_file_id: fileId,
            })
            .select('id')
            .single()
          if (ins.data)
            await db.from('fact_sources').insert({ fact_id: ins.data.id, manuscript_file_id: fileId, book_id: book.id, location_label: 'Whole book, from passage summaries' })
        }
        out.discoveries += rows.length
        out.synthesis_done = true
      } catch (err) {
        taskSpent += (err as { cost?: number }).cost ?? 0
        const message =
          err instanceof ProviderDeclined
            ? `${err.message} The chapter-by-chapter discoveries are ready to review; the whole-book analysis was not completed.`
            : err instanceof ProviderError
              ? err.message
              : 'The whole-book analysis failed. Resume to try again.'
        await release({ status: 'failed', output: out, actual_cost_usd: Number(taskSpent.toFixed(6)), error: message })
        return { status: 'failed' }
      }
    }

    await release({
      status: 'completed',
      completed_steps: chunks.length + 1,
      output: out,
      actual_cost_usd: Number(taskSpent.toFixed(6)),
      completed_at: new Date(now()).toISOString(),
      error: out.declined ? `${out.declined} ${out.declined === 1 ? 'passage was' : 'passages were'} declined by the AI provider and not analyzed.` : null,
    })
    return { status: 'completed' }
  } catch (err) {
    console.error('analysis failed', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
    await release({ status: 'failed', error: 'The analysis stopped unexpectedly. Resume to continue where it left off.' })
    return { status: 'failed' }
  }
}
