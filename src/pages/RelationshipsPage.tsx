import * as React from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Network, Pencil, Plus, Trash2, UsersRound } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { Checklist } from '@/components/ui/checklist'
import { CanonList } from '@/components/bible/Evidence'
import { useBooks } from '@/hooks/queries'
import { approvedFactsFor, listCharacters } from '@/services/bible'
import {
  deleteGroup,
  deleteRelationship,
  listEvents,
  listGroups,
  listRelationships,
  RELATIONSHIP_CATEGORIES,
  saveGroup,
  saveRelationship,
  type Relationship,
  type RelationshipGroup,
  type RelationshipInput,
} from '@/services/story'
import { cn } from '@/lib/utils'

const CAT_LABEL = Object.fromEntries(RELATIONSHIP_CATEGORIES) as Record<string, string>
// Line styles carry category meaning without relying on color alone.
const DASH: Record<string, string | undefined> = {
  romantic: undefined,
  sexual: undefined,
  married: undefined,
  former_partner: '2 6',
  family: undefined,
  friendship: '8 4',
  professional: '4 4',
  rivalry: '1 5',
  conflict: '1 5',
  mentorship: '8 4',
  custom: '6 3',
}

const relLabel = (r: Pick<Relationship, 'category' | 'custom_label'>) => r.custom_label || CAT_LABEL[r.category] || r.category

const emptyRel = (a: string): RelationshipInput => ({
  character_a_id: a,
  character_b_id: null,
  group_id: null,
  category: 'romantic',
  custom_label: null,
  description: null,
  current_status: null,
  past_status: null,
  important_changes: null,
  start_period: null,
  end_period: null,
  start_book_id: null,
  end_book_id: null,
  notes: null,
  bookIds: [],
  eventIds: [],
})

