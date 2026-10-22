import * as React from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, RotateCcw, Sparkles, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Field, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useManuscripts } from '@/hooks/queries'
import { estimateAnalysis, getAnalysisTask, startAnalysis, stopAnalysis, type AnalysisTask } from '@/services/ai'
import { findModel, formatUsd } from '@/lib/ai/catalog'
import { formatNumber, formatRelative } from '@/lib/utils'
import type { Book } from '@/types/db'
import { DiscoveryReview } from './DiscoveryReview'

const STALE_MS = 5 * 60 * 1000

function modelLabel(r: { provider: string; model: string } | null | undefined) {
  if (!r) return 'not available'
  return findModel(r.provider, r.model)?.label ?? r.model
}

export function AnalysisPanel({ book }: { book: Book }) {
  const qc = useQueryClient()
  const files = useManuscripts(book.id)
  const ready = (files.data ?? []).filter((f) => f.kind === 'manuscript' && f.extraction_status === 'completed')
  const [fileId, setFileId] = React.useState<string>('')
  React.useEffect(() => {
    if (fileId && ready.some((f) => f.id === fileId)) return
    const preferred = ready.find((f) => f.id === book.current_manuscript_file_id) ?? ready[0]
    if (preferred) setFileId(preferred.id)
  }, [ready, fileId, book.current_manuscript_file_id])

  const task = useQuery({
    queryKey: ['analysis-task', fileId],
    queryFn: () => getAnalysisTask(fileId),
    enabled: Boolean(fileId),
    refetchInterval: (q) => (q.state.data?.status === 'running' || q.state.data?.status === 'queued' ? 3000 : false),
  })
  const estimate = useQuery({
    queryKey: ['analysis-estimate', fileId, task.data?.status, task.data?.completed_steps],
    queryFn: () => estimateAnalysis(fileId),
    enabled: Boolean(fileId) && task.data?.status !== 'running',
  })
  const [busy, setBusy] = React.useState(false)
  const [confirmRestart, setConfirmRestart] = React.useState(false)

  // Keep the review list fresh while discoveries arrive.
  const found = task.data?.output?.discoveries ?? 0
  React.useEffect(() => {
    qc.invalidateQueries({ queryKey: ['discoveries', book.id] })
  }, [task.data?.status, found, qc, book.id])

  async function run(action: 'start' | 'resume' | 'restart') {
    setBusy(true)
    try {
      await startAnalysis(fileId, action)
      toast.success(action === 'resume' ? 'Analysis resumed' : 'Analysis started. You can leave this page; it keeps running.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the analysis')
    } finally {
      setBusy(false)
      // The job claims its row within a moment; poll until it shows.
      setTimeout(() => void task.refetch(), 800)
      setTimeout(() => void task.refetch(), 2500)
    }
  }

  if (files.isLoading) return <Spinner />
  if (files.error) return <ErrorState error={files.error} onRetry={() => void files.refetch()} />
  if (!ready.length)
    return (
      <EmptyState icon={<Sparkles />} title="Nothing to analyze yet">
        Upload a manuscript on the Manuscript files tab and let its text be read. Then come back to analyze it.
      </EmptyState>
    )

  const t = task.data
  const e = estimate.data
  const stale = t?.status === 'running' && t.locked_at === null && Date.now() - new Date(t.updated_at).getTime() > 60_000
  const lockStale = t?.status === 'running' && t.locked_at !== null && Date.now() - new Date(t.locked_at).getTime() > STALE_MS
  const canResume = t && (t.status === 'paused' || t.status === 'failed' || t.status === 'cancelled' || stale || lockStale)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="AI analysis" action={<Badge tone="ai">Uses AI</Badge>} />
        <div className="space-y-4 px-5 pb-5 text-sm">
          <p className="max-w-2xl text-fg-muted">
            Reads the manuscript passage by passage and proposes characters, relationships, places, events, plot, themes, style, and series ideas,
            each with the exact quote it came from. Nothing becomes canon until you approve it.
          </p>
          {ready.length > 1 && (
            <Field label="Manuscript" htmlFor="analysis-file" className="max-w-sm">
              <Select id="analysis-file" value={fileId} onChange={(ev) => setFileId(ev.target.value)}>
                {ready.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.original_name} (version {f.version})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {t && <TaskProgress task={t} stalled={Boolean(stale || lockStale)} />}

          {t?.status !== 'running' && estimate.isLoading && <Spinner label="Estimating cost" />}
          {estimate.error && <ErrorState error={estimate.error} onRetry={() => void estimate.refetch()} />}
          {e && t?.status !== 'running' && (
            <div data-testid="analysis-estimate" className="space-y-2">
              <dl className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-panel-2 p-3">
                  <dt className="text-xs text-fg-muted">Passages {t ? 'left' : ''}</dt>
                  <dd className="font-serif text-xl font-semibold">{formatNumber(t ? e.chunksRemaining : e.chunksTotal)}</dd>
                </div>
                <div className="rounded-lg bg-panel-2 p-3">
                  <dt className="text-xs text-fg-muted">Estimated cost</dt>
                  <dd className="font-serif text-xl font-semibold">{formatUsd(e.estimatedCostUsd)}</dd>
                </div>
                <div className="rounded-lg bg-panel-2 p-3 sm:col-span-2">
                  <dt className="text-xs text-fg-muted">Models</dt>
                  <dd className="mt-1 text-sm">
                    Passages: <strong>{modelLabel(e.extraction)}</strong>
                    <br />
                    Whole book: <strong>{modelLabel(e.synthesis)}</strong>
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-fg-muted">
                About {formatNumber(e.inputTokens)} tokens in and {formatNumber(e.outputTokens)} out. Spent today {formatUsd(e.spent.today)}, this
                month {formatUsd(e.spent.month)}. The actual cost is recorded after each step.{' '}
                <Link className="link underline" to="/settings#ai">
                  Limits and models
                </Link>
              </p>
            </div>
          )}
          {e && !e.allowed && t?.status !== 'running' && (
            <p role="alert" className="flex gap-2 rounded-lg border border-alert bg-alert-soft p-3 text-alert-text">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {e.reason}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!t && (
              <Button variant="ai" onClick={() => void run('start')} disabled={busy || !e?.allowed}>
                <Sparkles /> Analyze book
              </Button>
            )}
            {canResume && (
              <Button variant="ai" onClick={() => void run('resume')} disabled={busy || !e?.allowed}>
                <Sparkles /> Resume analysis
              </Button>
            )}
            {t?.status === 'running' && !stale && !lockStale && (
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await stopAnalysis(t.id)
                    toast.success('Stopping after the current passages')
                    void task.refetch()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Could not stop')
                  }
                }}
              >
                <Square /> Stop
              </Button>
            )}
            {t && t.status !== 'running' && (
              <Button variant="secondary" onClick={() => setConfirmRestart(true)} disabled={busy || !e?.allowed}>
                <RotateCcw /> Analyze again from the start
              </Button>
            )}
          </div>
        </div>
      </Card>

      <DiscoveryReview bookId={book.id} />

      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Analyze this manuscript again?"
        description="The whole manuscript is read again. Discoveries you have not reviewed yet are replaced. Everything you approved or rejected stays as it is."
        confirmLabel="Analyze again"
        onConfirm={async () => {
          await run('restart')
        }}
      />
    </div>
  )
}

