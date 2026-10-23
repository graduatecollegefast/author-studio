import * as React from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Pause, PenLine, RotateCcw, Sparkles, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/field'
import { Spinner } from '@/components/ui/feedback'
import { formatUsd } from '@/lib/ai/catalog'
import { cn, formatNumber } from '@/lib/utils'
import { getPartnerTask, listPlans, listQuestions, runPartner, setPartnerStatus, updatePlan, type PartnerInput, type StoryPlan } from '@/services/writing'
import { QuestionCard } from './QuestionCard'

const STAGES: Record<string, string> = {
  analyze: 'Analyzing your concept',
  awaiting_answers: 'Waiting for your answers',
  plan: 'Planning the book',
  awaiting_approval: 'Waiting for you to approve the plan',
  drafting: 'Drafting scenes',
  continuity: 'Checking continuity',
  complete: 'Draft complete',
}

/** Mode C: from concept to full draft, one saved scene at a time, with the author in charge. */
export function CreativePartner({ bookId, bookTitle }: { bookId: string; bookTitle: string }) {
  const qc = useQueryClient()
  const task = useQuery({
    queryKey: ['partner-task', bookId],
    queryFn: () => getPartnerTask(bookId),
    refetchInterval: (q) => (q.state.data?.status === 'running' || q.state.data?.status === 'queued' ? 2500 : false),
  })
  const stage = task.data?.output?.stage
  const plans = useQuery({ queryKey: ['plans', bookId, stage, task.data?.output?.scenes_done], queryFn: () => listPlans(bookId) })
  const questions = useQuery({ queryKey: ['questions', bookId, stage], queryFn: () => listQuestions(bookId) })
  const [form, setForm] = React.useState<PartnerInput>({ concept: '', direction: '', chapters: 12, scenesPerChapter: 2, wordsPerScene: 1500 })
  const [busy, setBusy] = React.useState(false)
  const [confirmRestart, setConfirmRestart] = React.useState(false)
  const [restarting, setRestarting] = React.useState(false)

  const refresh = () => {
    void task.refetch()
    qc.invalidateQueries({ queryKey: ['plans', bookId] })
    qc.invalidateQueries({ queryKey: ['questions', bookId] })
  }
  async function go(action: 'start' | 'resume' | 'approve_plan' | 'restart', input: PartnerInput | null = null) {
    setBusy(true)
    try {
      await runPartner(bookId, action, input)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not continue')
    } finally {
      setBusy(false)
      setTimeout(refresh, 800)
      setTimeout(refresh, 3000)
    }
  }

  if (task.isLoading) return <Spinner />
  const t = task.data
  const stalled = t?.status === 'running' && Date.now() - new Date(t.updated_at).getTime() > 6 * 60 * 1000

  if (!t || restarting) {
    return (
      <Card>
        <CardHeader title={`Start a Creative Partner project for ${bookTitle}`} action={<Badge tone="ai">Uses AI</Badge>} />
        <form
          className="space-y-4 px-5 pb-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.concept.trim()) return toast.error('Describe the book concept first.')
            void go(t ? 'restart' : 'start', form).then(() => setRestarting(false))
          }}
        >
          <p className="text-sm text-fg-muted">
            The AI studies your concept and connected canon, asks what it needs to know, proposes a premise, character arcs and a full outline for your approval, then drafts the book one scene at a time. Each scene is saved into this book as a new chapter before the next begins. Your existing chapters are never changed. You can pause, edit the plan, redraft scenes or stop at any point.
          </p>
          <Field label="Book concept" htmlFor="cp-concept">
            <Textarea id="cp-concept" className="min-h-32" value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} required />
          </Field>
          <Field label="Creative direction (optional)" htmlFor="cp-direction" hint="Tone, heat level, ending, what to avoid, anything that matters to you.">
            <Textarea id="cp-direction" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Chapters" htmlFor="cp-chapters">
              <Input id="cp-chapters" type="number" min={1} max={60} value={form.chapters} onChange={(e) => setForm({ ...form, chapters: Number(e.target.value) })} />
            </Field>
            <Field label="Scenes per chapter" htmlFor="cp-scenes">
              <Input id="cp-scenes" type="number" min={1} max={8} value={form.scenesPerChapter} onChange={(e) => setForm({ ...form, scenesPerChapter: Number(e.target.value) })} />
            </Field>
            <Field label="Words per scene" htmlFor="cp-words">
              <Input id="cp-words" type="number" min={300} max={5000} step={100} value={form.wordsPerScene} onChange={(e) => setForm({ ...form, wordsPerScene: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button variant="ai" type="submit" disabled={busy}>
              <Sparkles /> Start with this concept
            </Button>
            {restarting && (
              <Button type="button" variant="ghost" onClick={() => setRestarting(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    )
  }

  const out = t.output
  const all = plans.data ?? []
  const premise = all.find((p) => p.kind === 'premise')
  const arcs = all.find((p) => p.kind === 'character_arcs')
  const analysis = all.find((p) => p.kind === 'analysis')
  const chapters = all.filter((p) => p.kind === 'chapter')
  const scenes = all.filter((p) => p.kind === 'scene')
  const taskQuestions = (questions.data ?? []).filter((q) => q.ai_task_id === t.id)
  const openQs = taskQuestions.filter((q) => q.status === 'open')
  const editable = t.status !== 'running' || stalled

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Creative Partner" action={<Badge tone={t.status === 'failed' ? 'alert' : t.status === 'completed' ? 'progress' : 'ai'}>{t.status === 'running' && !stalled ? 'Working' : stalled ? 'Interrupted' : t.status === 'paused' ? 'Paused' : t.status === 'completed' ? 'Complete' : t.status === 'cancelled' ? 'Stopped' : t.status === 'failed' ? 'Stopped with a problem' : 'Starting'}</Badge>} />
        <div className="space-y-3 px-5 pb-5 text-sm" data-testid="partner-status">
          <p className="font-semibold" data-testid="partner-stage">
            {STAGES[out?.stage ?? 'analyze']}
          </p>
          {out && out.scenes_total > 0 && (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-label="Scenes drafted" aria-valuenow={out.scenes_done} aria-valuemin={0} aria-valuemax={out.scenes_total}>
                <div className="h-full bg-ai" style={{ width: `${Math.round((out.scenes_done / out.scenes_total) * 100)}%` }} />
              </div>
              <p className="text-fg-muted">
                {formatNumber(out.scenes_done)} of {formatNumber(out.scenes_total)} scenes drafted · cost so far {formatUsd(Number(t.actual_cost_usd ?? 0))}
                {out.draft_estimate_usd !== undefined && out.stage === 'awaiting_approval' ? ` · drafting all scenes is estimated at ${formatUsd(out.draft_estimate_usd)}` : ''}
              </p>
            </>
          )}
          {(t.error || stalled) && (
            <p className="text-alert-text" role="status">
              {stalled ? 'The Creative Partner stopped responding. Resume to continue where it left off.' : t.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {t.status === 'running' && !stalled && (
              <>
                <Button variant="secondary" onClick={() => void setPartnerStatus(t.id, 'paused').then(refresh)}>
                  <Pause /> Pause
                </Button>
                <Button variant="secondary" onClick={() => void setPartnerStatus(t.id, 'cancelled').then(refresh)}>
                  <Square /> Stop
                </Button>
              </>
            )}
            {editable && out?.stage === 'awaiting_answers' && (
              <Button variant="ai" disabled={busy || openQs.length > 0} onClick={() => void go('resume')}>
                <Sparkles /> {openQs.length ? `Answer ${openQs.length} more ${openQs.length === 1 ? 'question' : 'questions'} to continue` : 'Continue to the plan'}
              </Button>
            )}
            {editable && out?.stage === 'awaiting_approval' && (
              <Button variant="ai" disabled={busy} onClick={() => void go('approve_plan')}>
                <Check /> Approve plan and start drafting
              </Button>
            )}
            {editable && (t.status === 'paused' || t.status === 'failed' || t.status === 'cancelled' || stalled) && out?.stage !== 'awaiting_answers' && out?.stage !== 'awaiting_approval' && (
              <Button variant="ai" disabled={busy} onClick={() => void go('resume')}>
                <Sparkles /> Resume
              </Button>
            )}
            {editable && t.status === 'completed' && scenes.some((s) => s.status === 'redraft') && (
              <Button variant="ai" disabled={busy} onClick={() => void go('resume')}>
                <Sparkles /> Redraft marked scenes
              </Button>
            )}
            {editable && (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmRestart(true)}>
                <RotateCcw /> Start over with a new concept
              </Button>
            )}
          </div>
          {out?.stage === 'complete' && (
            <p>
              The full draft is in the book.{' '}
              <Link className="link font-semibold" to={`/books/${bookId}/write`}>
                Open it in the Writing Studio
              </Link>{' '}
              or review the{' '}
              <Link className="link font-semibold" to={`/continuity?book=${bookId}`}>
                continuity findings
              </Link>
              .
            </p>
          )}
        </div>
      </Card>

      {analysis && (
        <Card>
          <CardHeader title="Concept analysis" />
          <p className="whitespace-pre-wrap px-5 pb-5 text-sm">{analysis.content}</p>
        </Card>
      )}

      {taskQuestions.length > 0 && (
        <Card>
          <CardHeader title="Questions for you" />
          <ul className="space-y-3 px-5 pb-5">
            {taskQuestions.map((q) => (
              <QuestionCard key={q.id} q={q} onChanged={() => qc.invalidateQueries({ queryKey: ['questions', bookId] })} />
            ))}
          </ul>
        </Card>
      )}

      {premise && (
        <Card>
          <CardHeader title="The plan" action={editable ? <span className="text-xs text-fg-muted">Edits save when you leave a box</span> : undefined} />
          <div className="space-y-5 px-5 pb-5 text-sm" data-testid="partner-plan">
            <PlanText plan={premise} label="Premise" editable={editable} />
            {arcs && <PlanText plan={arcs} label="Character arcs" editable={editable} />}
            <ol className="space-y-4">
              {chapters.map((c) => (
                <li key={c.id} className="rounded-lg border border-line p-3">
                  <PlanText plan={c} label={`Chapter ${(c.chapter_index ?? 0) + 1}`} editable={editable && c.status !== 'drafted'} withTitle />
                  <ol className="mt-3 space-y-2 border-l-2 border-line pl-3">
                    {scenes
                      .filter((s) => s.chapter_index === c.chapter_index)
                      .map((s) => (
                        <li key={s.id} data-testid="scene-plan">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <Badge tone={s.status === 'drafted' ? 'progress' : s.status === 'redraft' ? 'alert' : 'neutral'}>
                              {s.status === 'drafted' ? 'Drafted' : s.status === 'redraft' ? 'Will be redrafted' : s.status === 'approved' ? 'Approved' : 'Planned'}
                            </Badge>
                            {s.scene_id && (
                              <Link className="link inline-flex items-center gap-1 text-xs" to={`/books/${bookId}/write?scene=${s.scene_id}`}>
                                <PenLine className="size-3.5" aria-hidden /> Open scene
                              </Link>
                            )}
                            {editable && s.status === 'drafted' && (
                              <button
                                type="button"
                                className="link text-xs"
                                onClick={async () => {
                                  await updatePlan(s.id, { status: 'redraft' })
                                  qc.invalidateQueries({ queryKey: ['plans', bookId] })
                                }}
                              >
                                Mark for redraft
                              </button>
                            )}
                            {s.status === 'redraft' && editable && (
                              <button
                                type="button"
                                className="link text-xs"
                                onClick={async () => {
                                  await updatePlan(s.id, { status: 'drafted' })
                                  qc.invalidateQueries({ queryKey: ['plans', bookId] })
                                }}
                              >
                                Keep current draft
                              </button>
                            )}
                          </div>
                          <PlanText plan={s} label={`Scene ${(s.scene_index ?? 0) + 1}`} editable={editable && s.status !== 'drafted'} withTitle compact />
                        </li>
                      ))}
                  </ol>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Start over with a new concept?"
        description="The current plan and its questions' progress are replaced. Scenes already drafted stay in the book and in their version history."
        confirmLabel="Start over"
        onConfirm={async () => {
          if (t.input) setForm(t.input)
          if (t.status === 'running') await setPartnerStatus(t.id, 'cancelled').catch(() => undefined)
          // Show the form again with the previous concept to edit.
          setRestarting(true)
        }}
      />
    </div>
  )
}

function PlanText({ plan, label, editable, withTitle, compact }: { plan: StoryPlan; label: string; editable: boolean; withTitle?: boolean; compact?: boolean }) {
  const qc = useQueryClient()
  const [title, setTitle] = React.useState(plan.title)
  const [content, setContent] = React.useState(plan.content)
  React.useEffect(() => {
    setTitle(plan.title)
    setContent(plan.content)
  }, [plan.title, plan.content])
  const save = async () => {
    if (title === plan.title && content === plan.content) return
    try {
      await updatePlan(plan.id, { title: title.trim() || plan.title, content })
      qc.invalidateQueries({ queryKey: ['plans'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    }
  }
  if (!editable)
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</p>
        {withTitle && <p className="font-serif font-semibold">{plan.title}</p>}
        <p className={cn('whitespace-pre-wrap', compact && 'text-fg-muted')}>{plan.content}</p>
      </div>
    )
  return (
    <div className="space-y-1.5">
      {withTitle ? (
        <Field label={`${label} title`} htmlFor={`pt-${plan.id}`}>
          <Input id={`pt-${plan.id}`} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void save()} />
        </Field>
      ) : null}
      <Field label={withTitle ? `${label} plan` : label} htmlFor={`pc-${plan.id}`}>
        <Textarea id={`pc-${plan.id}`} className={compact ? 'min-h-16' : 'min-h-24'} value={content} onChange={(e) => setContent(e.target.value)} onBlur={() => void save()} />
      </Field>
    </div>
  )
}
