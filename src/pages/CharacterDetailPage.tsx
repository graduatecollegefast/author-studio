import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Merge, Plus, Trash2, X } from 'lucide-react'
import { PageBody } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/field'
import { ErrorState, PageLoader } from '@/components/ui/feedback'
import { CanonList, useBookTitles } from '@/components/bible/Evidence'
import { MergeCharactersDialog } from '@/components/bible/MergeCharactersDialog'
import { attributeLabel } from '@/components/analysis/DiscoveryReview'
import {
  APPEARANCE_FIELDS,
  approvedFactsFor,
  characterBooks,
  characterStates,
  deleteCharacter,
  getCharacter,
  HISTORY_FIELDS,
  PERSONALITY_FIELDS,
  relationshipsFor,
  updateCharacter,
  type Character,
} from '@/services/bible'

const IDENTITY: Array<[keyof Character, string]> = [
  ['full_name', 'Full name'],
  ['preferred_name', 'Preferred name'],
  ['pronouns', 'Pronouns'],
  ['gender_identity', 'Gender identity'],
  ['sexual_orientation', 'Sexual orientation'],
  ['romantic_orientation', 'Romantic orientation'],
  ['date_of_birth', 'Date of birth'],
  ['age', 'Age'],
  ['occupation', 'Occupation'],
  ['residence', 'Where they live'],
  ['education', 'Education'],
  ['role', 'Story role'],
]

type Draft = Omit<Character, 'nicknames' | 'aliases' | 'custom_fields'> & {
  nicknames: string
  aliases: string
  custom: Array<{ key: string; value: string }>
}

function toDraft(c: Character): Draft {
  return {
    ...c,
    nicknames: c.nicknames.join(', '),
    aliases: c.aliases.join(', '),
    custom: Object.entries(c.custom_fields ?? {}).map(([key, value]) => ({ key, value: String(value) })),
  }
}

const splitList = (s: string) => [
  ...new Set(
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  ),
]
const compact = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v && v.trim()))

