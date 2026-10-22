import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Archive, BookPlus, LayoutGrid, List, Search, Upload } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { Badge } from '@/components/ui/card'
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback'
import { BookFormDialog } from '@/components/library/BookFormDialog'
import { BookCover } from '@/components/library/BookCover'
import { useBooks } from '@/hooks/queries'
import { cn, formatNumber, formatRelative, labelize } from '@/lib/utils'
import { BOOK_TYPES, WRITING_STATUSES, type Book } from '@/types/db'

type SortKey = 'updated' | 'title' | 'words' | 'created'
type View = 'grid' | 'list'

const VIEW_KEY = 'author-studio:library-view'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export function filterAndSortBooks(
  books: Book[],
  opts: { query: string; status: string; type: string; archived: boolean; sort: SortKey },
): Book[] {
  const q = opts.query.trim().toLowerCase()
  return books
    .filter((b) => (opts.archived ? b.archived_at !== null : b.archived_at === null))
    .filter((b) => (opts.status ? b.writing_status === opts.status : true))
    .filter((b) => (opts.type ? b.book_type === opts.type : true))
    .filter((b) => {
      if (!q) return true
      return [b.title, b.subtitle, b.pen_name, b.genre, b.subgenre, b.description, ...b.tropes, ...b.themes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
    .sort((a, b) => {
      switch (opts.sort) {
        case 'title':
          return a.title.localeCompare(b.title)
        case 'words':
          return b.word_count - a.word_count
        case 'created':
          return b.created_at.localeCompare(a.created_at)
        default:
          return b.updated_at.localeCompare(a.updated_at)
      }
    })
}

function Progress({ book }: { book: Book }) {
  if (!book.target_word_count) return <span>{formatNumber(book.word_count)} words</span>
  const pct = Math.min(100, Math.round((book.word_count / book.target_word_count) * 100))
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span>{formatNumber(book.word_count)} words</span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to target word count">
        <div className="h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function LibraryPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { data: books, isLoading, error, refetch } = useBooks()
  const [view, setViewState] = React.useState<View>(readView)
  const [creating, setCreating] = React.useState(params.get('new') === '1' || params.get('upload') === '1')
  const uploadAfterCreate = params.get('upload') === '1'
  React.useEffect(() => {
    if (params.get('new') === '1' || params.get('upload') === '1') setCreating(true)
  }, [params])

  const query = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const type = params.get('type') ?? ''
  const archived = params.get('archived') === '1'
  const sort = (params.get('sort') as SortKey) ?? 'updated'

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('new')
    next.delete('upload')
    setParams(next, { replace: true })
  }

  function setView(v: View) {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // ignore
    }
  }

  const visible = React.useMemo(
    () => filterAndSortBooks(books ?? [], { query, status, type, archived, sort }),
    [books, query, status, type, archived, sort],
  )
  const archivedCount = (books ?? []).filter((b) => b.archived_at).length

  return (
    <PageBody>
      <PageHeader
        eyebrow="Library"
        title={archived ? 'Archived books' : 'My Library'}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/library?upload=1')}>
              <Upload /> Upload existing book
            </Button>
            <Button onClick={() => setCreating(true)}>
              <BookPlus /> New book
            </Button>
          </>
        }
      >
        Every book, manuscript, and draft in one place.
      </PageHeader>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
          <Input
            aria-label="Search books"
            placeholder="Search titles, pen names, genres, tropes"
            className="pl-9"
            value={query}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select aria-label="Filter by writing status" value={status} onChange={(e) => setParam('status', e.target.value)} className="sm:w-40">
            <option value="">All statuses</option>
            {WRITING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelize(s)}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by book type" value={type} onChange={(e) => setParam('type', e.target.value)} className="sm:w-44">
            <option value="">All types</option>
            {BOOK_TYPES.map((s) => (
              <option key={s} value={s}>
                {labelize(s)}
              </option>
            ))}
          </Select>
          <Select aria-label="Sort books" value={sort} onChange={(e) => setParam('sort', e.target.value)} className="sm:w-48">
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
            <option value="title">Title A to Z</option>
            <option value="words">Most words</option>
          </Select>
          <div className="flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="View">
            <Button variant="ghost" size="icon" aria-pressed={view === 'grid'} aria-label="Grid view" className={cn(view === 'grid' && 'bg-panel-2 text-fg')} onClick={() => setView('grid')}>
              <LayoutGrid />
            </Button>
            <Button variant="ghost" size="icon" aria-pressed={view === 'list'} aria-label="List view" className={cn(view === 'list' && 'bg-panel-2 text-fg')} onClick={() => setView('list')}>
              <List />
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between text-sm text-fg-muted">
        <span aria-live="polite">{isLoading ? '' : `${visible.length} ${visible.length === 1 ? 'book' : 'books'}`}</span>
        <button type="button" className="inline-flex items-center gap-1.5 hover:text-fg" onClick={() => setParam('archived', archived ? '' : '1')}>
          <Archive className="size-4" aria-hidden />
          {archived ? 'Back to active books' : `Archived (${archivedCount})`}
        </button>
      </div>

      {isLoading ? (
        <PageLoader label="Loading your library" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        (books ?? []).length === 0 ? (
          <EmptyState
            icon={<BookPlus />}
            title="Your library is empty"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setCreating(true)}>
                  <BookPlus /> Create your first book
                </Button>
                <Button variant="secondary" onClick={() => navigate('/library?upload=1')}>
                  <Upload /> Upload an existing book
                </Button>
              </div>
            }
          >
            Create a book to start writing, or add one you have already written and upload the manuscript.
          </EmptyState>
        ) : (
          <EmptyState title="No books match">Try a different search or clear the filters.</EmptyState>
        )
      ) : view === 'grid' ? (
        <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((book) => (
            <li key={book.id}>
              <Link to={`/books/${book.id}`} className="group block rounded-lg p-1 focus-visible:outline-2">
                <BookCover book={book} className="shadow-sm transition-transform group-hover:-translate-y-0.5" />
                <div className="mt-3 space-y-1.5 px-0.5">
                  <div className="line-clamp-2 font-serif text-base font-semibold leading-snug text-fg">{book.title}</div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="plum">{labelize(book.writing_status)}</Badge>
                    {book.content_rating === 'adults_only' || book.content_rating === 'mature' ? (
                      <Badge tone="amber">{labelize(book.content_rating)}</Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-fg-muted">
                    <Progress book={book} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-panel">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-fg-faint">
              <tr>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Words</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((book) => (
                <tr key={book.id} className="border-b border-line last:border-0 hover:bg-panel-2">
                  <td className="px-4 py-3">
                    <Link to={`/books/${book.id}`} className="font-serif text-base font-semibold text-fg hover:text-plum">
                      {book.title}
                    </Link>
                    {book.pen_name && <div className="text-xs text-fg-faint">{book.pen_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{labelize(book.book_type)}</td>
                  <td className="px-4 py-3">
                    <Badge tone="plum">{labelize(book.writing_status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {formatNumber(book.word_count)}
                    {book.target_word_count ? ` / ${formatNumber(book.target_word_count)}` : ''}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{formatRelative(book.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BookFormDialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o)
          if (!o && (params.get('new') || params.get('upload'))) setParam('new', '')
        }}
        defaultBookType={uploadAfterCreate ? 'unpublished_manuscript' : undefined}
        onSaved={(book) => navigate(`/books/${book.id}${uploadAfterCreate ? '?tab=files&upload=1' : ''}`)}
      />
    </PageBody>
  )
}
