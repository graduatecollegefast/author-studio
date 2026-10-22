import { Link } from 'react-router'
import { PenLine } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback'
import { BookCover } from '@/components/library/BookCover'
import { useBooks, useLastEdited } from '@/hooks/queries'
import { formatNumber, formatRelative } from '@/lib/utils'

export function StudioIndexPage() {
  const books = useBooks()
  const last = useLastEdited()
  const live = (books.data ?? []).filter((b) => !b.archived_at)
  const lastScene = last.data && !last.data.books?.archived_at ? last.data : null

  return (
    <PageBody>
      <PageHeader
        eyebrow="Writing Studio"
        title="What are we writing today?"
        actions={
          lastScene ? (
            <Button asChild size="lg">
              <Link to={`/books/${lastScene.book_id}/write?scene=${lastScene.id}`}>
                <PenLine /> Continue: {lastScene.books?.title}
              </Link>
            </Button>
          ) : undefined
        }
      >
        Pick a book to open it in the editor.
      </PageHeader>
      {books.isLoading ? (
        <PageLoader />
      ) : books.error ? (
        <ErrorState error={books.error} onRetry={() => void books.refetch()} />
      ) : live.length === 0 ? (
        <EmptyState
          title="No books yet"
          action={
            <Button asChild>
              <Link to="/library?new=1">Create a book</Link>
            </Button>
          }
        >
          Create a book first, then open it here to write.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((b) => (
            <li key={b.id}>
              <Link to={`/books/${b.id}/write`} className="flex gap-4 rounded-[var(--radius-panel)] border border-line bg-panel p-4 hover:border-ring">
                <div className="w-16 shrink-0">
                  <BookCover book={b} compact />
                </div>
                <div className="min-w-0">
                  <div className="font-serif text-lg font-semibold leading-snug">{b.title}</div>
                  <div className="mt-1 text-xs text-fg-muted">{formatNumber(b.word_count)} words</div>
                  <div className="text-xs text-fg-faint">Updated {formatRelative(b.updated_at)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  )
}
