import * as React from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Bookmark, Check, ChevronDown, EyeOff, FileSearch, PenLine, Pencil, Square, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Field, Select, Textarea } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { Checklist } from '@/components/ui/checklist'
import { useBooks, useChapters } from '@/hooks/queries'
import { findModel, formatUsd } from '@/lib/ai/catalog'
import {
  acceptRevision,
  estimateReview,
  getReviewTask,
  listReviewFindings,
  rejectRevision,
  REVIEW_TYPES,
  setReviewStatus,
  startReview,
  stopReview,
  type EditorialFinding,
  type ReviewType,
  type Revision,
} from '@/services/editorial'
import { estimateContinuity, FINDING_STATUSES, type FindingStatus } from '@/services/story'
import { cn, formatNumber, formatRelative, labelize } from '@/lib/utils'

const SEVERITY_TONE = { critical: 'alert', warning: 'alert', suggestion: 'info' } as const
const SEVERITY_ORDER = { critical: 0, warning: 1, suggestion: 2 }

export function EditorialPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const books = useBooks()
  const bookId = params.get('book') || books.data?.[0]?.id || ''
  const type = (REVIEW_TYPES.find((r) => r.id === params.get('type'))?.id ?? 'developmental') as ReviewType
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    next.set(k, v)
    if (k === 'book' && !next.get('type')) next.set('type', type)
    setParams(next, { replace: true })
  }
  const chapters = useChapters(bookId)
  const [scope, setScope] = React.useState<'book' | 'chapters'>('book')
  const [chapterIds, setChapterIds] = React.useState<string[]>([])
  const picked = scope === 'chapters' ? chapterIds : null
  React.useEffect(() => setChapterIds([]), [bookId])

  const task = useQuery({
    queryKey: ['review-task', bookId, type],
    queryFn: () => getReviewTask(bookId, type),
    enabled: Boolean(bookId),
    refetchInterval: (q) => (q.state.data?.status === 'running' || q.state.data?.status === 'queued' ? 3000 : false),
  })
  const running = task.data?.status === 'running'
  const estimate = useQuery({
    queryKey: ['review-estimate', bookId, type, picked?.join(','), task.data?.status],
    queryFn: async () => {
      if (type !== 'continuity') return estimateReview(bookId, type, picked)
      const e = await estimateContinuity(bookId)
      return { chapters: e.chaptersToCheck, words: 0, estimatedCostUsd: e.estimatedCostUsd, route: e.route, allowed: e.allowed, reason: e.reason }
    },
    enabled: Boolean(bookId) && !running && (scope === 'book' || chapterIds.length > 0),
  })
  const findings = useQuery({
    queryKey: ['review-findings', bookId, type, task.data?.status, task.data?.output?.findings],
    queryFn: () => listReviewFindings(bookId, type),
    enabled: Boolean(bookId),
  })
  const [status, setStatus] = React.useState<FindingStatus>('open')
  const [severity, setSeverity] = React.useState('')
  const [chapterFilter, setChapterFilter] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function run(action: 'start' | 'resume') {
    setBusy(true)
    try {
      await startReview(bookId, type, action, action === 'start' ? picked : null)
      toast.success('Review started. You can leave this page; it keeps running.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the review')
    } finally {
      setBusy(false)
      setTimeout(() => void task.refetch(), 800)
      setTimeout(() => void task.refetch(), 2500)
    }
  }

  const t = task.data
  const e = estimate.data
  const stalled =
    running &&
    (!t!.locked_at || Date.now() - new Date(t!.locked_at).getTime() > 5 * 60 * 1000) &&
    Date.now() - new Date(t!.updated_at).getTime() > 60_000
  const all = findings.data ?? []
  const counts = Object.fromEntries(FINDING_STATUSES.map((s) => [s.id, all.filter((f) => f.status === s.id).length]))
  const shown = all
    .filter((f) => f.status === status && (!severity || f.severity === severity) && (!chapterFilter || f.chapter_id === chapterFilter))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.created_at.localeCompare(b.created_at))
  const info = REVIEW_TYPES.find((r) => r.id === type)!
  const chapterTitle = new Map((chapters.data ?? []).map((c) => [c.id, c.title]))

  return (
    <PageBody>
      <PageHeader eyebrow="Revision" title="Editorial Studio">
        AI editorial reviews of a chapter or the whole book. Every finding shows the passage it is about. Suggested revisions are applied only when
        you approve them, one at a time, and the scene before the change is kept as a version.
      </PageHeader>

      {books.isLoading ? (
        <Spinner />
      ) : !books.data?.length ? (
        <EmptyState icon={<FileSearch />} title="No books yet">
          Add a book to your library first.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Book" htmlFor="ed-book" className="w-full max-w-sm">
              <Select id="ed-book" value={bookId} onChange={(ev) => setParam('book', ev.target.value)}>
                {books.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div role="tablist" aria-label="Review type" className="flex flex-wrap gap-2">
            {REVIEW_TYPES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={type === r.id}
                onClick={() => setParam('type', r.id)}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-semibold',
                  type === r.id ? 'border-ring bg-ai-soft text-fg' : 'border-line text-fg-muted hover:bg-panel-2 hover:text-fg',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          <Card>
            <CardHeader title={`${info.label} review`} action={<Badge tone="ai">Uses AI</Badge>} />
            <div className="space-y-4 px-5 pb-5 text-sm">
              <p className="text-fg-muted">{info.blurb}</p>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Review</legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="ed-scope"
                      className="accent-[var(--action)]"
                      checked={scope === 'book'}
                      onChange={() => setScope('book')}
                    />{' '}
                    The whole book
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="ed-scope"
                      className="accent-[var(--action)]"
                      checked={scope === 'chapters'}
                      onChange={() => setScope('chapters')}
                    />{' '}
                    Chosen chapters
                  </label>
                </div>
                {scope === 'chapters' && (
                  <Checklist
                    label="Chapters"
                    className="max-w-xl"
                    options={(chapters.data ?? []).map((c, i) => ({ id: c.id, label: `${i + 1}. ${c.title}` }))}
                    value={chapterIds}
                    onChange={setChapterIds}
                    empty="This book has no chapters yet."
                  />
                )}
              </fieldset>

              {t && (
                <div className="space-y-1 rounded-lg border border-line p-4" data-testid="review-progress">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={t.status === 'completed' ? 'progress' : running && !stalled ? 'ai' : 'alert'} data-testid="review-status">
                      {stalled
                        ? 'Interrupted'
                        : {
                            queued: 'Starting',
                            running: 'Reviewing',
                            paused: 'Paused',
                            completed: 'Complete',
                            failed: 'Stopped with problems',
                            cancelled: 'Stopped',
                          }[t.status]}
                    </Badge>
                    <span className="text-fg-muted">
                      {formatNumber(t.output?.done?.length ?? 0)} of {formatNumber(t.output?.chapters_total ?? 0)} chapters · cost{' '}
                      {formatUsd(Number(t.actual_cost_usd ?? 0))}
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted">
                    {formatNumber(t.output?.findings ?? 0)} new findings
                    {t.output?.unverified_dropped
                      ? `. ${t.output.unverified_dropped} left out because their passage could not be found in the text`
                      : ''}
                    {t.completed_at ? `. Finished ${formatRelative(t.completed_at)}` : ''}.
                  </p>
                  {(t.error || stalled) && (
                    <p className="text-alert-text">{stalled ? 'The review stopped responding. Resume to continue.' : t.error}</p>
                  )}
                </div>
              )}
              {estimate.isFetching && !e && <Spinner label="Estimating" />}
              {estimate.error && <ErrorState error={estimate.error} onRetry={() => void estimate.refetch()} />}
              {e && !running && (
                <p className="text-fg-muted" data-testid="review-estimate">
                  Reviews {formatNumber(e.chapters)} {e.chapters === 1 ? 'chapter' : 'chapters'}
                  {e.words ? ` (${formatNumber(e.words)} words)` : ''}
                  {e.route ? ` with ${findModel(e.route.provider, e.route.model)?.label ?? e.route.model}` : ''}. Estimated cost{' '}
                  <strong className="text-fg">{formatUsd(e.estimatedCostUsd)}</strong>.
                </p>
              )}
              {e?.reason && !running && (
                <p
                  role="alert"
                  className={cn(
                    'flex gap-2 rounded-lg border p-3',
                    e.allowed ? 'border-line bg-panel-2 text-fg' : 'border-alert bg-alert-soft text-alert-text',
                  )}
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {e.reason}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {(!running || stalled) && (
                  <Button
                    variant="ai"
                    disabled={busy || !e?.allowed || (scope === 'chapters' && !chapterIds.length)}
                    onClick={() => void run('start')}
                  >
                    <FileSearch /> {t ? 'Run a new review' : 'Start review'}
                  </Button>
                )}
                {t && (['paused', 'failed', 'cancelled'].includes(t.status) || stalled) && (
                  <Button variant="secondary" disabled={busy} onClick={() => void run('resume')}>
                    Resume review
                  </Button>
                )}
                {running && !stalled && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await stopReview(t!.id).catch((err) => toast.error(err.message))
                      void task.refetch()
                    }}
                  >
                    <Square /> Stop
                  </Button>
                )}
              </div>
              <p className="text-xs text-fg-faint">A new review keeps every finding you already reviewed and never repeats one.</p>
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
                    className={cn(
                      '-mb-px border-b-2 px-3 pb-3 text-sm font-semibold',
                      status === s.id ? 'border-ring text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                    )}
                  >
                    {s.id === 'accepted' ? 'Accepted' : s.label} <span className="font-normal text-fg-muted">{counts[s.id]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-4">
                <Field label="Severity" htmlFor="ed-severity" className="w-48">
                  <Select id="ed-severity" value={severity} onChange={(ev) => setSeverity(ev.target.value)}>
                    <option value="">All</option>
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="suggestion">Suggestion</option>
                  </Select>
                </Field>
                <Field label="Chapter" htmlFor="ed-chapter" className="w-64">
                  <Select id="ed-chapter" value={chapterFilter} onChange={(ev) => setChapterFilter(ev.target.value)}>
                    <option value="">All chapters</option>
                    {(chapters.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {findings.isLoading ? (
                <Spinner />
              ) : findings.error ? (
                <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />
              ) : !shown.length ? (
                <EmptyState title={status === 'open' ? 'No open findings' : 'Nothing here'}>
                  {status === 'open' && t?.status === 'completed' ? 'The last review found nothing else to raise.' : null}
                </EmptyState>
              ) : (
                <ul className="space-y-3" data-testid="findings">
                  {shown.map((f) => (
                    <FindingCard
                      key={f.id}
                      f={f}
                      bookId={bookId}
                      chapter={f.chapter_id ? chapterTitle.get(f.chapter_id) : undefined}
                      continuity={type === 'continuity'}
                      onChanged={() => qc.invalidateQueries({ queryKey: ['review-findings', bookId, type] })}
                    />
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

function FindingCard({
  f,
  bookId,
  chapter,
  continuity,
  onChanged,
}: {
  f: EditorialFinding
  bookId: string
  chapter?: string
  continuity: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = React.useState(!continuity)
  const [busy, setBusy] = React.useState(false)
  const rev: Revision | undefined = f.revision_proposals.find((r) => r.status === 'pending') ?? f.revision_proposals[0]
  const pending = rev?.status === 'pending'
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(rev?.proposed_text ?? '')
  const act = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(msg)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update')
    } finally {
      setBusy(false)
    }
  }
  const sceneLink = f.scene_id ? `/books/${bookId}/write?scene=${f.scene_id}` : f.chapter_id ? `/books/${bookId}/write?chapter=${f.chapter_id}` : null
  const location = continuity ? (f.conflicting_location ?? 'Story Bible') : (f.original_location ?? chapter ?? '')

  return (
    <li data-testid="finding">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={SEVERITY_TONE[f.severity]}>{labelize(f.severity)}</Badge>
          {f.category && <Badge>{labelize(f.category)}</Badge>}
          {rev && (
            <Badge tone={pending ? 'ai' : 'neutral'}>
              {pending
                ? 'Revision suggested'
                : `Revision ${rev.status === 'edited' ? 'edited and applied' : rev.status === 'accepted' ? 'applied' : rev.status}`}
            </Badge>
          )}
          <span className="text-fg-muted">{location}</span>
        </div>
        <p className="mt-2 text-sm text-fg">{f.description}</p>
        <button type="button" className="link mt-2 inline-flex items-center gap-1 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden /> {open ? 'Hide' : 'Show'} passage
        </button>
        {open && (
          <div className="mt-3 space-y-3 text-sm" data-testid="finding-evidence">
            {continuity ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <figure className="rounded-lg bg-panel-2 p-3">
                  <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Established ({f.original_location ?? 'canon'})
                  </figcaption>
                  <p className="whitespace-pre-wrap font-serif">{f.original_evidence}</p>
                </figure>
                <figure className="rounded-lg bg-alert-soft p-3">
                  <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-alert-text">
                    Conflicts ({f.conflicting_location ?? 'this book'})
                  </figcaption>
                  <blockquote className="font-serif italic">"{f.conflicting_evidence}"</blockquote>
                </figure>
              </div>
            ) : (
              <figure className="rounded-lg bg-panel-2 p-3">
                <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Passage ({location})</figcaption>
                <blockquote className="font-serif">"{f.original_evidence}"</blockquote>
              </figure>
            )}
            {rev && (
              <figure className="rounded-lg border border-ring/40 bg-ai-soft p-3" data-testid="revision">
                <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Suggested revision</figcaption>
                {editing ? (
                  <Field label="Your version" htmlFor={`rev-${f.id}`}>
                    <Textarea id={`rev-${f.id}`} rows={4} value={draft} onChange={(ev) => setDraft(ev.target.value)} className="font-serif" />
                  </Field>
                ) : (
                  <p className="whitespace-pre-wrap font-serif">{rev.proposed_text}</p>
                )}
              </figure>
            )}
            {f.suggested_resolution && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{continuity ? 'Suggested fix' : 'Why'}</p>
                <p>{f.suggested_resolution}</p>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {pending && (f.status === 'open' || f.status === 'saved_for_later') ? (
            <>
              <Button
                size="sm"
                disabled={busy || (editing && !draft.trim())}
                onClick={() =>
                  void act(
                    () => acceptRevision(f.id, rev!, editing ? draft : undefined),
                    'Revision applied. The previous text is saved in the scene history.',
                  )
                }
              >
                <ThumbsUp /> {editing ? 'Apply my version' : 'Approve revision'}
              </Button>
              {!editing && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setOpen(true)
                    setDraft(rev!.proposed_text)
                    setEditing(true)
                  }}
                >
                  <Pencil /> Edit
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void act(() => rejectRevision(f.id, rev!), 'Revision rejected. Your text is unchanged.')}
              >
                <ThumbsDown /> Reject
              </Button>
            </>
          ) : f.status === 'open' || f.status === 'saved_for_later' ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void act(() => setReviewStatus(f.id, 'accepted'), 'Accepted. Make the change in the manuscript when you are ready.')}
              >
                <Check /> Accept note
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void act(() => setReviewStatus(f.id, 'intentional'), 'Marked intentional')}
              >
                <Check /> Mark intentional
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => setReviewStatus(f.id, 'dismissed'), 'Dismissed')}>
                <X /> Dismiss
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || rev?.status === 'accepted' || rev?.status === 'edited'}
              onClick={() => void act(() => setReviewStatus(f.id, 'open'), 'Reopened')}
            >
              <EyeOff /> Reopen
            </Button>
          )}
          {f.status === 'open' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void act(() => setReviewStatus(f.id, 'saved_for_later'), 'Saved for later')}
            >
              <Bookmark /> Save for later
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
