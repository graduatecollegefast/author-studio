import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowLeft, ArrowUp, CalendarRange, Plus, Trash2, X } from 'lucide-react'
import { PageBody } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { ErrorState, PageLoader } from '@/components/ui/feedback'
import { ThreadsEditor } from '@/components/story/ThreadsEditor'
import { SharedCast } from '@/components/story/SharedCast'
import { useBooks } from '@/hooks/queries'
import {
  addBookToSeries,
  deleteSeries,
  getSeries,
  listUniverses,
  removeBookFromSeries,
  saveSeriesOrder,
  seriesBooks,
  SERIES_STATUSES,
  updateSeries,
  type OrderKind,
  type Series,
} from '@/services/story'
import { cn, formatNumber, labelize } from '@/lib/utils'

const ORDERS: Array<{ id: OrderKind; label: string }> = [
  { id: 'reading_order', label: 'Reading order' },
  { id: 'chronological_order', label: 'Chronological order' },
  { id: 'publication_order', label: 'Publication order' },
]

export function SeriesDetailPage() {
  const { seriesId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const series = useQuery({ queryKey: ['series', 'one', seriesId], queryFn: () => getSeries(seriesId) })
  const members = useQuery({ queryKey: ['series', 'books', seriesId], queryFn: () => seriesBooks(seriesId) })
  const universes = useQuery({ queryKey: ['universes'], queryFn: listUniverses })
  const allBooks = useBooks()
  const [draft, setDraft] = React.useState<Series | null>(null)
  const [planned, setPlanned] = React.useState('')
  const [order, setOrder] = React.useState<OrderKind>('reading_order')
  const [adding, setAdding] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  React.useEffect(() => {
    if (series.data) {
      setDraft(series.data)
      setPlanned(series.data.planned_book_count === null ? '' : String(series.data.planned_book_count))
    }
  }, [series.data])

  if (!draft) {
    if (series.error) return <PageBody><ErrorState error={series.error} onRetry={() => void series.refetch()} /></PageBody>
    return <PageLoader label="Loading series" />
  }

  const rows = [...(members.data ?? [])].sort((a, b) => (a[order] ?? 1e9) - (b[order] ?? 1e9) || (a.books?.title ?? '').localeCompare(b.books?.title ?? ''))
  const inSeries = new Set(rows.map((r) => r.book_id))
  const candidates = (allBooks.data ?? []).filter((b) => !inSeries.has(b.id))
  const bookIds = rows.map((r) => r.book_id)
  const bookList = rows.flatMap((r) => (r.books ? [{ id: r.books.id, title: r.books.title }] : []))

  async function move(index: number, delta: number) {
    const next = [...rows]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    try {
      await saveSeriesOrder(
        seriesId,
        next.map((r, i) => ({ book_id: r.book_id, reading_order: r.reading_order, chronological_order: r.chronological_order, publication_order: r.publication_order, [order]: i + 1 })),
      )
      qc.invalidateQueries({ queryKey: ['series', 'books', seriesId] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reorder')
    }
  }

  async function save() {
    if (!draft) return
    const n = planned.trim() === '' ? null : Number(planned)
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 500)) return toast.error('Planned books must be a whole number from 0 to 500.')
    if (!draft.name.trim()) return toast.error('A series needs a name.')
    setBusy(true)
    try {
      await updateSeries(seriesId, {
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        genre: draft.genre?.trim() || null,
        universe_id: draft.universe_id,
        planned_book_count: n,
        status: draft.status,
        notes: draft.notes?.trim() || null,
      })
      toast.success('Series saved')
      qc.invalidateQueries({ queryKey: ['series'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageBody>
      <Link to="/series" className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Series & Universes
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Series</p>
          <h1 className="font-serif text-3xl font-semibold">{series.data!.name}</h1>
          <p className="mt-1 text-sm text-fg-muted" data-testid="series-count">
            {rows.length} {rows.length === 1 ? 'book' : 'books'}
            {series.data!.planned_book_count ? ` of ${series.data!.planned_book_count} planned` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link to={`/timelines?series=${seriesId}`}>
              <CalendarRange /> Series timeline
            </Link>
          </Button>
          <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving...' : 'Save series'}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name" htmlFor="s-name">
              <Input id="s-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Genre" htmlFor="s-genre">
              <Input id="s-genre" value={draft.genre ?? ''} onChange={(e) => setDraft({ ...draft, genre: e.target.value })} />
            </Field>
            <Field label="Universe" htmlFor="s-universe">
              <Select id="s-universe" value={draft.universe_id ?? ''} onChange={(e) => setDraft({ ...draft, universe_id: e.target.value || null })}>
                <option value="">None</option>
                {(universes.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Planned number of books" htmlFor="s-planned">
              <Input id="s-planned" inputMode="numeric" value={planned} onChange={(e) => setPlanned(e.target.value)} />
            </Field>
            <Field label="Status" htmlFor="s-status">
              <Select id="s-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Series['status'] })}>
                {SERIES_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {labelize(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" htmlFor="s-description" className="sm:col-span-2 lg:col-span-3">
              <Textarea id="s-description" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <Field label="Notes" htmlFor="s-notes" className="sm:col-span-2 lg:col-span-3">
              <Textarea id="s-notes" value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Books" />
          <div className="space-y-4 px-5 pb-5 text-sm">
            <div role="tablist" aria-label="Book order" className="flex flex-wrap gap-1">
              {ORDERS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  aria-selected={order === o.id}
                  onClick={() => setOrder(o.id)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-semibold', order === o.id ? 'border-fg bg-selected text-fg' : 'border-control text-fg-muted hover:text-fg')}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {!rows.length ? (
              <p className="text-fg-muted">No books in this series yet.</p>
            ) : (
              <ol className="divide-y divide-line rounded-lg border border-line" data-testid="series-books">
                {rows.map((r, i) => (
                  <li key={r.book_id} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-6 text-right font-semibold text-fg-muted">{i + 1}</span>
                    <Link className="link min-w-0 flex-1 truncate font-serif font-semibold" to={`/books/${r.book_id}`}>
                      {r.books?.title}
                    </Link>
                    <span className="hidden text-xs text-fg-faint sm:inline">{formatNumber(r.books?.word_count ?? 0)} words</span>
                    <Button size="icon" variant="ghost" aria-label={`Move ${r.books?.title} earlier`} disabled={i === 0} onClick={() => void move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Move ${r.books?.title} later`} disabled={i === rows.length - 1} onClick={() => void move(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${r.books?.title} from this series`}
                      onClick={async () => {
                        try {
                          await removeBookFromSeries(seriesId, r.book_id)
                          qc.invalidateQueries({ queryKey: ['series'] })
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Could not remove')
                        }
                      }}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!adding) return
                try {
                  await addBookToSeries(seriesId, adding, rows.length + 1)
                  setAdding('')
                  qc.invalidateQueries({ queryKey: ['series'] })
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not add the book')
                }
              }}
            >
              <Field label="Add a book" htmlFor="s-add-book" className="w-full max-w-sm">
                <Select id="s-add-book" value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Choose a book</option>
                  {candidates.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary" disabled={!adding}>
                <Plus /> Add to series
              </Button>
            </form>
          </div>
        </Card>

        <SharedCast bookIds={bookIds} />
        <ThreadsEditor scope={{ seriesId }} books={bookList} />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this series?"
        description="Only the series, its book order and its threads are deleted. The books, characters and canon stay in your library."
        confirmLabel="Delete series"
        destructive
        onConfirm={async () => {
          await deleteSeries(seriesId)
          qc.invalidateQueries({ queryKey: ['series'] })
          navigate('/series', { replace: true })
        }}
      />
    </PageBody>
  )
}
