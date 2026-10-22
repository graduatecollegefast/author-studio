import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ChevronDown, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { ConfirmDialog } from '@/components/ui/dialog'
import {
  DISCOVERY_CATEGORIES,
  discoveryCounts,
  editDiscovery,
  HIGH_CONFIDENCE,
  listDiscoveries,
  NOT_BULK_APPROVABLE,
  reviewDiscoveries,
  STATEMENT_LABELS,
  type Discovery,
  type DiscoveryCategory,
} from '@/services/ai'
import { WORLD_CATEGORY_LABELS } from '@/services/bible'
import { cn, formatNumber } from '@/lib/utils'

const STATUS_TABS = [
  { id: 'proposed', label: 'To review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
] as const
type StatusTab = (typeof STATUS_TABS)[number]['id']

const PAGE = 150

export function attributeLabel(a: string): string {
  const [section, key] = a.includes('.') ? a.split('.', 2) : ['', a]
  const words = (key ?? a).replace(/_/g, ' ')
  const nice = words.charAt(0).toUpperCase() + words.slice(1)
  return section && section !== 'story' ? `${section.charAt(0).toUpperCase() + section.slice(1)}: ${words}` : nice
}

const isBulkApprovable = (d: Discovery) => (d.confidence ?? 0) >= HIGH_CONFIDENCE && !NOT_BULK_APPROVABLE.includes(d.statement_type)

export function DiscoveryReview({ bookId }: { bookId: string }) {
  const qc = useQueryClient()
  const [status, setStatus] = React.useState<StatusTab>('proposed')
  const [category, setCategory] = React.useState<DiscoveryCategory | 'all'>('all')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [limit, setLimit] = React.useState(PAGE)
  const [busy, setBusy] = React.useState(false)
  const [confirmBulk, setConfirmBulk] = React.useState(false)

  const list = useQuery({ queryKey: ['discoveries', bookId, status], queryFn: () => listDiscoveries(bookId, status) })
  const counts = useQuery({ queryKey: ['discoveries', bookId, 'counts'], queryFn: () => discoveryCounts(bookId) })

  React.useEffect(() => {
    setSelected(new Set())
    setLimit(PAGE)
  }, [status, category])

  const all = list.data ?? []
  const byCategory = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const d of all) m.set(d.category ?? 'other', (m.get(d.category ?? 'other') ?? 0) + 1)
    return m
  }, [all])
  const visible = category === 'all' ? all : all.filter((d) => d.category === category)
  const shown = visible.slice(0, limit)
  const bulk = visible.filter(isBulkApprovable)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['discoveries', bookId] })
    qc.invalidateQueries({ queryKey: ['characters'] })
    qc.invalidateQueries({ queryKey: ['world'] })
  }

  async function act(ids: string[], action: 'approve' | 'reject') {
    if (!ids.length) return
    setBusy(true)
    try {
      const n = await reviewDiscoveries(ids, action)
      toast.success(`${action === 'approve' ? 'Approved' : 'Rejected'} ${formatNumber(n)} ${n === 1 ? 'discovery' : 'discoveries'}`)
      setSelected(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update')
    } finally {
      setBusy(false)
      refresh()
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 pt-4">
        <h2 className="pb-3 text-sm font-bold tracking-wide">Discoveries</h2>
        <div role="tablist" aria-label="Review status" className="flex gap-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={status === t.id}
              onClick={() => setStatus(t.id)}
              className={cn(
                '-mb-px border-b-2 px-3 pb-3 text-sm font-semibold',
                status === t.id ? 'border-ring text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {t.label} <span className="font-normal text-fg-muted">{formatNumber(counts.data?.[t.id] ?? 0)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          {[{ id: 'all', label: 'All' } as const, ...DISCOVERY_CATEGORIES].map((c) => {
            const n = c.id === 'all' ? all.length : (byCategory.get(c.id) ?? 0)
            if (c.id !== 'all' && n === 0) return null
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold',
                  category === c.id ? 'border-fg bg-selected text-fg' : 'border-control text-fg-muted hover:bg-panel-2 hover:text-fg',
                )}
              >
                {c.label} {formatNumber(n)}
              </button>
            )
          })}
        </div>

        {status === 'proposed' && visible.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-panel-2 p-3 text-sm">
            <label className="mr-2 flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-[var(--action)]"
                checked={shown.length > 0 && shown.every((d) => selected.has(d.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((d) => d.id)) : new Set())}
              />
              Select shown
            </label>
            <Button size="sm" onClick={() => void act([...selected], 'approve')} disabled={busy || !selected.size}>
              <Check /> Approve {selected.size || ''}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void act([...selected], 'reject')} disabled={busy || !selected.size}>
              <X /> Reject {selected.size || ''}
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="secondary" onClick={() => setConfirmBulk(true)} disabled={busy || !bulk.length}>
              Approve all high-confidence ({formatNumber(bulk.length)})
            </Button>
          </div>
        )}

        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState title={status === 'proposed' ? 'Nothing to review' : status === 'approved' ? 'Nothing approved yet' : 'Nothing rejected'}>
            {status === 'proposed' ? 'Discoveries from an analysis appear here for you to approve or reject.' : null}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line" data-testid="discoveries">
            {shown.map((d) => (
              <DiscoveryItem
                key={d.id}
                d={d}
                reviewable={status === 'proposed'}
                selected={selected.has(d.id)}
                onSelect={(on) => {
                  const next = new Set(selected)
                  if (on) next.add(d.id)
                  else next.delete(d.id)
                  setSelected(next)
                }}
                busy={busy}
                onAct={(action) => void act([d.id], action)}
                onEdited={refresh}
              />
            ))}
          </ul>
        )}
        {visible.length > shown.length && (
          <Button variant="secondary" onClick={() => setLimit(limit + PAGE)}>
            Show more ({formatNumber(visible.length - shown.length)} left)
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Approve ${formatNumber(bulk.length)} high-confidence discoveries?`}
        description={`These have ${Math.round(HIGH_CONFIDENCE * 100)}% confidence or more. Rumors, dreams, character beliefs and AI suggestions are never included; review those one by one.`}
        confirmLabel="Approve them"
        onConfirm={async () => {
          await act(
            bulk.map((d) => d.id),
            'approve',
          )
        }}
      />
    </Card>
  )
}

function DiscoveryItem({
  d,
  reviewable,
  selected,
  onSelect,
  busy,
  onAct,
  onEdited,
}: {
  d: Discovery
  reviewable: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  busy: boolean
  onAct: (a: 'approve' | 'reject') => void
  onEdited: () => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [label, setLabel] = React.useState(d.entity_label ?? '')
  const [value, setValue] = React.useState(d.value)
  const [showAll, setShowAll] = React.useState(false)
  const sources = d.fact_sources ?? []
  const p = d.payload as { related_name?: string; relationship_category?: string; world_category?: string; when?: string }
  const conf = d.confidence === null ? null : Math.round(d.confidence * 100)
  const id = `d-${d.id}`

  return (
    <li className="flex gap-3 p-4" data-testid="discovery">
      {reviewable && (
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-[var(--action)]"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-labelledby={`${id}-title`}
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span id={`${id}-title`} className="font-serif text-base font-semibold text-fg">
            {d.entity_type === 'book' ? attributeLabel(d.attribute) : d.entity_label}
          </span>
          {d.entity_type !== 'book' && <span className="text-sm text-fg-muted">{attributeLabel(d.attribute)}</span>}
          {d.entity_type === 'relationship' && p.related_name && (
            <span className="text-sm text-fg-muted">
              with <strong className="text-fg">{p.related_name}</strong> ({(p.relationship_category ?? 'custom').replace(/_/g, ' ')})
            </span>
          )}
          {d.entity_type === 'world_element' && p.world_category && (
            <span className="text-sm text-fg-muted">{WORLD_CATEGORY_LABELS[p.world_category] ?? p.world_category}</span>
          )}
          {d.entity_type === 'story_event' && p.when && <span className="text-sm text-fg-muted">{p.when}</span>}
          <span className="flex gap-1">
            <Badge tone={d.statement_type.startsWith('ai_') ? 'ai' : ['rumor', 'dream', 'character_belief'].includes(d.statement_type) ? 'alert' : 'neutral'}>
              {STATEMENT_LABELS[d.statement_type] ?? d.statement_type}
            </Badge>
            {conf !== null && <Badge tone={conf >= HIGH_CONFIDENCE * 100 ? 'progress' : 'neutral'}>{conf}% confidence</Badge>}
          </span>
        </div>

        {editing ? (
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!value.trim()) return
              try {
                await editDiscovery(d.id, { value: value.trim(), ...(d.entity_type === 'book' ? {} : { entity_label: label.trim() || d.entity_label || '' }) })
                toast.success('Discovery updated. Approve it to add it to canon.')
                setEditing(false)
                onEdited()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not save')
              }
            }}
          >
            {d.entity_type !== 'book' && <Input aria-label="Name" value={label} onChange={(e) => setLabel(e.target.value)} />}
            <Textarea aria-label="Value" value={value} onChange={(e) => setValue(e.target.value)} className="min-h-16" />
            <div className="flex gap-2">
              <Button size="sm" type="submit">
                Save
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-fg">{d.value}</p>
        )}

        {sources.slice(0, showAll ? sources.length : 1).map((s) => (
          <figure key={s.id} className="border-l-2 border-control pl-3 text-sm">
            {s.excerpt && <blockquote className="font-serif italic text-fg-muted">"{s.excerpt}"</blockquote>}
            <figcaption className="mt-0.5 text-xs text-fg-faint">{s.location_label ?? 'Unlabeled section'}</figcaption>
          </figure>
        ))}
        {sources.length > 1 && (
          <button type="button" className="link inline-flex items-center gap-1 text-xs" onClick={() => setShowAll(!showAll)}>
            <ChevronDown className={cn('size-3.5 transition-transform', showAll && 'rotate-180')} aria-hidden />
            {showAll ? 'Show fewer' : `${sources.length - 1} more ${sources.length === 2 ? 'mention' : 'mentions'}`}
          </button>
        )}
      </div>
      {reviewable && !editing && (
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-start">
          <Button size="sm" onClick={() => onAct('approve')} disabled={busy} aria-label={`Approve: ${d.entity_label ?? ''} ${attributeLabel(d.attribute)}`}>
            <Check /> Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAct('reject')} disabled={busy} aria-label={`Reject: ${d.entity_label ?? ''} ${attributeLabel(d.attribute)}`}>
            <X /> Reject
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit before approving">
            <Pencil />
          </Button>
        </div>
      )}
    </li>
  )
}
