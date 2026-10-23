import * as React from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { Checklist } from '@/components/ui/checklist'
import { useBooks } from '@/hooks/queries'
import { listCharacters, listWorldElements } from '@/services/bible'
import { listChapters } from '@/services/chapters'
import {
  deleteEvent,
  eventDateLabel,
  EVENT_TYPES,
  listEvents,
  listRelationships,
  listSeries,
  listUniverses,
  saveEvent,
  sortEvents,
  type EventInput,
} from '@/services/story'
import { cn, labelize } from '@/lib/utils'

const FILTERS = ['universe', 'series', 'book', 'character', 'relationship', 'type'] as const
type FilterKey = (typeof FILTERS)[number]

const blankEvent = (f: Partial<Record<FilterKey, string>>): EventInput => ({
  universe_id: f.universe || null,
  series_id: f.series || null,
  book_id: f.book || null,
  chapter_id: null,
  location_element_id: null,
  title: '',
  description: null,
  event_type: f.type || 'plot',
  date_precision: 'unknown',
  date_start: null,
  date_end: null,
  approximate_label: null,
  end_label: null,
  chronological_order: null,
  reveal_order: null,
  is_flashback: false,
  reliability: 'confirmed',
  notes: null,
  characterIds: f.character ? [f.character] : [],
  relationshipIds: f.relationship ? [f.relationship] : [],
})

