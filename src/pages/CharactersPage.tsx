import * as React from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Search, Sparkles, Users } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { createCharacter, listCharacters } from '@/services/bible'
import { listPendingDiscoveryBooks } from '@/services/ai'
import { useBookTitles } from '@/components/bible/Evidence'
import { formatNumber } from '@/lib/utils'

/** Banner linking to books with discoveries waiting for review. */
export function PendingReviewBanner() {
  const pending = useQuery({ queryKey: ['discoveries', 'pending-books'], queryFn: listPendingDiscoveryBooks })
  const titles = useBookTitles()
  if (!pending.data?.length) return null
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-ai-soft px-4 py-3 text-sm text-ai-text">
      <Sparkles className="size-4" aria-hidden />
      <span>Discoveries waiting for your review:</span>
      {pending.data.map((p) => (
        <Link key={p.book_id} to={`/books/${p.book_id}?tab=analysis`} className="font-semibold underline">
          {titles.data?.get(p.book_id) ?? 'A book'} ({formatNumber(p.count)})
        </Link>
      ))}
    </div>
  )
}

export function CharactersPage() {
  const navigate = useNavigate()
  const [search, setSearch] = React.useState('')
  const [q, setQ] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search), 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useQuery({ queryKey: ['characters', q], queryFn: () => listCharacters(q) })
  const [creating, setCreating] = React.useState(false)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  return (
    <PageBody>
      <PageHeader
        eyebrow="Story Bible"
        title="Character Bible"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New character
          </Button>
        }
      >
        Every character across your books. Profiles grow as you approve discoveries from AI analysis, and you can edit anything.
      </PageHeader>
      <PendingReviewBanner />
      <div className="relative mb-6 max-w-sm">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-fg-faint" aria-hidden />
        <Input className="pl-9" placeholder="Search characters" aria-label="Search characters" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState icon={<Users />} title={q ? 'No characters match' : 'No characters yet'}>
          {q ? 'Try another name.' : 'Analyze a book from its AI analysis tab, or add a character yourself.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="character-list">
          {list.data.map((c) => {
            const books = new Set(c.character_appearances.map((a) => a.book_id)).size
            return (
              <li key={c.id}>
                <Card className="h-full p-4 hover:bg-panel-2">
                  <Link to={`/characters/${c.id}`} className="block">
                    <span className="font-serif text-lg font-semibold text-fg">{c.full_name}</span>
                    {c.preferred_name && c.preferred_name !== c.full_name && <span className="ml-2 text-sm text-fg-muted">"{c.preferred_name}"</span>}
                    <span className="mt-1 block text-sm text-fg-muted">{[c.role, c.occupation].filter(Boolean).join(' · ') || 'No role yet'}</span>
                    <span className="mt-2 block text-xs text-fg-faint">
                      {books} {books === 1 ? 'book' : 'books'}
                      {c.aliases.length ? ` · also known as ${c.aliases.slice(0, 3).join(', ')}` : ''}
                    </span>
                  </Link>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={(o) => !busy && setCreating(o)}>
        <DialogContent title="New character">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!name.trim()) return
              setBusy(true)
              try {
                const id = await createCharacter(name)
                setCreating(false)
                setName('')
                navigate(`/characters/${id}`)
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not create the character')
              } finally {
                setBusy(false)
              }
            }}
          >
            <Field label="Full name" htmlFor="new-character-name">
              <Input id="new-character-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                Create character
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageBody>
  )
}
