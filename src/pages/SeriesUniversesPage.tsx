import * as React from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Globe2, Library, Plus } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { createSeries, createUniverse, listSeries, listUniverses } from '@/services/story'
import { labelize } from '@/lib/utils'

export function SeriesUniversesPage() {
  const navigate = useNavigate()
  const universes = useQuery({ queryKey: ['universes'], queryFn: listUniverses })
  const series = useQuery({ queryKey: ['series'], queryFn: listSeries })
  const [creating, setCreating] = React.useState<'series' | 'universe' | null>(null)
  const [name, setName] = React.useState('')
  const [universeId, setUniverseId] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const uName = (id: string | null) => universes.data?.find((u) => u.id === id)?.name

  return (
    <PageBody>
      <PageHeader
        eyebrow="Story world"
        title="Series & Universes"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCreating('universe')}>
              <Plus /> New universe
            </Button>
            <Button onClick={() => setCreating('series')}>
              <Plus /> New series
            </Button>
          </div>
        }
      >
        Group books into series, and series and standalone books into shared universes. A book can belong to more than one series.
      </PageHeader>

      {series.error || universes.error ? (
        <ErrorState error={series.error ?? universes.error} onRetry={() => void Promise.all([series.refetch(), universes.refetch()])} />
      ) : series.isLoading || universes.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">Universes</h2>
            {!universes.data?.length ? (
              <EmptyState icon={<Globe2 />} title="No universes yet">
                A universe holds the series and standalone books that share one world, timeline and cast.
              </EmptyState>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="universe-list">
                {universes.data.map((u) => (
                  <li key={u.id}>
                    <Card className="h-full p-4 hover:bg-panel-2">
                      <Link to={`/universes/${u.id}`} className="block">
                        <span className="font-serif text-lg font-semibold">{u.name}</span>
                        {u.description && <span className="mt-1 line-clamp-2 block text-sm text-fg-muted">{u.description}</span>}
                        <span className="mt-2 block text-xs text-fg-faint">
                          {u.series.length} {u.series.length === 1 ? 'series' : 'series'} · {u.book_universes.length} standalone{' '}
                          {u.book_universes.length === 1 ? 'book' : 'books'}
                        </span>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">Series</h2>
            {!series.data?.length ? (
              <EmptyState icon={<Library />} title="No series yet">
                Create a series, then add your books to it and set their reading, chronological and publication order.
              </EmptyState>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="series-list">
                {series.data.map((s) => (
                  <li key={s.id}>
                    <Card className="h-full p-4 hover:bg-panel-2">
                      <Link to={`/series/${s.id}`} className="block">
                        <span className="font-serif text-lg font-semibold">{s.name}</span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <Badge tone="info">{labelize(s.status)}</Badge>
                          {s.genre && <Badge>{s.genre}</Badge>}
                        </span>
                        <span className="mt-2 block text-xs text-fg-faint">
                          {s.series_books.length}
                          {s.planned_book_count ? ` of ${s.planned_book_count}` : ''} {s.series_books.length === 1 && !s.planned_book_count ? 'book' : 'books'}
                          {uName(s.universe_id) ? ` · ${uName(s.universe_id)}` : ''}
                        </span>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <Dialog open={creating !== null} onOpenChange={(o) => !busy && !o && setCreating(null)}>
        <DialogContent title={creating === 'universe' ? 'New universe' : 'New series'}>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!name.trim()) return
              setBusy(true)
              try {
                const id = creating === 'universe' ? await createUniverse(name) : await createSeries(name, universeId || null)
                navigate(creating === 'universe' ? `/universes/${id}` : `/series/${id}`)
                setCreating(null)
                setName('')
                setUniverseId('')
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not create it')
              } finally {
                setBusy(false)
              }
            }}
          >
            <Field label="Name" htmlFor="new-collection-name">
              <Input id="new-collection-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required />
            </Field>
            {creating === 'series' && (
              <Field label="Universe" htmlFor="new-series-universe">
                <Select id="new-series-universe" value={universeId} onChange={(e) => setUniverseId(e.target.value)}>
                  <option value="">None</option>
                  {(universes.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageBody>
  )
}
