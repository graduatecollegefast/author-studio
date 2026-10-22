import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { BookOpen, BookPlus, FileText, PenLine, Upload } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { ErrorState, Spinner } from '@/components/ui/feedback'
import { BookCover } from '@/components/library/BookCover'
import { useBooks, useDailyStats, useDashboardStats, useLastEdited, useRecentUploads } from '@/hooks/queries'
import { usePreferences } from '@/contexts/PreferencesContext'
import { goalProgress, goalStreak, localDateString, netWords } from '@/services/progress'
import { useAuth } from '@/contexts/AuthContext'
import { formatBytes, formatNumber, formatRelative, labelize } from '@/lib/utils'

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-panel px-5 py-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="mt-1 font-serif text-3xl font-semibold text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-fg-muted">{hint}</div>}
    </div>
  )
}

function TodayCard() {
  const { prefs } = usePreferences()
  const daily = useDailyStats()
  const today = localDateString()
  const stats = daily.data ?? []
  const words = netWords(stats.find((d) => d.day === today))
  const goal = prefs.dailyWordGoal
  const progress = goalProgress(words, goal)
  const streak = goalStreak(stats, goal)
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const key = localDateString(d)
    return { key, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), words: netWords(stats.find((s) => s.day === key)) }
  })
  const max = Math.max(goal ?? 0, ...week.map((w) => w.words), 1)

  return (
    <Card>
      <CardHeader title="Today's writing" action={<Link to="/settings" className="link text-xs">{goal ? 'Change goal' : 'Set a daily goal'}</Link>} />
      <div className="px-5 pb-5">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-3xl font-semibold" data-testid="today-words">{formatNumber(words)}</span>
          <span className="text-sm text-fg-muted">{goal ? `of ${formatNumber(goal)} words` : 'words today'}</span>
        </div>
        {progress && (
          <>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-label="Daily word goal" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-progress" style={{ width: `${progress.pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-progress-text">
              {progress.met ? 'Goal reached today.' : `${formatNumber(goal! - words)} words to go.`}
              {streak > 1 ? ` ${streak}-day streak.` : ''}
            </p>
          </>
        )}
        <div className="mt-4 flex h-16 items-end gap-1.5" aria-label="Words written over the last 7 days" role="img">
          {week.map((w) => (
            <div key={w.key} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={goal && w.words >= goal ? 'w-full rounded-sm bg-progress' : 'w-full rounded-sm bg-control'}
                style={{ height: `${Math.max(2, Math.round((w.words / max) * 44))}px` }}
                title={`${w.key}: ${formatNumber(w.words)} words`}
              />
              <span className="text-[10px] text-fg-muted">{w.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const stats = useDashboardStats()
  const books = useBooks()
  const last = useLastEdited()
  const uploads = useRecentUploads()

  const live = (books.data ?? []).filter((b) => !b.archived_at)
  const active = live.filter((b) => ['drafting', 'revising', 'editing'].includes(b.writing_status)).slice(0, 4)
  const recent = [...live]
    .filter((b) => b.last_opened_at)
    .sort((a, b) => b.last_opened_at!.localeCompare(a.last_opened_at!))
    .slice(0, 5)
  const name = (user?.user_metadata?.display_name as string | undefined) ?? user?.email?.split('@')[0]
  const lastScene = last.data && !last.data.books?.archived_at ? last.data : null

  return (
    <PageBody>
      <PageHeader
        eyebrow={greeting()}
        title={name ? `Welcome back, ${name}` : 'Welcome back'}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/library?upload=1')}>
              <Upload /> Upload existing book
            </Button>
            <Button onClick={() => navigate('/library?new=1')}>
              <BookPlus /> Create new book
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
      {/* Continue writing */}
      <Card className="overflow-hidden lg:col-span-2">
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-fg-muted">Continue writing</div>
            {last.isLoading ? (
              <Spinner className="mt-2" />
            ) : lastScene ? (
              <>
                <div className="mt-1 font-serif text-2xl font-semibold">{lastScene.books?.title}</div>
                <div className="text-sm text-fg-muted">
                  {lastScene.chapters?.title} · {lastScene.title} · edited {formatRelative(lastScene.last_edited_at)}
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm text-fg-muted">Nothing written yet. Create a book and add a chapter to begin.</div>
            )}
          </div>
          {lastScene && (
            <Button size="lg" asChild>
              <Link to={`/books/${lastScene.book_id}/write?scene=${lastScene.id}`}>
                <PenLine /> Continue writing
              </Link>
            </Button>
          )}
        </div>
      </Card>

      <TodayCard />
      </div>

      {/* Stats */}
      {stats.error ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Words written" value={stats.data ? formatNumber(stats.data.totalWords) : '...'} hint="Across all active books" />
          <Stat label="Books" value={stats.data ? stats.data.totalBooks : '...'} hint={stats.data ? `${stats.data.activeBooks} in progress` : undefined} />
          <Stat label="Chapters" value={stats.data ? stats.data.chapters : '...'} />
          <Stat
            label="AI spend this month"
            value={stats.data ? `$${stats.data.aiSpendThisMonth.toFixed(2)}` : '...'}
            hint="AI features arrive in Phase 2"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Active manuscripts" action={<Link to="/library?status=drafting" className="text-xs font-semibold link">View all</Link>} />
          <div className="px-5 pb-5">
            {books.isLoading ? (
              <Spinner />
            ) : active.length === 0 ? (
              <p className="py-6 text-sm text-fg-muted">No books are marked drafting, revising, or editing.</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {active.map((b) => {
                  const pct = b.target_word_count ? Math.min(100, Math.round((b.word_count / b.target_word_count) * 100)) : null
                  return (
                    <li key={b.id}>
                      <Link to={`/books/${b.id}`} className="flex gap-3 rounded-lg p-2 hover:bg-panel-2">
                        <div className="w-14 shrink-0">
                          <BookCover book={b} compact />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-serif font-semibold">{b.title}</div>
                          <Badge tone="info" className="mt-1">
                            {labelize(b.writing_status)}
                          </Badge>
                          <div className="mt-2 text-xs text-fg-muted">
                            {formatNumber(b.word_count)} {b.target_word_count ? `/ ${formatNumber(b.target_word_count)}` : ''} words
                          </div>
                          {pct !== null && (
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-2">
                              <div className="h-full bg-progress" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recently opened" />
          <div className="px-5 pb-5">
            {books.isLoading ? (
              <Spinner />
            ) : recent.length === 0 ? (
              <p className="py-6 text-sm text-fg-muted">Books you open will appear here.</p>
            ) : (
              <ul className="space-y-1">
                {recent.map((b) => (
                  <li key={b.id}>
                    <Link to={`/books/${b.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-panel-2">
                      <BookOpen className="size-4 text-fg-faint" aria-hidden />
                      <span className="flex-1 truncate">{b.title}</span>
                      <span className="text-xs text-fg-faint">{formatRelative(b.last_opened_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Recent uploads" />
          <div className="px-5 pb-5">
            {uploads.isLoading ? (
              <Spinner />
            ) : uploads.error ? (
              <ErrorState error={uploads.error} onRetry={() => void uploads.refetch()} />
            ) : !uploads.data?.length ? (
              <p className="py-6 text-sm text-fg-muted">No manuscripts uploaded yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {uploads.data.map((u) => (
                  <li key={u.id}>
                    <Link to={`/books/${u.book_id}?tab=files`} className="flex items-center gap-3 py-2.5 text-sm hover:link">
                      <FileText className="size-4 text-fg-faint" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {u.original_name}
                        <span className="text-fg-faint"> · {u.books?.title}</span>
                      </span>
                      <span className="hidden text-xs text-fg-faint sm:inline">{formatBytes(u.size_bytes)}</span>
                      <Badge tone={u.upload_status === 'validated' ? 'progress' : u.upload_status === 'rejected' || u.upload_status === 'failed' ? 'alert' : 'neutral'}>
                        {labelize(u.upload_status)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Story intelligence" />
          <dl className="space-y-3 px-5 pb-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">AI analysis running</dt>
              <dd className="font-semibold">{stats.data?.runningAiTasks ?? '...'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Open clarification questions</dt>
              <dd className="font-semibold">{stats.data?.openQuestions ?? '...'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Unresolved continuity warnings</dt>
              <dd className="font-semibold">{stats.data?.openContinuityWarnings ?? '...'}</dd>
            </div>
          </dl>
          <p className="px-5 pb-5 text-xs text-fg-faint">Analysis, questions, and continuity checks start in Phases 2 and 3.</p>
        </Card>
      </div>
    </PageBody>
  )
}