export function CharacterDetailPage() {
  const { characterId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const character = useQuery({ queryKey: ['characters', 'one', characterId], queryFn: () => getCharacter(characterId) })
  const facts = useQuery({ queryKey: ['characters', 'facts', characterId], queryFn: () => approvedFactsFor('character', characterId) })
  const states = useQuery({ queryKey: ['characters', 'states', characterId], queryFn: () => characterStates(characterId) })
  const rels = useQuery({ queryKey: ['characters', 'rels', characterId], queryFn: () => relationshipsFor(characterId) })
  const books = useQuery({ queryKey: ['characters', 'books', characterId], queryFn: () => characterBooks(characterId) })
  const titles = useBookTitles()
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [params, setParams] = useSearchParams()
  const mergeParam = params.get('merge')
  const [merging, setMerging] = React.useState(Boolean(mergeParam))

  React.useEffect(() => {
    if (character.data) setDraft(toDraft(character.data))
  }, [character.data])

  if (character.isLoading || !draft) {
    if (character.error)
      return (
        <PageBody>
          <ErrorState error={character.error} onRetry={() => void character.refetch()} />
        </PageBody>
      )
    return <PageLoader label="Loading character" />
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v })
  const setSection = (section: 'appearance' | 'personality' | 'history', key: string, v: string) =>
    setDraft({ ...draft, [section]: { ...draft[section], [key]: v } })

  async function save() {
    if (!draft) return
    if (!draft.full_name.trim()) return toast.error('A character needs a full name.')
    setSaving(true)
    try {
      await updateCharacter(characterId, {
        full_name: draft.full_name.trim(),
        preferred_name: draft.preferred_name?.trim() || null,
        nicknames: splitList(draft.nicknames),
        aliases: splitList(draft.aliases),
        pronouns: draft.pronouns?.trim() || null,
        gender_identity: draft.gender_identity?.trim() || null,
        sexual_orientation: draft.sexual_orientation?.trim() || null,
        romantic_orientation: draft.romantic_orientation?.trim() || null,
        date_of_birth: draft.date_of_birth?.trim() || null,
        age: draft.age?.trim() || null,
        occupation: draft.occupation?.trim() || null,
        residence: draft.residence?.trim() || null,
        education: draft.education?.trim() || null,
        role: draft.role?.trim() || null,
        appearance: compact(draft.appearance),
        personality: compact(draft.personality),
        history: compact(draft.history),
        custom_fields: Object.fromEntries(draft.custom.filter((c) => c.key.trim()).map((c) => [c.key.trim(), c.value])),
        notes: draft.notes?.trim() || null,
      })
      toast.success('Character saved')
      qc.invalidateQueries({ queryKey: ['characters'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const section = (title: string, key: 'appearance' | 'personality' | 'history', fields: ReadonlyArray<readonly [string, string]>) => (
    <Card>
      <CardHeader title={title} />
      <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
        {fields.map(([k, label]) => (
          <Field key={k} label={label} htmlFor={`${key}-${k}`}>
            <Textarea id={`${key}-${k}`} className="min-h-16" value={draft[key]?.[k] ?? ''} onChange={(e) => setSection(key, k, e.target.value)} />
          </Field>
        ))}
      </div>
    </Card>
  )

  const statesByBook = new Map<string, typeof states.data>()
  for (const s of states.data ?? []) {
    const k = s.book_id ?? ''
    statesByBook.set(k, [...(statesByBook.get(k) ?? []), s])
  }

  return (
    <PageBody>
      <Link to="/characters" className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Character Bible
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold">{character.data!.full_name}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {(books.data ?? []).map((b, i) => (
              <React.Fragment key={b.id}>
                {i > 0 && ', '}
                <Link className="link" to={`/books/${b.id}`}>
                  {b.title}
                </Link>
              </React.Fragment>
            ))}
            {!books.data?.length && 'Not linked to a book yet'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMerging(true)}>
            <Merge /> Merge duplicates
          </Button>
          <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving...' : 'Save character'}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Identity" />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
            {IDENTITY.map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`id-${k}`}>
                <Input
                  id={`id-${k}`}
                  value={(draft[k as keyof Draft] as string | null) ?? ''}
                  onChange={(e) => set(k as keyof Draft, e.target.value as never)}
                />
              </Field>
            ))}
            <Field label="Nicknames" htmlFor="id-nicknames" hint="Separate with commas">
              <Input id="id-nicknames" value={draft.nicknames} onChange={(e) => set('nicknames', e.target.value)} />
            </Field>
            <Field label="Aliases" htmlFor="id-aliases" hint="Separate with commas">
              <Input id="id-aliases" value={draft.aliases} onChange={(e) => set('aliases', e.target.value)} />
            </Field>
          </div>
        </Card>

        {section('Appearance', 'appearance', APPEARANCE_FIELDS)}
        {section('Personality', 'personality', PERSONALITY_FIELDS)}
        {section('History', 'history', HISTORY_FIELDS)}

        <Card>
          <CardHeader
            title="Custom fields and notes"
            action={
              <Button size="sm" variant="secondary" onClick={() => set('custom', [...draft.custom, { key: '', value: '' }])}>
                <Plus /> Add field
              </Button>
            }
          />
          <div className="space-y-3 px-5 pb-5">
            {draft.custom.map((c, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label="Field name"
                  placeholder="Field"
                  className="max-w-48"
                  value={c.key}
                  onChange={(e) =>
                    set(
                      'custom',
                      draft.custom.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                    )
                  }
                />
                <Input
                  aria-label="Field value"
                  placeholder="Value"
                  value={c.value}
                  onChange={(e) =>
                    set(
                      'custom',
                      draft.custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove field"
                  onClick={() =>
                    set(
                      'custom',
                      draft.custom.filter((_, j) => j !== i),
                    )
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <Field label="Notes" htmlFor="character-notes">
              <Textarea id="character-notes" value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Relationships" />
          <div className="px-5 pb-5 text-sm">
            {!rels.data?.length ? (
              <p className="text-fg-muted">No relationships yet. Approve relationship discoveries to add them.</p>
            ) : (
              <ul className="divide-y divide-line" data-testid="character-relationships">
                {rels.data.map((r) => {
                  const other = r.character_a_id === characterId ? r.b : r.a
                  return (
                    <li key={r.id} className="py-2.5">
                      <span className="font-semibold">{r.custom_label ?? r.category.replace(/_/g, ' ')}</span>
                      {other && (
                        <>
                          {' with '}
                          <Link className="link" to={`/characters/${other.id}`}>
                            {other.full_name}
                          </Link>
                        </>
                      )}
                      {r.description && <p className="text-fg-muted">{r.description}</p>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Canon from your books" />
          <div className="px-5 pb-5">
            <CanonList facts={facts.data ?? []} empty="No approved facts yet. Approve discoveries on a book's AI analysis tab." />
          </div>
        </Card>

        <Card>
          <CardHeader title="Over time" />
          <div className="px-5 pb-5 text-sm">
            <p className="mb-3 text-fg-muted">Each book keeps its own version of a detail, so later books never overwrite earlier canon.</p>
            {!states.data?.length ? (
              <p className="text-fg-muted">Nothing recorded yet.</p>
            ) : (
              [...statesByBook.entries()].map(([bookId, rows]) => (
                <div key={bookId} className="mb-4">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-faint">{titles.data?.get(bookId) ?? 'No book'}</h3>
                  <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[12rem_1fr]">
                    {rows!.map((s) => (
                      <React.Fragment key={s.id}>
                        <dt className="text-fg-muted">{attributeLabel(s.attribute)}</dt>
                        <dd>
                          {s.value}
                          {s.notes && <span className="ml-2 text-xs text-fg-faint">({s.notes})</span>}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <MergeCharactersDialog
        open={merging}
        onOpenChange={(o) => {
          setMerging(o)
          if (!o && mergeParam) setParams({}, { replace: true })
        }}
        keep={{
          id: characterId,
          full_name: character.data!.full_name,
          preferred_name: character.data!.preferred_name,
          aliases: character.data!.aliases ?? [],
        }}
        preselected={mergeParam ? mergeParam.split(',') : []}
        onMerged={(n) => {
          toast.success(`${n} ${n === 1 ? 'character was' : 'characters were'} merged into ${character.data!.full_name}.`)
          void qc.invalidateQueries()
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this character?"
        description="The profile, its history over time and its relationships are deleted. Approved facts about this character stay in your books' review history."
        confirmLabel="Delete character"
        destructive
        onConfirm={async () => {
          await deleteCharacter(characterId)
          qc.invalidateQueries({ queryKey: ['characters'] })
          navigate('/characters', { replace: true })
        }}
      />
    </PageBody>
  )
}