export function RelationshipsPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const chars = useQuery({ queryKey: ['characters', ''], queryFn: () => listCharacters('') })
  const rels = useQuery({ queryKey: ['relationships'], queryFn: listRelationships })
  const groups = useQuery({ queryKey: ['relationship-groups'], queryFn: listGroups })
  const events = useQuery({ queryKey: ['events'], queryFn: listEvents })
  const books = useBooks()
  const [editing, setEditing] = React.useState<RelationshipInput | null>(null)
  const [editingGroup, setEditingGroup] = React.useState<(Partial<RelationshipGroup> & { members: Array<{ character_id: string; member_role: string | null }> }) | null>(null)
  const [busy, setBusy] = React.useState(false)

  const names = new Map((chars.data ?? []).map((c) => [c.id, c.full_name]))
  const withLinks = new Set<string>()
  for (const r of rels.data ?? []) {
    withLinks.add(r.character_a_id)
    if (r.character_b_id) withLinks.add(r.character_b_id)
  }
  for (const g of groups.data ?? []) for (const m of g.relationship_group_members) withLinks.add(m.character_id)
  const selected = params.get('character') || [...withLinks][0] || chars.data?.[0]?.id || ''
  const focus = (id: string) => setParams({ character: id }, { replace: true })

  const mine = (rels.data ?? []).filter((r) => r.character_a_id === selected || r.character_b_id === selected)
  const myGroups = (groups.data ?? []).filter((g) => g.relationship_group_members.some((m) => m.character_id === selected))
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['relationships'] })
    qc.invalidateQueries({ queryKey: ['relationship-groups'] })
    qc.invalidateQueries({ queryKey: ['characters'] })
  }

  const loading = chars.isLoading || rels.isLoading || groups.isLoading
  const error = chars.error ?? rels.error ?? groups.error

  return (
    <PageBody>
      <PageHeader
        eyebrow="Story Bible"
        title="Relationship Map"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!chars.data?.length} onClick={() => setEditingGroup({ name: '', structure_type: '', description: '', members: [] })}>
              <UsersRound /> New group
            </Button>
            <Button disabled={!chars.data?.length} onClick={() => setEditing(emptyRel(selected))}>
              <Plus /> New relationship
            </Button>
          </div>
        }
      >
        Choose a character to see everyone they are connected to. Relationships can be between two people or a whole group, and can change from book to book.
      </PageHeader>

      {error ? (
        <ErrorState error={error} onRetry={() => void Promise.all([chars.refetch(), rels.refetch(), groups.refetch()])} />
      ) : loading ? (
        <Spinner />
      ) : !chars.data?.length ? (
        <EmptyState icon={<Network />} title="No characters yet">
          Add characters in the Character Bible, or approve character discoveries from a book's AI analysis.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <Field label="Character" htmlFor="map-character" className="max-w-sm">
            <Select id="map-character" value={selected} onChange={(e) => focus(e.target.value)}>
              {chars.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </Select>
          </Field>

          <Card className="overflow-hidden">
            <RelationshipGraph centerId={selected} names={names} rels={mine} groups={myGroups} onFocus={focus} />
          </Card>

          <Card>
            <CardHeader title={`Connections of ${names.get(selected) ?? ''}`} />
            <div className="px-5 pb-5 text-sm">
              {!mine.length && !myGroups.length ? (
                <p className="text-fg-muted">No relationships yet. Use New relationship to add one.</p>
              ) : (
                <ul className="divide-y divide-line" data-testid="connections">
                  {mine.map((r) => {
                    const other = r.character_a_id === selected ? r.character_b_id : r.character_a_id
                    return (
                      <li key={r.id} className="flex items-start gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-semibold">{relLabel(r)}</span>
                            <span className="text-fg-muted">with</span>
                            {other && (
                              <button type="button" className="link font-semibold" onClick={() => focus(other)}>
                                {names.get(other) ?? 'Unknown'}
                              </button>
                            )}
                            {r.current_status && <Badge tone="info">Now: {r.current_status}</Badge>}
                            {r.past_status && <Badge>Before: {r.past_status}</Badge>}
                          </div>
                          {r.description && <p className="mt-0.5 text-fg-muted">{r.description}</p>}
                          {(r.start_period || r.end_period) && (
                            <p className="text-xs text-fg-faint">
                              {r.start_period ?? '?'} to {r.end_period ?? 'now'}
                            </p>
                          )}
                          {r.important_changes && <p className="mt-1 text-xs text-fg-muted">Changes: {r.important_changes}</p>}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Edit ${relLabel(r)} with ${other ? names.get(other) : ''}`}
                          onClick={() =>
                            setEditing({
                              ...r,
                              bookIds: r.relationship_books.map((b) => b.book_id),
                              eventIds: r.relationship_events.map((e) => e.event_id),
                            })
                          }
                        >
                          <Pencil />
                        </Button>
                      </li>
                    )
                  })}
                  {myGroups.map((g) => (
                    <li key={g.id} className="flex items-start gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold">{g.name}</span>
                        {g.structure_type && <Badge className="ml-2">{g.structure_type}</Badge>}
                        <p className="text-fg-muted">
                          {g.relationship_group_members
                            .map((m) => `${names.get(m.character_id) ?? 'Unknown'}${m.member_role ? ` (${m.member_role})` : ''}`)
                            .join(', ')}
                        </p>
                        {g.description && <p className="text-xs text-fg-faint">{g.description}</p>}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit group ${g.name}`}
                        onClick={() => setEditingGroup({ ...g, members: g.relationship_group_members.map((m) => ({ ...m })) })}
                      >
                        <Pencil />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-fg-faint">
                <Link className="link" to={`/characters/${selected}`}>
                  Open the full profile
                </Link>
              </p>
            </div>
          </Card>
        </div>
      )}

      <RelationshipDialog
        value={editing}
        onClose={() => setEditing(null)}
        characters={chars.data ?? []}
        books={(books.data ?? []).map((b) => ({ id: b.id, title: b.title }))}
        events={(events.data ?? []).map((e) => ({ id: e.id, label: e.title, characterIds: e.story_event_characters.map((c) => c.character_id) }))}
        busy={busy}
        onSave={async (v) => {
          if (!v.character_b_id) {
            toast.error('Choose the other character.')
            return
          }
          if (v.character_b_id === v.character_a_id) {
            toast.error('Choose two different characters.')
            return
          }
          setBusy(true)
          try {
            await saveRelationship(v)
            toast.success('Relationship saved')
            setEditing(null)
            invalidate()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save')
          } finally {
            setBusy(false)
          }
        }}
        onDelete={async (id) => {
          await deleteRelationship(id)
          setEditing(null)
          invalidate()
        }}
      />

      <Dialog open={editingGroup !== null} onOpenChange={(o) => !busy && !o && setEditingGroup(null)}>
        <DialogContent title={editingGroup?.id ? 'Edit group' : 'New relationship group'} description="For relationships with more than two people: a polycule, a household, a found family, a triad.">
          {editingGroup && (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!editingGroup.name?.trim()) return
                if (editingGroup.members.length < 2) return toast.error('A group needs at least two members.')
                setBusy(true)
                try {
                  await saveGroup({
                    id: editingGroup.id,
                    name: editingGroup.name,
                    structure_type: editingGroup.structure_type ?? null,
                    description: editingGroup.description ?? null,
                    members: editingGroup.members,
                  })
                  toast.success('Group saved')
                  setEditingGroup(null)
                  invalidate()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not save')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Field label="Name" htmlFor="g-name">
                <Input id="g-name" value={editingGroup.name ?? ''} onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })} required />
              </Field>
              <Field label="Structure" htmlFor="g-structure" hint="For example: polycule, triad, household, found family">
                <Input id="g-structure" value={editingGroup.structure_type ?? ''} onChange={(e) => setEditingGroup({ ...editingGroup, structure_type: e.target.value })} />
              </Field>
              <Field label="Description" htmlFor="g-description">
                <Textarea id="g-description" value={editingGroup.description ?? ''} onChange={(e) => setEditingGroup({ ...editingGroup, description: e.target.value })} />
              </Field>
              <Checklist
                label="Members"
                options={(chars.data ?? []).map((c) => ({ id: c.id, label: c.full_name }))}
                value={editingGroup.members.map((m) => m.character_id)}
                onChange={(ids) =>
                  setEditingGroup({
                    ...editingGroup,
                    members: ids.map((id) => editingGroup.members.find((m) => m.character_id === id) ?? { character_id: id, member_role: null }),
                  })
                }
              />
              {editingGroup.members.length > 0 && (
                <div className="space-y-2">
                  {editingGroup.members.map((m, i) => (
                    <Field key={m.character_id} label={`Role of ${names.get(m.character_id) ?? ''}`} htmlFor={`g-role-${i}`}>
                      <Input
                        id={`g-role-${i}`}
                        value={m.member_role ?? ''}
                        onChange={(e) =>
                          setEditingGroup({ ...editingGroup, members: editingGroup.members.map((x, j) => (j === i ? { ...x, member_role: e.target.value || null } : x)) })
                        }
                      />
                    </Field>
                  ))}
                </div>
              )}
              <div className="flex justify-between gap-2">
                {editingGroup.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={async () => {
                      await deleteGroup(editingGroup.id!)
                      setEditingGroup(null)
                      invalidate()
                    }}
                  >
                    <Trash2 /> Delete group
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEditingGroup(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    Save group
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PageBody>
  )
}

function RelationshipGraph({
  centerId,
  names,
  rels,
  groups,
  onFocus,
}: {
  centerId: string
  names: Map<string, string>
  rels: Relationship[]
  groups: RelationshipGroup[]
  onFocus: (id: string) => void
}) {
  const W = 720
  const H = 460
  const cx = W / 2
  const cy = H / 2
  // One node per connected character; several relationships with the same person share a node.
  const others = new Map<string, Relationship[]>()
  for (const r of rels) {
    const o = r.character_a_id === centerId ? r.character_b_id : r.character_a_id
    if (o) others.set(o, [...(others.get(o) ?? []), r])
  }
  const nodes: Array<{ kind: 'character'; id: string; label: string; rels: Relationship[] } | { kind: 'group'; id: string; label: string; members: string[] }> = [
    ...[...others.entries()].map(([id, rs]) => ({ kind: 'character' as const, id, label: names.get(id) ?? 'Unknown', rels: rs })),
    ...groups.map((g) => ({ kind: 'group' as const, id: g.id, label: g.name, members: g.relationship_group_members.map((m) => m.character_id).filter((m) => m !== centerId) })),
  ]
  const R = Math.min(170, 90 + nodes.length * 8)
  const pos = (i: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, nodes.length)
    return { x: cx + R * Math.cos(a) * 1.35, y: cy + R * Math.sin(a) }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full bg-panel" role="group" aria-label={`Relationship map for ${names.get(centerId) ?? 'character'}. The same connections are listed below.`}>
      {nodes.map((n, i) => {
        const p = pos(i)
        const label = n.kind === 'character' ? n.rels.map(relLabel).join(', ') : n.members.length ? `${n.members.length + 1} members` : 'group'
        const dash = n.kind === 'character' ? DASH[n.rels[0].category] : '3 3'
        return (
          <g key={`e-${n.id}`}>
            <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--fg-muted)" strokeWidth={n.kind === 'character' && n.rels.length > 1 ? 3 : 1.75} strokeDasharray={dash} />
            <text x={(cx + p.x) / 2} y={(cy + p.y) / 2 - 6} textAnchor="middle" className="fill-[var(--fg)] text-[12px]" style={{ paintOrder: 'stroke', stroke: 'var(--panel)', strokeWidth: 4 }}>
              {label.length > 34 ? `${label.slice(0, 33)}...` : label}
            </text>
          </g>
        )
      })}
      {nodes.map((n, i) => {
        const p = pos(i)
        const go = () => (n.kind === 'character' ? onFocus(n.id) : n.members[0] && onFocus(n.members[0]))
        return (
          <g
            key={`n-${n.id}`}
            role="button"
            tabIndex={0}
            aria-label={n.kind === 'character' ? `Show ${n.label}` : `Group ${n.label}`}
            className="cursor-pointer focus:outline-none [&:focus-visible>rect]:stroke-[var(--ring)] [&:focus-visible>rect]:stroke-[3]"
            onClick={go}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go())}
          >
            <rect
              x={p.x - 70}
              y={p.y - 18}
              width={140}
              height={36}
              rx={n.kind === 'group' ? 4 : 18}
              className={cn(n.kind === 'group' ? 'fill-[var(--ai-soft)]' : 'fill-[var(--panel-2)]')}
              stroke="var(--control)"
              strokeWidth={1.5}
            />
            <text x={p.x} y={p.y + 4} textAnchor="middle" className="fill-[var(--fg)] text-[13px] font-semibold">
              {n.label.length > 18 ? `${n.label.slice(0, 17)}...` : n.label}
            </text>
          </g>
        )
      })}
      <g>
        <rect x={cx - 85} y={cy - 22} width={170} height={44} rx={22} className="fill-[var(--action)]" />
        <text x={cx} y={cy + 5} textAnchor="middle" className="fill-[var(--action-fg)] text-[14px] font-bold">
          {(names.get(centerId) ?? '').slice(0, 22)}
        </text>
      </g>
      {!nodes.length && (
        <text x={cx} y={cy + 60} textAnchor="middle" className="fill-[var(--fg-muted)] text-[13px]">
          No connections yet
        </text>
      )}
    </svg>
  )
}

function RelationshipDialog({
  value,
  onClose,
  onSave,
  onDelete,
  characters,
  books,
  events,
  busy,
}: {
  value: RelationshipInput | null
  onClose: () => void
  onSave: (v: RelationshipInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  characters: Array<{ id: string; full_name: string }>
  books: Array<{ id: string; title: string }>
  events: Array<{ id: string; label: string; characterIds: string[] }>
  busy: boolean
}) {
  const [v, setV] = React.useState<RelationshipInput | null>(value)
  React.useEffect(() => setV(value), [value])
  const evidence = useQuery({
    queryKey: ['relationships', 'evidence', value?.id],
    queryFn: () => approvedFactsFor('relationship', value!.id!),
    enabled: Boolean(value?.id),
  })
  const set = <K extends keyof RelationshipInput>(k: K, x: RelationshipInput[K]) => v && setV({ ...v, [k]: x })
  const text = (k: keyof RelationshipInput, label: string, area = false) => (
    <Field label={label} htmlFor={`r-${String(k)}`}>
      {area ? (
        <Textarea id={`r-${String(k)}`} className="min-h-16" value={(v?.[k] as string | null) ?? ''} onChange={(e) => set(k, (e.target.value || null) as never)} />
      ) : (
        <Input id={`r-${String(k)}`} value={(v?.[k] as string | null) ?? ''} onChange={(e) => set(k, (e.target.value || null) as never)} />
      )}
    </Field>
  )
  const bookSelect = (k: 'start_book_id' | 'end_book_id', label: string) => (
    <Field label={label} htmlFor={`r-${k}`}>
      <Select id={`r-${k}`} value={v?.[k] ?? ''} onChange={(e) => set(k, e.target.value || null)}>
        <option value="">Not set</option>
        {books.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}
          </option>
        ))}
      </Select>
    </Field>
  )

  return (
    <Dialog open={v !== null} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent title={v?.id ? 'Edit relationship' : 'New relationship'} className="max-w-2xl">
        {v && (
          <form
            className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
            onSubmit={(e) => {
              e.preventDefault()
              void onSave(v)
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Character" htmlFor="r-a">
                <Select id="r-a" value={v.character_a_id} onChange={(e) => set('character_a_id', e.target.value)}>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Connected to" htmlFor="r-b">
                <Select id="r-b" value={v.character_b_id ?? ''} onChange={(e) => set('character_b_id', e.target.value || null)}>
                  <option value="">Choose a character</option>
                  {characters
                    .filter((c) => c.id !== v.character_a_id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Category" htmlFor="r-category">
                <Select id="r-category" value={v.category} onChange={(e) => set('category', e.target.value)}>
                  {RELATIONSHIP_CATEGORIES.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              {text('custom_label', 'Label (optional)')}
              {text('current_status', 'Current status')}
              {text('past_status', 'Past status')}
              {text('start_period', 'Starts')}
              {text('end_period', 'Ends')}
              {bookSelect('start_book_id', 'Begins in book')}
              {bookSelect('end_book_id', 'Ends in book')}
            </div>
            {text('description', 'Description', true)}
            {text('important_changes', 'Important changes', true)}
            <div className="grid gap-4 sm:grid-cols-2">
              <Checklist label="Relevant books" options={books.map((b) => ({ id: b.id, label: b.title }))} value={v.bookIds} onChange={(ids) => set('bookIds', ids)} />
              <Checklist
                label="Relevant events"
                options={events.filter((e) => !e.characterIds.length || e.characterIds.includes(v.character_a_id) || (v.character_b_id && e.characterIds.includes(v.character_b_id)))}
                value={v.eventIds}
                onChange={(ids) => set('eventIds', ids)}
                empty="No timeline events for these characters yet."
              />
            </div>
            {text('notes', 'Notes', true)}
            {v.id && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Source evidence</h3>
                <CanonList facts={evidence.data ?? []} empty="No approved quotes for this relationship yet." />
              </div>
            )}
            <div className="flex justify-between gap-2">
              {v.id ? (
                <Button type="button" variant="ghost" onClick={() => void onDelete(v.id!)}>
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
                  Save relationship
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
