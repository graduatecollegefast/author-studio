import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { Spinner } from '@/components/ui/feedback'
import { useBookTitles } from '@/components/bible/Evidence'
import { likelyDuplicates, listCharacters, mergeCharacters } from '@/services/bible'

/** Choose characters to fold into this one. Nothing changes until the author confirms. */
export function MergeCharactersDialog({
  open,
  onOpenChange,
  keep,
  preselected = [],
  onMerged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  keep: { id: string; full_name: string; preferred_name: string | null; aliases: string[] }
  preselected?: string[]
  onMerged: (count: number) => void
}) {
  const chars = useQuery({ queryKey: ['characters', ''], queryFn: () => listCharacters(''), enabled: open })
  const titles = useBookTitles()
  const [search, setSearch] = React.useState('')
  const [picked, setPicked] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)

  const all = (chars.data ?? []).filter((c) => c.id !== keep.id)
  const likely = new Set(chars.data ? likelyDuplicates(keep, chars.data) : [])
  React.useEffect(() => {
    if (open) {
      setPicked(preselected.filter((id) => id !== keep.id))
      setSearch('')
      setError(null)
      setConfirming(false)
    }
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const q = search.trim().toLowerCase()
  const shown = all
    .filter(
      (c) => !q || [c.full_name, c.preferred_name, ...(c.aliases ?? [])].some((n) => (n ?? '').toLowerCase().includes(q)) || picked.includes(c.id),
    )
    .sort((a, b) => Number(likely.has(b.id)) - Number(likely.has(a.id)) || a.full_name.localeCompare(b.full_name))
    .slice(0, 100)
  const names = all.filter((c) => picked.includes(c.id)).map((c) => c.full_name)
  const books = (c: (typeof all)[number]) => [...new Set(c.character_appearances.map((a) => titles.data?.get(a.book_id)).filter(Boolean))].join(', ')

  async function merge() {
    setBusy(true)
    setError(null)
    try {
      await mergeCharacters(keep.id, picked)
      onMerged(picked.length)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The characters could not be merged.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        title={`Merge into ${keep.full_name}`}
        description="Use this when the same person has more than one character record."
        className="max-w-xl"
      >
        {!confirming ? (
          <div className="space-y-4 text-sm">
            <label htmlFor="merge-search" className="sr-only">
              Find characters
            </label>
            <Input id="merge-search" placeholder="Find a character by name" value={search} onChange={(e) => setSearch(e.target.value)} />
            {chars.isLoading ? (
              <Spinner />
            ) : !all.length ? (
              <p className="text-fg-muted">There are no other characters to merge.</p>
            ) : (
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Characters to merge into {keep.full_name}
                </legend>
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2" data-testid="merge-candidates">
                  {shown.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1.5 hover:bg-panel-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-[var(--action)]"
                          checked={picked.includes(c.id)}
                          onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((id) => id !== c.id))}
                        />
                        <span className="min-w-0">
                          <span className="font-semibold text-fg">{c.full_name}</span> {likely.has(c.id) && <Badge tone="info">Same name</Badge>}
                          <span className="block text-xs text-fg-muted">
                            {[c.role, c.occupation, books(c) && `in ${books(c)}`].filter(Boolean).join(' · ') || 'No details yet'}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!picked.length} onClick={() => setConfirming(true)}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm" data-testid="merge-confirm">
            <p className="text-fg">
              Merge <strong>{names.join(', ')}</strong> into <strong>{keep.full_name}</strong>?
            </p>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              <li>
                {keep.full_name}'s details stay. Any detail it is missing is filled in from the merged {picked.length === 1 ? 'record' : 'records'}.
              </li>
              <li>Their names become aliases, and their notes are added to the notes.</li>
              <li>
                Every book, relationship, group, timeline event, place, idea, canon fact and discovery that pointed to them now points to{' '}
                {keep.full_name}.
              </li>
              <li>
                The merged {picked.length === 1 ? 'record is' : 'records are'} then removed. A full copy of each is kept in your activity history.
              </li>
            </ul>
            {error && (
              <p role="alert" className="text-alert-text">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => void merge()}>
                {busy ? 'Merging...' : `Merge ${picked.length} into ${keep.full_name}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
