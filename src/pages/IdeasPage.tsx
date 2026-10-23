import * as React from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRightLeft, Lightbulb, Link2, Loader2, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/card'
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { Checklist } from '@/components/ui/checklist'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menu'
import { useBooks } from '@/hooks/queries'
import { listCharacters } from '@/services/bible'
import { listChapters } from '@/services/chapters'
import { listSeries, listUniverses } from '@/services/story'
import { convertIdea, deleteIdea, IDEA_CATEGORIES, IDEA_STATUSES, listIdeas, runAssistAndWait, saveIdea, type Idea, type IdeaInput } from '@/services/writing'
import { formatDate, labelize } from '@/lib/utils'

const CAT = Object.fromEntries(IDEA_CATEGORIES) as Record<string, string>
/** Only the editable fields of an idea, so saves never send read-only columns. */
const toInput = (i: Idea): IdeaInput => ({
  id: i.id,
  title: i.title,
  description: i.description,
  category: i.category,
  tags: i.tags,
  status: i.status,
  book_id: i.book_id,
  series_id: i.series_id,
  universe_id: i.universe_id,
  characterIds: i.idea_characters.map((c) => c.character_id),
})
const blank = (): IdeaInput => ({ title: '', description: '', category: 'general_note', tags: [], status: 'new', book_id: null, series_id: null, universe_id: null, characterIds: [] })

