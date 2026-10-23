import * as React from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Library, Link2, ShieldCheck, Square, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { findModel, formatUsd } from '@/lib/ai/catalog'
import { cn, formatNumber, formatRelative } from '@/lib/utils'
import { FindingCard } from '@/pages/ContinuityPage'
import { getSeriesTask, linkCharacters, listSeriesFindings, scanSeries, startSeriesReview, stopSeriesReview } from '@/services/series'

/** Book 2 against book 1: shared characters, their details, and continuity with the earlier books. */
export function SeriesReview({ bookId }: { bookId: string }) {
  const qc = useQueryClient()
  const task = useQuery({
    queryKey: ['series-task', bookId],
    queryFn: () => getSeriesTask(bookId),
    refetchInterval: (q) => (q.state.data?.status === 'running' || q.state.data?.status === 'queued' ? 3000 : false),
  })
  const running = task.data?.status === 'running'
  const scan = useQuery({ queryKey: ['series-scan', bookId, task.data?.status], queryFn: () => scanSeries(bookId), enabled: !running })
  const findings = useQuery({
    queryKey: ['series-findings', bookId, task.data?.id, task.data?.status, task.data?.output?.findings],
    queryFn: () => listSeriesFindings(bookId, task.data!.id),
    enabled: Boolean(task.data?.id),
  })
  const [picked, setPicked] = React.useState<string[] | null>(null)
  const [chapters, setChapters] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [showAll, setShowAll] = React.useState(false)

  const s = scan.data
  const shared = s?.shared ?? []
  const mentioned = shared.filter((c) => c.mentions > 0)
  const chosen = picked ?? mentioned.map((c) => c.id)
  const unlinked = shared.filter((c) => !c.linked && c.mentions > 0)
  const t = task.data
  const stalled =
    running &&
    (!t!.locked_at || Date.now() - new Date(t!.locked_at).getTime() > 5 * 60 * 1000) &&
    Date.now() - new Date(t!.updated_at).getTime() > 60_000
  const e = s?.estimate
  // The estimate covers every shared character; scale it to the ones chosen.
  const perChar = e && e.characters + e.chapters ? e.costUsd / (e.characters + e.chapters) : 0
  const cost = e ? perChar * (chosen.filter((id) => mentioned.some((m) => m.id === id)).length + (chapters ? e.chapters : 0)) : 0
  const nothingChosen = !chosen.length && !(chapters && e?.chapters)

  async function run(action: 'start' | 'resume') {
    setBusy(true)
    try {
      await startSeriesReview(bookId, action, picked, chapters)
      toast.success('Series review started. You can leave this page; it keeps running.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the review')
    } finally {
      setBusy(false)
      setTimeout(() => void task.refetch(), 800)
      setTimeout(() => void task.refetch(), 2500)
    }
  }

  async function link() {
    setBusy(true)
    try {
      await linkCharacters(
        bookId,
        unlinked.map((c) => c.id),
      )
      toast.success(`${unlinked.length} ${unlinked.length === 1 ? 'character is' : 'characters are'} now linked to this book.`)
      void qc.invalidateQueries({ queryKey: ['series-scan', bookId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not link the characters')
    } finally {
      setBusy(false)
    }
  }

  if (scan.isLoading && !s) return <Spinner label="Reading the series" />
  if (scan.error) return <ErrorState error={scan.error} onRetry={() => void scan.refetch()} />

  if (s && !s.series.length)
    return (
      <EmptyState icon={<Library />} title="This book is not in a series">
        Add it to a series in{' '}
        <Link to="/series" className="link">
          Series & Universes
        </Link>{' '}
        and set its place in the reading order. Then this review compares it with the books that come before it.
      </EmptyState>
    )
  if (s && !s.earlier.length)
    return (
      <EmptyState icon={<Library />} title="No earlier books in the series">
        {s.book.title} is first in reading order in {s.series.map((x) => x.name).join(' and ')}. Set the reading order in{' '}
        <Link to="/series" className="link">
          Series & Universes
        </Link>{' '}
        so it comes after the books it continues.
      </EmptyState>
    )

  const visible = showAll ? shared : shared.slice(0, 12)
  const all = findings.data ?? []
  const open = all.filter((f) => f.status === 'open' || f.status === 'saved_for_later')

  return (
    <div className="space-y-6" data-testid="series-review">
      {s && (
        <Card>
          <CardHeader title="Earlier books" />
          <div className="space-y-3 px-5 pb-5 text-sm">
            <p className="text-fg-muted">
              {s.book.title} is compared with the books before it in {s.series.map((x) => x.name).join(' and ')}: their text, their characters'
              profiles and their approved canon.
            </p>
            <ul className="divide-y divide-line rounded-lg border border-line" data-testid="earlier-books">
              {s.earlier.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="font-semibold text-fg">
                      {b.order != null ? `${b.order}. ` : ''}
                      {b.title}
                    </span>
                    <span className="text-fg-muted">
                      {' '}
                      · {formatNumber(b.words)} words · {formatNumber(b.approvedFacts)} approved canon facts
                    </span>
                  </span>
                  {b.pendingFacts > 0 && (
                    <Link to={`/books/${b.id}?tab=analysis`} className="link text-xs">
                      {formatNumber(b.pendingFacts)} discoveries waiting for review
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {s.earlier.some((b) => b.pendingFacts > 0) && (
              <p className="text-xs text-fg-muted">
                Approving waiting discoveries adds them to canon, so every later check can use them. The review below reads the earlier books' text
                either way.
              </p>
            )}
          </div>
        </Card>
      )}

      {s && (
        <Card>
          <CardHeader title="Characters from earlier books" action={<Badge>Free</Badge>} />
          <div className="space-y-4 px-5 pb-5 text-sm">
            {!shared.length ? (
              <p className="text-fg-muted">No characters from the earlier books are mentioned in {s.book.title} yet.</p>
            ) : (
              <>
                <p className="text-fg-muted">
                  {formatNumber(mentioned.length)} {mentioned.length === 1 ? 'character' : 'characters'} from earlier books{' '}
                  {mentioned.length === 1 ? 'appears' : 'appear'} in this book. Tick the ones to review.
                </p>
                <fieldset>
                  <legend className="sr-only">Characters to review</legend>
                  <ul className="divide-y divide-line rounded-lg border border-line" data-testid="shared-characters">
                    {visible.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <label className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--action)]"
                            disabled={!c.mentions}
                            checked={chosen.includes(c.id)}
                            onChange={(ev) => setPicked(ev.target.checked ? [...chosen, c.id] : chosen.filter((id) => id !== c.id))}
                          />
                          <span className="font-semibold text-fg">{c.name}</span>
                        </label>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                          <span>
                            {formatNumber(c.mentions)} {c.mentions === 1 ? 'mention' : 'mentions'} here · in {c.earlierBooks.join(', ')}
                            {c.facts ? ` · ${formatNumber(c.facts)} canon facts` : ''}
                          </span>
                          {c.linked ? <Badge tone="progress">Linked</Badge> : <Badge>Not linked</Badge>}
                          <Link to={`/characters/${c.id}`} className="link">
                            Profile
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                {shared.length > 12 && (
                  <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
                    {showAll ? 'Show fewer' : `Show all ${shared.length}`}
                  </Button>
                )}
                {unlinked.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel-2 p-3">
                    <p className="flex-1">
                      {unlinked.length} of them {unlinked.length === 1 ? 'is' : 'are'} not linked to {s.book.title} in the Character Bible. Linking
                      adds this book to their profile, so writing help and checks for this book use their details.
                    </p>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void link()}>
                      <Link2 /> Link {unlinked.length} to this book
                    </Button>
                  </div>
                )}
              </>
            )}
            {s.duplicates.length > 0 && (
              <div role="alert" className="flex gap-2 rounded-lg border border-alert bg-alert-soft p-3 text-alert-text" data-testid="duplicates">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-semibold">Possible duplicate character records</p>
                  <p>
                    {s.duplicates.map((d) => `${d.name} (${d.ids.length} records)`).join(', ')}. Two records for one person can hold different
                    details. Open the{' '}
                    <Link to="/characters" className="link">
                      Character Bible
                    </Link>{' '}
                    to compare them and keep one.
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Review against the earlier books" action={<Badge tone="ai">Uses AI</Badge>} />
        <div className="space-y-4 px-5 pb-5 text-sm">
          <p className="text-fg-muted">
            Checks that each chosen character matches their profile, approved canon and how the earlier books wrote them, then checks every chapter
            against the passages in earlier books that mention the same people and places. Every finding quotes both books. Nothing in your books
            changes.
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-[var(--action)]" checked={chapters} onChange={(ev) => setChapters(ev.target.checked)} />{' '}
            Also check each chapter against the earlier books
          </label>
          {t && (
            <div className="space-y-1 rounded-lg border border-line p-4" data-testid="series-progress">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={t.status === 'completed' ? 'progress' : running && !stalled ? 'ai' : 'alert'} data-testid="series-status">
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
                  {formatNumber(t.output?.done?.length ?? 0)} of {formatNumber(t.output?.steps_total ?? 0)} parts · cost{' '}
                  {formatUsd(Number(t.actual_cost_usd ?? 0))}
                </span>
              </div>
              {running && t.output?.current && <p className="text-xs text-fg-muted">Now checking: {t.output.current}</p>}
              <p className="text-xs text-fg-muted">
                {formatNumber(t.output?.findings ?? 0)} findings
                {t.output?.unverified_dropped ? `. ${t.output.unverified_dropped} left out because a quote could not be found in either book` : ''}
                {t.completed_at ? `. Finished ${formatRelative(t.completed_at)}` : ''}.
              </p>
              {(t.error || stalled) && <p className="text-alert-text">{stalled ? 'The review stopped responding. Resume to continue.' : t.error}</p>}
            </div>
          )}
          {e && !running && (
            <p className="text-fg-muted" data-testid="series-estimate">
              Reviews {formatNumber(chosen.length)} {chosen.length === 1 ? 'character' : 'characters'}
              {chapters ? ` and ${formatNumber(e.chapters)} ${e.chapters === 1 ? 'chapter' : 'chapters'}` : ''}
              {e.route ? ` with ${findModel(e.route.provider, e.route.model)?.label ?? e.route.model}` : ''}. Estimated cost{' '}
              <strong className="text-fg">{formatUsd(cost)}</strong>.
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
              <Button variant="ai" disabled={busy || !e?.allowed || nothingChosen} onClick={() => void run('start')}>
                <Users /> {t ? 'Review again' : 'Review against earlier books'}
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
                  await stopSeriesReview(t!.id).catch((err) => toast.error(err.message))
                  void task.refetch()
                }}
              >
                <Square /> Stop
              </Button>
            )}
          </div>
          <p className="text-xs text-fg-faint">Reviewing again never repeats a finding you have already seen.</p>
        </div>
      </Card>

      {t && (
        <Card>
          <CardHeader
            title={`Findings${all.length ? ` (${open.length} open)` : ''}`}
            action={
              <Link to={`/continuity?book=${bookId}`} className="link inline-flex items-center gap-1 text-sm">
                <ShieldCheck className="size-4" aria-hidden /> All continuity findings
              </Link>
            }
          />
          <div className="px-5 pb-5">
            {findings.isLoading ? (
              <Spinner />
            ) : findings.error ? (
              <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />
            ) : !open.length ? (
              <EmptyState title="No open findings">
                {t.status === 'completed' ? 'This book agrees with the earlier books everywhere the review looked.' : null}
              </EmptyState>
            ) : (
              <ul className="space-y-3" data-testid="findings">
                {open.map((f) => (
                  <FindingCard key={f.id} f={f} bookId={bookId} onChanged={() => qc.invalidateQueries({ queryKey: ['series-findings', bookId] })} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
