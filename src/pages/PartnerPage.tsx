import { useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Field, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { CreativePartner } from '@/components/partner/CreativePartner'
import { QuestionCard } from '@/components/partner/QuestionCard'
import { StyleProfiles } from '@/components/partner/StyleProfiles'
import { SeriesReview } from '@/components/partner/SeriesReview'
import { useBooks } from '@/hooks/queries'
import { listQuestions, type Question } from '@/services/writing'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'partner', label: 'Creative Partner' },
  { id: 'series', label: 'Series review' },
  { id: 'questions', label: 'Questions' },
  { id: 'style', label: 'Style profiles' },
] as const
type Tab = (typeof TABS)[number]['id']

const Q_FILTERS: Array<{ id: string; label: string; match: (q: Question) => boolean }> = [
  { id: 'open', label: 'Open', match: (q) => q.status === 'open' },
  { id: 'later', label: 'Saved for later', match: (q) => q.status === 'saved_for_later' },
  { id: 'decided', label: 'Answered and decided', match: (q) => q.status === 'answered' || q.status === 'ai_decided' },
  { id: 'skipped', label: 'Skipped', match: (q) => q.status === 'skipped' },
]

export function PartnerPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'partner'
  const books = useBooks()
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const bookId = params.get('book') || (tab === 'partner' || tab === 'series' ? books.data?.[0]?.id : '') || ''
  const book = books.data?.find((b) => b.id === bookId)

  return (
    <PageBody>
      <PageHeader eyebrow="AI" title="AI Writing Partner">
        Plan and draft whole books with the AI, answer the questions it needs to write well, and teach it your voice.
      </PageHeader>
      <div role="tablist" aria-label="Writing partner sections" className="mb-6 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => set('tab', t.id === 'partner' ? '' : t.id)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold',
              tab === t.id ? 'border-ring text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'style' ? (
          <StyleProfiles />
        ) : books.isLoading ? (
          <Spinner />
        ) : books.error ? (
          <ErrorState error={books.error} onRetry={() => void books.refetch()} />
        ) : !books.data?.length ? (
          <EmptyState icon={<MessageSquareText />} title="No books yet">
            Create a book in your library first.
          </EmptyState>
        ) : (
          <div className="space-y-6">
            <Field label="Book" htmlFor="partner-book" className="max-w-sm">
              <Select id="partner-book" value={bookId} onChange={(e) => set('book', e.target.value)}>
                {tab === 'questions' && <option value="">All books</option>}
                {books.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </Select>
            </Field>
            {tab === 'partner' && book && <CreativePartner key={book.id} bookId={book.id} bookTitle={book.title} />}
            {tab === 'series' && book && <SeriesReview key={book.id} bookId={book.id} />}
            {tab === 'questions' && (
              <QuestionsInbox
                bookId={bookId}
                titles={new Map(books.data.map((b) => [b.id, b.title]))}
                filter={params.get('show') ?? 'open'}
                onFilter={(v) => set('show', v === 'open' ? '' : v)}
              />
            )}
          </div>
        )}
      </div>
    </PageBody>
  )
}

function QuestionsInbox({
  bookId,
  titles,
  filter,
  onFilter,
}: {
  bookId: string
  titles: Map<string, string>
  filter: string
  onFilter: (v: string) => void
}) {
  const qc = useQueryClient()
  const questions = useQuery({ queryKey: ['questions', bookId || 'all'], queryFn: () => listQuestions(bookId || undefined) })
  const all = questions.data ?? []
  const current = Q_FILTERS.find((f) => f.id === filter) ?? Q_FILTERS[0]
  const shown = all.filter(current.match)
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Question status" className="flex flex-wrap gap-1.5">
        {Q_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={current.id === f.id}
            onClick={() => onFilter(f.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold',
              current.id === f.id ? 'border-fg bg-selected text-fg' : 'border-control text-fg-muted hover:text-fg',
            )}
          >
            {f.label} {all.filter(f.match).length}
          </button>
        ))}
      </div>
      {questions.isLoading ? (
        <Spinner />
      ) : questions.error ? (
        <ErrorState error={questions.error} onRetry={() => void questions.refetch()} />
      ) : !shown.length ? (
        <EmptyState title={current.id === 'open' ? 'No open questions' : 'Nothing here'}>
          {current.id === 'open' ? 'When the AI needs to know something to write well, its questions appear here.' : null}
        </EmptyState>
      ) : (
        <ul className="space-y-3" data-testid="questions">
          {shown.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              bookTitle={!bookId && q.book_id ? titles.get(q.book_id) : undefined}
              onChanged={() => qc.invalidateQueries({ queryKey: ['questions'] })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
