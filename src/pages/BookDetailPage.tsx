import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, ArrowLeft, ImageUp, MoreHorizontal, Pencil, PenLine, Trash2 } from 'lucide-react'
import { PageBody } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu'
import { ErrorState, PageLoader } from '@/components/ui/feedback'
import { BookCover } from '@/components/library/BookCover'
import { BookFormDialog } from '@/components/library/BookFormDialog'
import { ChapterList } from '@/components/library/ChapterList'
import { ManuscriptFiles } from '@/components/library/ManuscriptFiles'
import { qk, useBook } from '@/hooks/queries'
import { deleteBook, markOpened, setArchived, uploadCover } from '@/services/books'
import { cn, formatDate, formatNumber, labelize } from '@/lib/utils'

const TABS = [
  { id: 'chapters', label: 'Chapters' },
  { id: 'files', label: 'Manuscript files' },
  { id: 'details', label: 'Details' },
] as const
type TabId = (typeof TABS)[number]['id']

export function BookDetailPage() {
  const { bookId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const { data: book, isLoading, error, refetch } = useBook(bookId)
  const [editing, setEditing] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const coverInput = React.useRef<HTMLInputElement>(null)
  const tab = (params.get('tab') as TabId) || 'chapters'

  React.useEffect(() => {
    if (bookId) void markOpened(bookId).catch(() => undefined)
  }, [bookId])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.book(bookId) })
    qc.invalidateQueries({ queryKey: qk.books })
    qc.invalidateQueries({ queryKey: qk.dashboard })
  }

  if (isLoading) return <PageLoader label="Loading book" />
  if (error || !book)
    return (
      <PageBody>
        <ErrorState error={error ?? new Error('Book not found')} onRetry={() => void refetch()} />
      </PageBody>
    )

  const pct = book.target_word_count ? Math.min(100, Math.round((book.word_count / book.target_word_count) * 100)) : null

  return (
    <PageBody>
      <Link to="/library" className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Library
      </Link>

      <div className="mb-8 flex flex-col gap-6 sm:flex-row">
        <div className="w-36 shrink-0 sm:w-44">
          <BookCover book={book} className="shadow-md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="info">{labelize(book.writing_status)}</Badge>
            <Badge>{labelize(book.book_type)}</Badge>
            <Badge tone={'neutral'}>{labelize(book.content_rating)}</Badge>
            {book.archived_at && <Badge tone="alert">Archived</Badge>}
          </div>
          <h1 className="mt-3 font-serif text-3xl font-semibold leading-tight sm:text-4xl">{book.title}</h1>
          {book.subtitle && <p className="mt-1 font-serif text-lg italic text-fg-muted">{book.subtitle}</p>}
          {book.pen_name && <p className="mt-2 text-sm text-fg-muted">by {book.pen_name}</p>}

          <div className="mt-4 max-w-sm text-sm text-fg-muted">
            <div className="flex justify-between">
              <span>
                <strong className="text-fg">{formatNumber(book.word_count)}</strong> words
                {book.target_word_count ? ` of ${formatNumber(book.target_word_count)}` : ''}
              </span>
              {pct !== null && <span>{pct}%</span>}
            </div>
            {pct !== null && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild>
              <Link to={`/books/${book.id}/write`}>
                <PenLine /> Open in Writing Studio
              </Link>
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil /> Edit details
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="More book actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => coverInput.current?.click()}>
                  <ImageUp /> {book.cover_path ? 'Replace cover' : 'Upload cover'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    try {
                      await setArchived(book.id, !book.archived_at)
                      toast.success(book.archived_at ? 'Book restored' : 'Book archived')
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Could not update')
                    } finally {
                      invalidate()
                    }
                  }}
                >
                  {book.archived_at ? <ArchiveRestore /> : <Archive />}
                  {book.archived_at ? 'Restore from archive' : 'Archive book'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete permanently
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={coverInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Upload cover image"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  await uploadCover(book, file)
                  toast.success('Cover updated')
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Cover upload failed')
                } finally {
                  invalidate()
                }
              }}
            />
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Book sections" className="mb-6 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
              tab === t.id ? 'border-ring text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'chapters' && <ChapterList bookId={book.id} />}
        {tab === 'files' && <ManuscriptFiles book={book} autoOpenPicker={params.get('upload') === '1'} />}
        {tab === 'details' && (
          <Card className="p-6">
            <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
              {(
                [
                  ['Genre', book.genre],
                  ['Subgenre', book.subgenre],
                  ['Publication status', labelize(book.publication_status)],
                  ['Publication date', book.publication_date ? formatDate(book.publication_date) : null],
                  ['Tropes', book.tropes.join(', ')],
                  ['Themes', book.themes.join(', ')],
                  ['Created', formatDate(book.created_at)],
                  ['Last modified', formatDate(book.updated_at)],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{label}</dt>
                  <dd className="mt-1 text-fg">{value || <span className="text-fg-faint">Not set</span>}</dd>
                </div>
              ))}
              {(
                [
                  ['Description', book.description],
                  ['Synopsis', book.synopsis],
                  ['Author notes', book.author_notes],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-fg">{value || <span className="text-fg-faint">Not set</span>}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </div>

      <BookFormDialog open={editing} onOpenChange={setEditing} book={book} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this book permanently?"
        description={
          <>
            This permanently deletes <strong className="text-fg">{book.title}</strong>, its chapters, scenes, version history, uploaded
            manuscript files, and cover. If you only want it out of the way, archive it instead.
          </>
        }
        confirmLabel="Delete book forever"
        destructive
        requireText={book.title}
        onConfirm={async () => {
          await deleteBook(book.id)
          toast.success('Book deleted')
          qc.removeQueries({ queryKey: qk.book(book.id) })
          qc.invalidateQueries({ queryKey: qk.books })
          qc.invalidateQueries({ queryKey: qk.dashboard })
          navigate('/library', { replace: true })
        }}
      />
    </PageBody>
  )
}