export function IdeasPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const ideas = useQuery({ queryKey: ['ideas'], queryFn: listIdeas })
  const books = useBooks()
  const series = useQuery({ queryKey: ['series'], queryFn: listSeries })
  const universes = useQuery({ queryKey: ['universes'], queryFn: listUniverses })
  const chars = useQuery({ queryKey: ['characters', ''], queryFn: () => listCharacters('') })
  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [tag, setTag] = React.useState('')
  const [editing, setEditing] = React.useState<IdeaInput | null>(null)
  const [tagsText, setTagsText] = React.useState('')
  const [deleting, setDeleting] = React.useState<Idea | null>(null)
  const [toScene, setToScene] = React.useState<Idea | null>(null)
  const [linking, setLinking] = React.useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['ideas'] })

  const name = {
    book: new Map((books.data ?? []).map((b) => [b.id, b.title])),
    series: new Map((series.data ?? []).map((s) => [s.id, s.name])),
    universe: new Map((universes.data ?? []).map((u) => [u.id, u.name])),
    character: new Map((chars.data ?? []).map((c) => [c.id, c.full_name])),
  }
  const allTags = [...new Set((ideas.data ?? []).flatMap((i) => i.tags))].sort()
  const q = search.trim().toLowerCase()
  const shown = (ideas.data ?? []).filter(
    (i) =>
      (!q || i.title.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)) &&
      (!category || i.category === category) &&
      (!status || i.status === status) &&
      (!tag || i.tags.includes(tag)),
  )

  const open = (i?: Idea) => {
    const v = i ? toInput(i) : blank()
    setEditing(v)
    setTagsText(v.tags.join(', '))
  }

  async function suggest(i: Idea) {
    setLinking(i.id)
    try {
      await runAssistAndWait('idea_links', i.id)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not suggest connections')
    } finally {
      setLinking(null)
    }
  }

  async function applyLink(i: Idea, l: Idea['suggested_links'][number]) {
    const v = toInput(i)
    if (l.type === 'book') v.book_id = l.id
    if (l.type === 'series') v.series_id = l.id
    if (l.type === 'universe') v.universe_id = l.id
    if (l.type === 'character' && !v.characterIds.includes(l.id)) v.characterIds = [...v.characterIds, l.id]
    try {
      await saveIdea(v)
      toast.success(`Linked to ${l.label}`)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not link')
    }
  }

  async function convert(i: Idea, to: 'book' | 'character' | 'plot_thread') {
    try {
      const r = await convertIdea(i, to)
      refresh()
      if (to === 'book') navigate(`/books/${r.id}`)
      else if (to === 'character') navigate(`/characters/${r.id}`)
      else toast.success(i.series_id ? 'Added to the series as a plot thread' : i.universe_id ? 'Added to the universe as a plot thread' : 'Plot thread created')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not convert')
    }
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="Story world"
        title="Ideas Vault"
        actions={
          <Button onClick={() => open()}>
            <Plus /> New idea
          </Button>
        }
      >
        Catch half-formed ideas before they get away. Link them to your projects, let the AI suggest where they fit, and turn them into books, characters, plot threads or scenes.
      </PageHeader>

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-fg-faint" aria-hidden />
            <Input className="pl-9" placeholder="Search ideas" aria-label="Search ideas" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {IDEA_CATEGORIES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelize(s)}
              </option>
            ))}
          </Select>
          <Select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Any tag</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {ideas.isLoading ? (
        <Spinner />
      ) : ideas.error ? (
        <ErrorState error={ideas.error} onRetry={() => void ideas.refetch()} />
      ) : !shown.length ? (
        <EmptyState icon={<Lightbulb />} title={ideas.data?.length ? 'No ideas match' : 'No ideas yet'}>
          {ideas.data?.length ? 'Clear a filter to see more.' : 'Add your first idea, however rough.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" data-testid="ideas">
          {shown.map((i) => (
            <li key={i.id} data-testid="idea">
              <Card className="flex h-full flex-col p-4">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge tone="info">{CAT[i.category]}</Badge>
                  <Badge tone={i.status === 'used' ? 'progress' : 'neutral'}>{labelize(i.status)}</Badge>
                  {i.tags.map((t) => (
                    <Badge key={t}>#{t}</Badge>
                  ))}
                  <span className="ml-auto text-fg-faint">{formatDate(i.created_at)}</span>
                </div>
                <h2 className="mt-2 font-serif text-lg font-semibold">{i.title}</h2>
                {i.description && <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{i.description}</p>}
                <p className="mt-2 text-xs text-fg-muted">
                  {[
                    i.book_id && `Book: ${name.book.get(i.book_id) ?? ''}`,
                    i.series_id && `Series: ${name.series.get(i.series_id) ?? ''}`,
                    i.universe_id && `Universe: ${name.universe.get(i.universe_id) ?? ''}`,
                    i.idea_characters.length && `Characters: ${i.idea_characters.map((c) => name.character.get(c.character_id)).filter(Boolean).join(', ')}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {i.converted_entity_type && (
                  <p className="mt-1 text-xs">
                    Became a {labelize(i.converted_entity_type).toLowerCase()}
                    {i.converted_entity_type === 'book' && (
                      <>
                        {': '}
                        <Link className="link" to={`/books/${i.converted_entity_id}`}>
                          open
                        </Link>
                      </>
                    )}
                    {i.converted_entity_type === 'character' && (
                      <>
                        {': '}
                        <Link className="link" to={`/characters/${i.converted_entity_id}`}>
                          open
                        </Link>
                      </>
                    )}
                  </p>
                )}
                {i.suggested_links.length > 0 && (
                  <div className="mt-3 rounded-lg bg-ai-soft p-3 text-sm" data-testid="idea-links">
                    <p className="mb-1 text-xs font-semibold text-ai-text">Suggested connections</p>
                    <ul className="space-y-1.5">
                      {i.suggested_links.map((l) => (
                        <li key={`${l.type}-${l.id}`} className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{l.label}</span>
                          <span className="text-xs text-fg-muted">({labelize(l.type)})</span>
                          <span className="text-xs text-fg-muted">{l.reason}</span>
                          <Button size="sm" variant="secondary" onClick={() => void applyLink(i, l)}>
                            <Link2 /> Link
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                  <Button size="sm" variant="ai" disabled={linking !== null} onClick={() => void suggest(i)}>
                    {linking === i.id ? <Loader2 className="animate-spin" /> : <Sparkles />} Suggest connections
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="secondary">
                        <ArrowRightLeft /> Turn into
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => void convert(i, 'book')}>A new book</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void convert(i, 'character')}>A character</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void convert(i, 'plot_thread')}>A plot thread</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setToScene(i)}>A scene</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${i.title}`} onClick={() => open(i)}>
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${i.title}`} onClick={() => setDeleting(i)}>
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing?.id ? 'Edit idea' : 'New idea'} className="max-w-2xl">
          {editing && (
            <form
              className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!editing.title.trim()) return
                try {
                  await saveIdea({ ...editing, tags: [...new Set(tagsText.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))] })
                  toast.success('Idea saved')
                  setEditing(null)
                  refresh()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not save')
                }
              }}
            >
              <Field label="Title" htmlFor="idea-title">
                <Input id="idea-title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={300} required />
              </Field>
              <Field label="Description" htmlFor="idea-description">
                <Textarea id="idea-description" className="min-h-28" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Category" htmlFor="idea-category">
                  <Select id="idea-category" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as Idea['category'] })}>
                    {IDEA_CATEGORIES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status" htmlFor="idea-status">
                  <Select id="idea-status" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as Idea['status'] })}>
                    {IDEA_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {labelize(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tags" htmlFor="idea-tags" hint="Separate with commas">
                  <Input id="idea-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
                </Field>
                {(
                  [
                    ['book_id', 'Related book', (books.data ?? []).map((b) => [b.id, b.title])],
                    ['series_id', 'Related series', (series.data ?? []).map((s) => [s.id, s.name])],
                    ['universe_id', 'Related universe', (universes.data ?? []).map((u) => [u.id, u.name])],
                  ] as const
                ).map(([k, label, options]) => (
                  <Field key={k} label={label} htmlFor={`idea-${k}`}>
                    <Select id={`idea-${k}`} value={editing[k] ?? ''} onChange={(e) => setEditing({ ...editing, [k]: e.target.value || null })}>
                      <option value="">None</option>
                      {options.map(([id, l]) => (
                        <option key={id} value={id}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
              <Checklist label="Characters" options={(chars.data ?? []).map((c) => ({ id: c.id, label: c.full_name }))} value={editing.characterIds} onChange={(ids) => setEditing({ ...editing, characterIds: ids })} empty="No characters yet." />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save idea</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <SceneTarget
        idea={toScene}
        books={(books.data ?? []).map((b) => ({ id: b.id, title: b.title }))}
        onClose={() => setToScene(null)}
        onDone={(bookId, sceneId) => {
          setToScene(null)
          refresh()
          navigate(`/books/${bookId}/write?scene=${sceneId}`)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this idea?"
        description="The idea is removed from the vault. Anything it was turned into stays."
        confirmLabel="Delete idea"
        destructive
        onConfirm={async () => {
          await deleteIdea(deleting!.id)
          setDeleting(null)
          refresh()
        }}
      />
    </PageBody>
  )
}

function SceneTarget({ idea, books, onClose, onDone }: { idea: Idea | null; books: Array<{ id: string; title: string }>; onClose: () => void; onDone: (bookId: string, sceneId: string) => void }) {
  const [bookId, setBookId] = React.useState('')
  const [chapterId, setChapterId] = React.useState('')
  React.useEffect(() => {
    setBookId(idea?.book_id ?? '')
    setChapterId('')
  }, [idea])
  const chapters = useQuery({ queryKey: ['chapters', bookId], queryFn: () => listChapters(bookId), enabled: Boolean(bookId) })
  return (
    <Dialog open={idea !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Turn this idea into a scene" description="A new scene is added at the end of the chapter you choose, holding the idea's text.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!idea) return
            try {
              const r = await convertIdea(idea, 'scene', { bookId, chapterId })
              onDone(bookId, r.id)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not create the scene')
            }
          }}
        >
          <Field label="Book" htmlFor="ts-book">
            <Select id="ts-book" value={bookId} onChange={(e) => setBookId(e.target.value)}>
              <option value="">Choose a book</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Chapter" htmlFor="ts-chapter">
            <Select id="ts-chapter" value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={!bookId}>
              <option value="">Choose a chapter</option>
              {(chapters.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!bookId || !chapterId}>
              Create scene
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
