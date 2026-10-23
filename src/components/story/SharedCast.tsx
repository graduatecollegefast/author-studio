import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Spinner } from '@/components/ui/feedback'
import { sharedCharacters, sharedWorld } from '@/services/story'
import { WORLD_CATEGORY_LABELS } from '@/services/bible'

const PLACES = new Set(['place', 'home', 'city', 'business', 'school'])
const RULES = new Set(['law', 'custom', 'tradition', 'culture', 'relationship_structure', 'supernatural', 'technology'])

/** Characters, places, organizations and world rules shared by a set of books. */
export function SharedCast({ bookIds, showRules = false }: { bookIds: string[]; showRules?: boolean }) {
  const key = [...bookIds].sort().join(',')
  const chars = useQuery({ queryKey: ['characters', 'shared', key], queryFn: () => sharedCharacters(bookIds), enabled: bookIds.length > 0 })
  const world = useQuery({ queryKey: ['world', 'shared', key], queryFn: () => sharedWorld(bookIds), enabled: bookIds.length > 0 })
  if (!bookIds.length) return null
  const places = (world.data ?? []).filter((w) => PLACES.has(w.category))
  const orgs = (world.data ?? []).filter((w) => ['organization', 'social_group', 'community'].includes(w.category))
  const rules = (world.data ?? []).filter((w) => RULES.has(w.category) || w.rules)
  const many = bookIds.length > 1

  const list = (items: Array<{ id: string; name: string; books: number; sub?: string }>, to: (id: string) => string, empty: string, testId: string) =>
    !items.length ? (
      <p className="text-fg-faint">{empty}</p>
    ) : (
      <ul className="flex flex-wrap gap-2" data-testid={testId}>
        {items.slice(0, 60).map((i) => (
          <li key={i.id}>
            <Link to={to(i.id)} className="inline-flex items-center gap-1.5 rounded-full border border-control px-3 py-1 hover:bg-panel-2">
              <span className="font-semibold text-fg">{i.name}</span>
              {i.sub && <span className="text-xs text-fg-muted">{i.sub}</span>}
              {many && <Badge tone={i.books > 1 ? 'progress' : 'neutral'}>{i.books} {i.books === 1 ? 'book' : 'books'}</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    )

  return (
    <Card>
      <CardHeader title={many ? 'Shared characters and recurring places' : 'Characters and places'} />
      <div className="space-y-5 px-5 pb-5 text-sm">
        {chars.isLoading || world.isLoading ? <Spinner /> : null}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Characters</h3>
          {list(
            (chars.data ?? []).map((c) => ({ id: c.id, name: c.full_name, books: c.books })),
            (id) => `/characters/${id}`,
            'No characters approved for these books yet.',
            'shared-characters',
          )}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Important places</h3>
          {list(
            places.map((w) => ({ id: w.id, name: w.name, books: w.books, sub: WORLD_CATEGORY_LABELS[w.category]?.replace(/s$/, '') })),
            (id) => `/world/${id}`,
            'No places yet.',
            'shared-places',
          )}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Organizations and communities</h3>
          {list(orgs.map((w) => ({ id: w.id, name: w.name, books: w.books })), (id) => `/world/${id}`, 'None yet.', 'shared-orgs')}
        </section>
        {showRules && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">World rules, customs and traditions</h3>
            {!rules.length ? (
              <p className="text-fg-faint">None yet.</p>
            ) : (
              <ul className="space-y-1.5" data-testid="shared-rules">
                {rules.map((w) => (
                  <li key={w.id}>
                    <Link className="link font-semibold" to={`/world/${w.id}`}>
                      {w.name}
                    </Link>
                    {w.rules && <span className="text-fg-muted">: {w.rules}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Card>
  )
}