function TaskProgress({ task, stalled }: { task: AnalysisTask; stalled: boolean }) {
  const o = task.output ?? {}
  const total = o.chunks_total ?? Math.max(0, task.total_steps - 1)
  const done = (o.chunks_done ?? 0) + (o.declined ?? 0)
  const pct = total ? Math.round(((done + (o.synthesis_done ? 1 : 0)) / (total + 1)) * 100) : 0
  const label: Record<AnalysisTask['status'], string> = {
    queued: 'Starting',
    running: stalled ? 'Interrupted' : 'Analyzing',
    paused: 'Paused',
    completed: 'Complete',
    failed: 'Stopped with problems',
    cancelled: 'Stopped',
  }
  const tone = task.status === 'completed' ? 'progress' : task.status === 'failed' || task.status === 'paused' || stalled ? 'alert' : 'ai'
  return (
    <div className="space-y-2 rounded-lg border border-line p-4" data-testid="analysis-progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Badge tone={tone} data-testid="analysis-status">
            {label[task.status]}
          </Badge>
          <span className="text-fg-muted">
            {formatNumber(done)} of {formatNumber(total)} passages
            {o.synthesis_done ? ', whole book done' : ''}
          </span>
        </span>
        <span className="text-fg-muted">
          Cost so far <strong className="text-fg">{formatUsd(Number(task.actual_cost_usd ?? 0))}</strong>
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-panel-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Analysis progress"
      >
        <div className="h-full rounded-full bg-ai transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-fg-muted">
        {formatNumber(o.discoveries ?? 0)} discoveries
        {o.unverified_dropped ? `. ${formatNumber(o.unverified_dropped)} left out because their quotes could not be found in your text` : ''}
        {o.declined ? `. ${o.declined} ${o.declined === 1 ? 'passage was' : 'passages were'} declined by the AI provider` : ''}
        {task.completed_at ? `. Finished ${formatRelative(task.completed_at)}` : ''}.
      </p>
      {(task.error || stalled) && (
        <p className="text-sm text-alert-text" role="status">
          {stalled ? 'The analysis stopped responding. Resume to continue where it left off.' : task.error}
        </p>
      )}
    </div>
  )
}
