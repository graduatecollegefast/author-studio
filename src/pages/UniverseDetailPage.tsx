import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, CalendarRange, Plus, Trash2, X } from 'lucide-react'
import { PageBody } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { ErrorState, PageLoader } from '@/components/ui/feedback'
import { ThreadsEditor } from '@/components/story/ThreadsEditor'
import { SharedCast } from '@/components/story/SharedCast'
import { useBooks } from '@/hooks/queries'
import { supabase } from '@/lib/supabase/client'
import {
  addBookToUniverse,
  deleteUniverse,
  eventDateLabel,
  getUniverse,
  listEvents,
  listSeries,
  removeBookFromUniverse,
  sortEvents,
  universeBooks,
  updateUniverse,
} from '@/services/story'
import { labelize } from '@/lib/utils'

export function UniverseDetailPage() {
  const { universeId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const universe = useQuery({ queryKey: ['universes', 'one', universeId], queryFn: () => getUniverse(universeId) })
  const series = useQuery({ queryKey: ['series'], queryFn: listSeries })
  const standalone = useQuery({ queryKey: ['universes', 'books', universeId], queryFn: () => universeBooks(universeId) })
  const events = useQuery({ queryKey: ['events'], queryFn: listEvents })
  const allBooks = useBooks()
  const mySeries = (series.data ?? []).filter((s) => s.universe_id === universeId)
  const seriesBookIds = useQuery({
    queryKey: ['universes', 'series-books', universeId, mySeries.map((s) => s.id).join(',')],
    queryFn: async () => {
      if (!mySeries.length) return [] as string[]
      const { data } = await supabase.from('series_books').select('book_id').in('series_id', mySeries.map((s) => s.id))
      return (data ?? []).map((r) => r.book_id as string)
    },
    enabled: series.isSuccess,
  })
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [adding, setAdding] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  React.useEffect(() => {
    if (universe.data) {
      setName(universe.data.name)
      setDescription(universe.data.description ?? '')
    }
  }, [universe.data])

  if (!universe.data) {
    if (universe.error) return <PageBody><ErrorState error={universe.error} onRetry={() => void universe.refetch()} /></PageBody>
    return <PageLoader label="Loading universe" />
  }

  const standaloneIds = (standalone.data ?? []).map((b) => b.id)
  const allIds = [...new Set([...standaloneIds, ...(seriesBookIds.data ?? [])])]
  const titles = new Map((allBooks.data ?? []).map((b) => [b.id, b.title]))
  const candidates = (allBooks.data ?? []).filter((b) => !standaloneIds.includes(b.id))
  const history = sortEvents(
    (events.data ?? []).filter(
      (e) => (e.universe_id === universeId || (e.book_id && allIds.includes(e.book_id))) && (e.event_type === 'historical' || e.universe_id === universeId),
    ),
    'chronological',
  )

  return (
    <PageBody>
      <Link to="/series" className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Series & Universes
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Universe</p>
          <h1 className="font-serif text-3xl font-semibold">{universe.data.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link to={`/timelines?universe=${universeId}`}>
              <CalendarRange /> Master timeline
            </Link>
          </Button>
          <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!name.trim()) return toast.error('A universe needs a name.')
              setBusy(true)
              try {
                await updateUniverse(universeId, { name: name.trim(), description: description.trim() || null })
                toast.success('Universe saved')
                qc.invalidateQueries({ queryKey: ['universes'] })
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Could not save')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving...' : 'Save universe'}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <div className="grid gap-4 px-5 pb-5">
            <Field label="Name" htmlFor="u-name">
              <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="u-description">
              <Textarea id="u-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Series in this universe" />
            <div className="px-5 pb-5 text-sm">
              {!mySeries.length ? (
                <p className="text-fg-muted">No series yet. Choose this universe on a series page to add it.</p>
              ) : (
                <ul className="space-y-1.5" data-testid="universe-series">
                  {mySeries.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <Link className="link font-semibold" to={`/series/${s.id}`}>
                        {s.name}
                      </Link>
                      <Badge>{labelize(s.status)}</Badge>
                      <span className="text-xs text-fg-faint">{s.series_books.length} books</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Standalone books" />
            <div className="space-y-3 px-5 pb-5 text-sm">
              {!standalone.data?.length ? (
                <p className="text-fg-muted">None yet.</p>
              ) : (
                <ul className="space-y-1" data-testid="universe-books">
                  {standalone.data.map((b) => (
                    <li key={b.id} className="flex items-center gap-2">
                      <Link className="link flex-1 font-semibold" to={`/books/${b.id}`}>
                        {b.title}
                      </Link>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${b.title} from this universe`}
                        onClick={async () => {
                          await removeBookFromUniverse(universeId, b.id).catch((e) => toast.error(e.message))
                          qc.invalidateQueries({ queryKey: ['universes'] })
                        }}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!adding) return
                  try {
                    await addBookToUniverse(universeId, adding)
                    setAdding('')
                    qc.invalidateQueries({ queryKey: ['universes'] })
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Could not add')
                  }
                }}
              >
                <Field label="Add a book" htmlFor="u-add-book" className="w-full max-w-xs">
                  <Select id="u-add-book" value={adding} onChange={(e) => setAdding(e.target.value)}>
                    <option value="">Choose a book</option>
                    {candidates.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit" variant="secondary" disabled={!adding}>
                  <Plus /> Add book
                </Button>
              </form>
            </div>
          </Card>
        </div>

        <SharedCast bookIds={allIds} showRules />

        <Card>
          <CardHeader title="Major historical events" action={<Link className="link text-sm" to={`/timelines?universe=${universeId}`}>Full timeline</Link>} />
          <div className="px-5 pb-5 text-sm">
            {!history.length ? (
              <p className="text-fg-muted">No historical events yet. Add events of type "historical" on the timeline.</p>
            ) : (
              <ol className="space-y-2" data-testid="universe-history">
                {history.slice(0, 30).map((e) => (
                  <li key={e.id}>
                    <span className="mr-2 text-xs font-semibold text-fg-muted">{eventDateLabel(e)}</span>
                    <span className="font-semibold">{e.title}</span>
                    {e.book_id && titles.get(e.book_id) && <span className="ml-2 text-xs text-fg-faint">{titles.get(e.book_id)}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>

        <ThreadsEditor scope={{ universeId }} books={allIds.map((id) => ({ id, title: titles.get(id) ?? 'Book' }))} />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this universe?"
        description="Only the universe itself is deleted. Its series, books, characters and world details stay and are simply no longer grouped."
        confirmLabel="Delete universe"
        destructive
        onConfirm={async () => {
          await deleteUniverse(universeId)
          qc.invalidateQueries({ queryKey: ['universes'] })
          qc.invalidateQueries({ queryKey: ['series'] })
          navigate('/series', { replace: true })
        }}
      />
    </PageBody>
  )
}
