import * as React from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BookText, Plus, Search } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { createWorldElement, listWorldElements, WORLD_CATEGORY_LABELS } from '@/services/bible'
import { PendingReviewBanner } from './CharactersPage'

export function WorldPage() {
  const navigate = useNavigate()
  const [search, setSearch] = React.useState('')
  const [q, setQ] = React.useState('')
  const [category, setCategory] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search), 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useQuery({ queryKey: ['world', q, category], queryFn: () => listWorldElements(q, category) })
  const [creating, setCreating] = React.useState(false)
  const [name, setName] = React.useState('')
  const [newCat, setNewCat] = React.useState('place')
  const [busy, setBusy] = React.useState(false)

  const grouped = new Map<string, NonNullable<typeof list.data>>()
  for (const e of list.data ?? []) grouped.set(e.category, [...(grouped.get(e.category) ?? []), e])

  return (
    <PageBody>
      <PageHeader
        eyebrow="Story Bible"
        title="World Bible"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New element
          </Button>
        }
      >
        Places, businesses, communities, customs, objects and every other piece of your fictional world.
      </PageHeader>
      <PendingReviewBanner />
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-fg-faint" aria-hidden />
          <Input className="pl-9" placeholder="Search the world" aria-label="Search the world" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Category" className="w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(WORLD_CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState icon={<BookText />} title={q || category ? 'Nothing matches' : 'Your world is empty'}>
          {q || category ? 'Try another search or category.' : 'Analyze a book from its AI analysis tab, or add an element yourself.'}
        </EmptyState>
      ) : (
        <div className="space-y-8" data-testid="world-list">
          {[...grouped.entries()].map(([cat, items]) => (
            <section key={cat}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">{WORLD_CATEGORY_LABELS[cat] ?? cat}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((e) => {
                  const books = new Set(e.world_element_links.map((l) => l.book_id).filter(Boolean)).size
                  return (
                    <li key={e.id}>
                      <Card className="h-full p-4 hover:bg-panel-2">
                        <Link to={`/world/${e.id}`} className="block">
                          <span className="font-serif text-lg font-semibold text-fg">{e.name}</span>
                          {e.description && <span className="mt-1 line-clamp-2 block text-sm text-fg-muted">{e.description}</span>}
                          <span className="mt-2 flex gap-1.5">
                            <Badge>{books} {books === 1 ? 'book' : 'books'}</Badge>
                          </span>
                        </Link>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={(o) => !busy && setCreating(o)}>
        <DialogContent title="New world element">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!name.trim()) return
              setBusy(true)
              try {
                const id = await createWorldElement(name, newCat)
                setCreating(false)
                setName('')
                navigate(`/world/${id}`)
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not create it')
              } finally {
                setBusy(false)
              }
            }}
          >
            <Field label="Name" htmlFor="new-element-name">
              <Input id="new-element-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required />
            </Field>
            <Field label="Category" htmlFor="new-element-category">
              <Select id="new-element-category" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                {Object.entries(WORLD_CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)} disabled={busy}>
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