export function TimelinePage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filter = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ''])) as Record<FilterKey, string>
  const mode = params.get('order') === 'reveal' ? 'reveal' : 'chronological'
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const events = useQuery({ queryKey: ['events'], queryFn: listEvents })
  const books = useBooks()
  const series = useQuery({ queryKey: ['series'], queryFn: listSeries })
  const universes = useQuery({ queryKey: ['universes'], queryFn: listUniverses })
  const chars = useQuery({ queryKey: ['characters', ''], queryFn: () => listCharacters('') })
  const rels = useQuery({ queryKey: ['relationships'], queryFn: listRelationships })
  const places = useQuery({ queryKey: ['world', '', ''], queryFn: () => listWorldElements('', '') })
  const [editing, setEditing] = React.useState<EventInput | null>(null)

  const bookTitle = new Map((books.data ?? []).map((b) => [b.id, b.title]))
  const charName = new Map((chars.data ?? []).map((c) => [c.id, c.full_name]))
  const placeName = new Map((places.data ?? []).map((p) => [p.id, p.name]))
  const relName = (id: string) => {
    const r = rels.data?.find((x) => x.id === id)
    if (!r) return 'Relationship'
    return `${charName.get(r.character_a_id) ?? '?'} and ${r.character_b_id ? (charName.get(r.character_b_id) ?? '?') : 'group'}: ${r.custom_label ?? labelize(r.category)}`
  }

  // Which books a series or universe covers.
  const seriesBooks = (id: string) => new Set((series.data ?? []).find((s) => s.id === id)?.series_books.map((b) => b.book_id) ?? [])
  const universeBooks = (id: string) => {
    const set = new Set((universes.data ?? []).find((u) => u.id === id)?.book_universes.map((b) => b.book_id) ?? [])
    for (const s of series.data ?? []) if (s.universe_id === id) for (const b of s.series_books) set.add(b.book_id)
    return set
  }
  const universeSeries = (id: string) => new Set((series.data ?? []).filter((s) => s.universe_id === id).map((s) => s.id))

  let shown = events.data ?? []
  if (filter.universe) {
    const bs = universeBooks(filter.universe)
    const ss = universeSeries(filter.universe)
    shown = shown.filter((e) => e.universe_id === filter.universe || (e.series_id && ss.has(e.series_id)) || (e.book_id && bs.has(e.book_id)))
  }
  if (filter.series) {
    const bs = seriesBooks(filter.series)
    shown = shown.filter((e) => e.series_id === filter.series || (e.book_id && bs.has(e.book_id)))
  }
  if (filter.book) shown = shown.filter((e) => e.book_id === filter.book)
  if (filter.character) shown = shown.filter((e) => e.story_event_characters.some((c) => c.character_id === filter.character))
  if (filter.relationship) shown = shown.filter((e) => e.relationship_events.some((r) => r.relationship_id === filter.relationship))
  if (filter.type) shown = shown.filter((e) => (e.event_type ?? 'other') === filter.type)

  // Reveal order follows the reading order of the chosen series, otherwise publication order.
  const bookOrder = new Map<string, number>()
  if (filter.series) {
    const sb = (series.data ?? []).find((s) => s.id === filter.series)
    sb?.series_books.forEach((b, i) => bookOrder.set(b.book_id, i))
  } else {
    ;[...(books.data ?? [])]
      .sort((a, b) => (a.publication_date ?? a.created_at).localeCompare(b.publication_date ?? b.created_at))
      .forEach((b, i) => bookOrder.set(b.id, i))
  }
  const ordered = sortEvents(shown, mode, bookOrder)
  const loading = events.isLoading || books.isLoading || series.isLoading || universes.isLoading

  const select = (k: FilterKey, label: string, options: Array<{ id: string; label: string }>) => (
    <Field label={label} htmlFor={`tl-${k}`}>
      <Select id={`tl-${k}`} value={filter[k]} onChange={(e) => setParam(k, e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  )

  return (
    <PageBody>
      <PageHeader
        eyebrow="Story world"
        title="Story Timelines"
        actions={
          <Button onClick={() => setEditing(blankEvent(filter))}>
            <Plus /> New event
          </Button>
        }
      >
        When things happen in the story, kept apart from the order the reader learns about them. Approved timeline discoveries from AI analysis appear here too.
      </PageHeader>

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {select('universe', 'Universe', (universes.data ?? []).map((u) => ({ id: u.id, label: u.name })))}
          {select('series', 'Series', (series.data ?? []).map((s) => ({ id: s.id, label: s.name })))}
          {select('book', 'Book', (books.data ?? []).map((b) => ({ id: b.id, label: b.title })))}
          {select('character', 'Character', (chars.data ?? []).map((c) => ({ id: c.id, label: c.full_name })))}
          {select('relationship', 'Relationship', (rels.data ?? []).map((r) => ({ id: r.id, label: relName(r.id) })))}
          {select('type', 'Event type', EVENT_TYPES.map((t) => ({ id: t, label: labelize(t) })))}
        </div>
        <div role="tablist" aria-label="Order" className="mt-4 flex gap-1">
          {(
            [
              ['chronological', 'Story order'],
              ['reveal', 'Reveal order'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => setParam('order', id === 'reveal' ? 'reveal' : '')}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold', mode === id ? 'border-fg bg-selected text-fg' : 'border-control text-fg-muted hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {events.error ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : loading ? (
        <Spinner />
      ) : !ordered.length ? (
        <EmptyState icon={<CalendarRange />} title={events.data?.length ? 'No events match these filters' : 'No events yet'}>
          {events.data?.length ? 'Clear a filter to see more.' : 'Add an event, or approve timeline discoveries from a book’s AI analysis.'}
        </EmptyState>
      ) : (
        <ol className="relative space-y-3 border-l-2 border-control pl-6" data-testid="timeline">
          {ordered.map((e, i) => (
            <li key={e.id} className="relative">
              <span className={cn('absolute top-4 -left-[31px] size-3 rounded-full border-2 border-panel', e.is_flashback ? 'bg-ai' : 'bg-fg')} aria-hidden />
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-fg-muted">
                      <span className="sr-only">{i + 1}. </span>
                      {eventDateLabel(e)}
                      {e.chronological_order !== null && mode === 'chronological' && e.date_precision !== 'exact' ? ` · position ${e.chronological_order}` : ''}
                      {mode === 'reveal' && e.reveal_order !== null ? ` · revealed ${e.reveal_order}` : ''}
                    </p>
                    <h2 className="font-serif text-lg font-semibold">{e.title}</h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {e.event_type && <Badge>{labelize(e.event_type)}</Badge>}
                      {e.is_flashback && <Badge tone="ai">Flashback</Badge>}
                      {e.reliability !== 'confirmed' && <Badge tone="alert">{e.reliability === 'uncertain' ? 'Uncertain' : 'Unreliable narration'}</Badge>}
                    </div>
                    {e.description && <p className="mt-2 text-sm text-fg">{e.description}</p>}
                    <p className="mt-2 text-xs text-fg-muted">
                      {[
                        e.book_id && bookTitle.get(e.book_id),
                        e.location_element_id && placeName.get(e.location_element_id) && `at ${placeName.get(e.location_element_id)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {e.story_event_characters.length > 0 && (
                      <p className="mt-1 text-xs">
                        {e.story_event_characters.map((c, j) => (
                          <React.Fragment key={c.character_id}>
                            {j > 0 && ', '}
                            <Link className="link" to={`/characters/${c.character_id}`}>
                              {charName.get(c.character_id) ?? 'Unknown'}
                            </Link>
                          </React.Fragment>
                        ))}
                      </p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${e.title}`}
                    onClick={() =>
                      setEditing({
                        ...e,
                        characterIds: e.story_event_characters.map((c) => c.character_id),
                        relationshipIds: e.relationship_events.map((r) => r.relationship_id),
                      })
                    }
                  >
                    <Pencil />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <EventDialog
        value={editing}
        onClose={() => setEditing(null)}
        books={(books.data ?? []).map((b) => ({ id: b.id, label: b.title }))}
        series={(series.data ?? []).map((s) => ({ id: s.id, label: s.name }))}
        universes={(universes.data ?? []).map((u) => ({ id: u.id, label: u.name }))}
        characters={(chars.data ?? []).map((c) => ({ id: c.id, label: c.full_name }))}
        relationships={(rels.data ?? []).map((r) => ({ id: r.id, label: relName(r.id) }))}
        places={(places.data ?? []).map((p) => ({ id: p.id, label: p.name }))}
        onSaved={() => {
          setEditing(null)
          qc.invalidateQueries({ queryKey: ['events'] })
          qc.invalidateQueries({ queryKey: ['relationships'] })
        }}
      />
    </PageBody>
  )
}

function EventDialog({
  value,
  onClose,
  onSaved,
  books,
  series,
  universes,
  characters,
  relationships,
  places,
}: {
  value: EventInput | null
  onClose: () => void
  onSaved: () => void
  books: Array<{ id: string; label: string }>
  series: Array<{ id: string; label: string }>
  universes: Array<{ id: string; label: string }>
  characters: Array<{ id: string; label: string }>
  relationships: Array<{ id: string; label: string }>
  places: Array<{ id: string; label: string }>
}) {
  const [v, setV] = React.useState<EventInput | null>(value)
  const [order, setOrder] = React.useState({ chrono: '', reveal: '' })
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    setV(value)
    setOrder({ chrono: value?.chronological_order?.toString() ?? '', reveal: value?.reveal_order?.toString() ?? '' })
  }, [value])
  const chapters = useQuery({ queryKey: ['chapters', v?.book_id ?? ''], queryFn: () => listChapters(v!.book_id!), enabled: Boolean(v?.book_id) })
  if (!v) return <Dialog open={false} />
  const set = <K extends keyof EventInput>(k: K, x: EventInput[K]) => setV({ ...v, [k]: x })
  const pick = (k: 'universe_id' | 'series_id' | 'book_id' | 'location_element_id' | 'chapter_id', label: string, options: Array<{ id: string; label: string }>) => (
    <Field label={label} htmlFor={`ev-${k}`}>
      <Select id={`ev-${k}`} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value || null, ...(k === 'book_id' ? { chapter_id: null } : {}) })}>
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  )

  return (
    <Dialog open onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent title={v.id ? 'Edit event' : 'New event'} className="max-w-2xl">
        <form
          className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!v.title.trim()) return toast.error('An event needs a title.')
            const chrono = order.chrono.trim() === '' ? null : Number(order.chrono)
            const reveal = order.reveal.trim() === '' ? null : Number(order.reveal)
            if ((chrono !== null && !Number.isFinite(chrono)) || (reveal !== null && !Number.isFinite(reveal))) return toast.error('Positions must be numbers.')
            if (v.date_start && v.date_end && v.date_end < v.date_start) return toast.error('The end date is before the start date.')
            setBusy(true)
            try {
              await saveEvent({ ...v, title: v.title.trim(), chronological_order: chrono, reveal_order: reveal })
              toast.success('Event saved')
              onSaved()
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not save')
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label="Title" htmlFor="ev-title">
            <Input id="ev-title" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={300} required />
          </Field>
          <Field label="Description" htmlFor="ev-description">
            <Textarea id="ev-description" className="min-h-16" value={v.description ?? ''} onChange={(e) => set('description', e.target.value || null)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Event type" htmlFor="ev-type">
              <Select id="ev-type" value={v.event_type ?? 'other'} onChange={(e) => set('event_type', e.target.value)}>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="ev-precision">
              <Select id="ev-precision" value={v.date_precision} onChange={(e) => set('date_precision', e.target.value as EventInput['date_precision'])}>
                <option value="exact">Exact date</option>
                <option value="approximate">Approximate</option>
                <option value="relative">Relative to other events</option>
                <option value="unknown">Unknown</option>
              </Select>
            </Field>
            <Field label="Reliability" htmlFor="ev-reliability">
              <Select id="ev-reliability" value={v.reliability} onChange={(e) => set('reliability', e.target.value as EventInput['reliability'])}>
                <option value="confirmed">Confirmed</option>
                <option value="uncertain">Uncertain</option>
                <option value="unreliable_narration">Unreliable narration</option>
              </Select>
            </Field>
          </div>
          {v.date_precision === 'exact' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" htmlFor="ev-start">
                <Input id="ev-start" type="date" value={v.date_start ?? ''} onChange={(e) => set('date_start', e.target.value || null)} />
              </Field>
              <Field label="Ends (optional)" htmlFor="ev-end">
                <Input id="ev-end" type="date" value={v.date_end ?? ''} onChange={(e) => set('date_end', e.target.value || null)} />
              </Field>
            </div>
          ) : v.date_precision !== 'unknown' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="When" htmlFor="ev-approx" hint='For example "Summer 2019" or "two years before the wedding"'>
                <Input id="ev-approx" value={v.approximate_label ?? ''} onChange={(e) => set('approximate_label', e.target.value || null)} />
              </Field>
              <Field label="Until (optional)" htmlFor="ev-end-label">
                <Input id="ev-end-label" value={v.end_label ?? ''} onChange={(e) => set('end_label', e.target.value || null)} />
              </Field>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Position in story order" htmlFor="ev-chrono" hint="Smaller numbers happen earlier. Decimals fit between. Events with exact dates are listed first, by date.">
              <Input id="ev-chrono" inputMode="decimal" value={order.chrono} onChange={(e) => setOrder({ ...order, chrono: e.target.value })} />
            </Field>
            <Field label="Position in reveal order" htmlFor="ev-reveal" hint="When the reader learns of it within its book.">
              <Input id="ev-reveal" inputMode="decimal" value={order.reveal} onChange={(e) => setOrder({ ...order, reveal: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--action)]" checked={v.is_flashback} onChange={(e) => set('is_flashback', e.target.checked)} />
            Shown as a flashback
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            {pick('book_id', 'Book', books)}
            {pick('chapter_id', 'Chapter', (chapters.data ?? []).map((c) => ({ id: c.id, label: c.title })))}
            {pick('series_id', 'Series', series)}
            {pick('universe_id', 'Universe', universes)}
            {pick('location_element_id', 'Location', places)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Checklist label="Characters involved" options={characters} value={v.characterIds} onChange={(ids) => set('characterIds', ids)} />
            <Checklist label="Relationships" options={relationships} value={v.relationshipIds} onChange={(ids) => set('relationshipIds', ids)} empty="No relationships yet." />
          </div>
          <Field label="Notes" htmlFor="ev-notes">
            <Textarea id="ev-notes" className="min-h-16" value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} />
          </Field>
          <div className="flex justify-between gap-2">
            {v.id ? (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  await deleteEvent(v.id!)
                  onSaved()
                }}
              >
                <Trash2 /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save event
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
