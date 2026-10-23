import * as React from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Bookmark, Check, ChevronDown, EyeOff, PenLine, RotateCcw, ShieldCheck, Square, Wand2, X } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Field, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { useBooks } from '@/hooks/queries'
import { findModel, formatUsd } from '@/lib/ai/catalog'
import {
  estimateContinuity,
  FINDING_STATUSES,
  getContinuityTask,
  listFindings,
  setFindingStatus,
  startContinuity,
  stopContinuity,
  type Finding,
  type FindingStatus,
} from '@/services/story'
import { cn, formatNumber, formatRelative, labelize } from '@/lib/utils'

const SEVERITY_TONE = { critical: 'alert', warning: 'alert', suggestion: 'info' } as const
const SEVERITY_ORDER = { critical: 0, warning: 1, suggestion: 2 }

export function ContinuityPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const books = useBooks()
  const bookId = params.get('book') || books.data?.[0]?.id || ''
  const task = useQuery({
    queryKey: ['continuity-task', bookId],
    queryFn: () => getContinuityTask(bookId),
    enabled: Boolean(bookId),
    refetchInterval: (q) => (q.state.data?.status === 'running' || q.state.data?.status === 'queued' ? 3000 : false),
  })
  const estimate = useQuery({
    queryKey: ['continuity-estimate', bookId, task.data?.status],
    queryFn: () => estimateContinuity(bookId),
    enabled: Boolean(bookId) && task.data?.status !== 'running',
  })
  const findings = useQuery({ queryKey: ['findings', bookId, task.data?.status, task.data?.output?.findings], queryFn: () => listFindings(bookId), enabled: Boolean(bookId) })
  const [status, setStatus] = React.useState<FindingStatus>('open')
  const [severity, setSeverity] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function run(action: 'start' | 'resume' | 'restart') {
    setBusy(true)
    try {
      await startContinuity(bookId, action)
      toast.success('Continuity check started. You can leave this page; it keeps running.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the check')
    } finally {
      setBusy(false)
      setTimeout(() => void task.refetch(), 800)
      setTimeout(() => void task.refetch(), 2500)
    }
  }

  const t = task.data
  const e = estimate.data
  const stalled = t?.status === 'running' && (!t.locked_at || Date.now() - new Date(t.locked_at).getTime() > 5 * 60 * 1000) && Date.now() - new Date(t.updated_at).getTime() > 60_000
  const all = findings.data ?? []
  const counts = Object.fromEntries(FINDING_STATUSES.map((s) => [s.id, all.filter((f) => f.status === s.id).length]))
  const shown = all
    .filter((f) => f.status === status && (!severity || f.severity === severity))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.created_at.localeCompare(b.created_at))

  return (
    <PageBody>
      <PageHeader eyebrow="Story world" title="Continuity Checker">
        Compares a book's chapters with the approved canon of every book in its series and universe, and flags contradictions with both sides of the evidence. It never changes your text or your canon.
      </PageHeader>

      {books.isLoading ? (
        <Spinner />
      ) : !books.data?.length ? (
        <EmptyState icon={<ShieldCheck />} title="No books yet">
          Add a book to your library first.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <Field label="Book" htmlFor="ct-book" className="max-w-sm">
            <Select id="ct-book" value={bookId} onChange={(ev) => setParams({ book: ev.target.value }, { replace: true })}>
              {books.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </Select>
          </Field>

          <Card>
            <CardHeader title="Run a check" action={<Badge tone="ai">Uses AI</Badge>} />
            <div className="space-y-4 px-5 pb-5 text-sm">
              {t && (
                <div className="space-y-1 rounded-lg border border-line p-4" data-testid="continuity-progress">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={t.status === 'completed' ? 'progress' : t.status === 'running' && !stalled ? 'ai' : 'alert'} data-testid="continuity-status">
                      {stalled ? 'Interrupted' : { queued: 'Starting', running: 'Checking', paused: 'Paused', completed: 'Complete', failed: 'Stopped with problems', cancelled: 'Stopped' }[t.status]}
                    </Badge>
                    <span className="text-fg-muted">
                      {formatNumber(t.output?.done?.length ?? 0)} of {formatNumber(t.output?.chapters_total ?? 0)} chapters · cost {formatUsd(Number(t.actual_cost_usd ?? 0))}
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted">
                    {formatNumber(t.output?.findings ?? 0)} new findings
                    {t.output?.unverified_dropped ? `. ${t.output.unverified_dropped} left out because their quotes or canon could not be verified` : ''}
                    {t.completed_at ? `. Finished ${formatRelative(t.completed_at)}` : ''}.
                  </p>
                  {(t.error || stalled) && <p className="text-alert-text">{stalled ? 'The check stopped responding. Resume to continue.' : t.error}</p>}
                </div>
              )}
              {estimate.isLoading && t?.status !== 'running' && <Spinner label="Estimating" />}
              {estimate.error && <ErrorState error={estimate.error} onRetry={() => void estimate.refetch()} />}
              {e && t?.status !== 'running' && (
                <p className="text-fg-muted" data-testid="continuity-estimate">
                  Compares {formatNumber(e.chaptersToCheck)} of {formatNumber(e.chaptersTotal)} chapters against {formatNumber(e.canonFacts)} approved canon facts from{' '}
                  {e.relatedBooks} {e.relatedBooks === 1 ? 'book' : 'books'}
                  {e.route ? ` with ${findModel(e.route.provider, e.route.model)?.label ?? e.route.model}` : ''}. Estimated cost <strong className="text-fg">{formatUsd(e.estimatedCostUsd)}</strong>.
                  {e.chaptersWithoutCanon > 0 && ` ${e.chaptersWithoutCanon} ${e.chaptersWithoutCanon === 1 ? 'chapter mentions' : 'chapters mention'} nothing in canon and ${e.chaptersWithoutCanon === 1 ? 'is' : 'are'} skipped at no cost.`}
                </p>
              )}
              {e?.reason && t?.status !== 'running' && (
                <p role="alert" className={cn('flex gap-2 rounded-lg border p-3', e.allowed ? 'border-line bg-panel-2 text-fg' : 'border-alert bg-alert-soft text-alert-text')}>
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {e.reason}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {(!t || t.status === 'completed') && (
                  <Button variant="ai" disabled={busy || !e?.allowed} onClick={() => void run(t ? 'restart' : 'start')}>
                    <ShieldCheck /> {t ? 'Check again' : 'Check continuity'}
                  </Button>
                )}
                {t && (['paused', 'failed', 'cancelled'].includes(t.status) || stalled) && (
                  <>
                    <Button variant="ai" disabled={busy || !e?.allowed} onClick={() => void run('resume')}>
                      <ShieldCheck /> Resume check
                    </Button>
                    <Button variant="secondary" disabled={busy || !e?.allowed} onClick={() => void run('restart')}>
                      <RotateCcw /> Start over
                    </Button>
                  </>
                )}
                {t?.status === 'running' && !stalled && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await stopContinuity(t.id).catch((err) => toast.error(err.message))
                      void task.refetch()
                    }}
                  >
                    <Square /> Stop
                  </Button>
                )}
              </div>
              <p className="text-xs text-fg-faint">Checking again keeps every finding you already reviewed and never shows a dismissed one twice.</p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 pt-4">
              <h2 className="pb-3 text-sm font-bold tracking-wide">Findings</h2>
              <div role="tablist" aria-label="Finding status" className="flex flex-wrap gap-1">
                {FINDING_STATUSES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={status === s.id}
                    onClick={() => setStatus(s.id)}
                    className={cn('-mb-px border-b-2 px-3 pb-3 text-sm font-semibold', status === s.id ? 'border-ring text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
                  >
                    {s.label} <span className="font-normal text-fg-muted">{counts[s.id]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Severity" htmlFor="ct-severity" className="max-w-48">
                <Select id="ct-severity" value={severity} onChange={(ev) => setSeverity(ev.target.value)}>
                  <option value="">All</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="suggestion">Suggestion</option>
                </Select>
              </Field>
              {findings.isLoading ? (
                <Spinner />
              ) : findings.error ? (
                <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />
              ) : !shown.length ? (
                <EmptyState title={status === 'open' ? 'No open findings' : 'Nothing here'}>
                  {status === 'open' && t?.status === 'completed' ? 'No contradictions found in the last check.' : null}
                </EmptyState>
              ) : (
                <ul className="space-y-3" data-testid="findings">
                  {shown.map((f) => (
                    <FindingCard key={f.id} f={f} bookId={bookId} onChanged={() => qc.invalidateQueries({ queryKey: ['findings', bookId] })} />
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      )}
    </PageBody>
  )
}

function FindingCard({ f, bookId, onChanged }: { f: Finding; bookId: string; onChanged: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const act = async (s: FindingStatus, msg: string) => {
    setBusy(true)
    try {
      await setFindingStatus(f.id, s)
      toast.success(msg)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update')
    } finally {
      setBusy(false)
    }
  }
  const sceneLink = f.scene_id ? `/books/${bookId}/write?scene=${f.scene_id}` : f.chapter_id ? `/books/${bookId}/write?chapter=${f.chapter_id}` : null

  return (
    <li data-testid="finding">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-fg-faint" title="Finding ID">
            #{f.id.slice(0, 8)}
          </span>
          <Badge tone={SEVERITY_TONE[f.severity]}>{labelize(f.severity)}</Badge>
          {f.category && <Badge>{labelize(f.category)}</Badge>}
          <span className="text-fg-muted">{f.conflicting_location ?? 'Story Bible'}</span>
        </div>
        <p className="mt-2 text-sm text-fg">{f.description}</p>
        <button type="button" className="link mt-2 inline-flex items-center gap-1 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden /> View evidence
        </button>
        {open && (
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2" data-testid="finding-evidence">
            <figure className="rounded-lg bg-panel-2 p-3">
              <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Established ({f.original_location ?? 'canon'})</figcaption>
              <p className="whitespace-pre-wrap font-serif">{f.original_evidence}</p>
            </figure>
            <figure className="rounded-lg bg-alert-soft p-3">
              <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-alert-text">Conflicts ({f.conflicting_location ?? 'this book'})</figcaption>
              <blockquote className="font-serif italic">"{f.conflicting_evidence}"</blockquote>
            </figure>
            {f.suggested_resolution && (
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Suggested fix</p>
                <p>{f.suggested_resolution}</p>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {f.status === 'open' || f.status === 'saved_for_later' ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => void act('accepted', 'Fix accepted. Make the change in the manuscript when you are ready.')}>
                <Wand2 /> Accept suggested fix
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act('intentional', 'Marked intentional')}>
                <Check /> Mark intentional
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act('dismissed', 'Dismissed')}>
                <X /> Dismiss
              </Button>
              {f.status === 'open' && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('saved_for_later', 'Saved for later')}>
                  <Bookmark /> Save for later
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('open', 'Reopened')}>
              <EyeOff /> Reopen
            </Button>
          )}
          {sceneLink && (
            <Button size="sm" variant="ghost" asChild>
              <Link to={sceneLink}>
                <PenLine /> Open the scene
              </Link>
            </Button>
          )}
        </div>
      </Card>
    </li>
  )
}
