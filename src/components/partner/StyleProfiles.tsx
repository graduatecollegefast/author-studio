import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { EmptyState, Spinner } from '@/components/ui/feedback'
import { useBooks } from '@/hooks/queries'
import { listSeries } from '@/services/story'
import { createProfile, deleteProfile, listProfiles, runAssistAndWait, setBookAI, updateProfile, type StyleProfile } from '@/services/writing'
import { supabase } from '@/lib/supabase/client'
import { formatNumber, formatRelative } from '@/lib/utils'

export const STYLE_FIELDS: Array<[string, string]> = [
  ['narrative_voice', 'Narrative voice'],
  ['pov', 'Preferred POV'],
  ['tense', 'Preferred tense'],
  ['sentence_patterns', 'Sentence patterns'],
  ['dialogue_style', 'Dialogue style'],
  ['pacing', 'Pacing'],
  ['description_density', 'Description density'],
  ['emotional_intensity', 'Emotional intensity'],
  ['humor', 'Humor'],
  ['romantic_tension', 'Romantic tension'],
  ['character_development', 'Character development techniques'],
  ['chapter_structure', 'Chapter structure'],
  ['scene_transitions', 'Scene transitions'],
  ['common_themes', 'Common themes'],
]

const SCOPES = [
  ['author', 'My overall style'],
  ['pen_name', 'A pen name'],
  ['series', 'A series'],
  ['book', 'One book'],
] as const

/** Writing style profiles: analyze, update, edit preferences, compare, and use for drafting. */
export function StyleProfiles() {
  const qc = useQueryClient()
  const profiles = useQuery({ queryKey: ['style-profiles'], queryFn: listProfiles })
  const books = useBooks()
  const series = useQuery({ queryKey: ['series'], queryFn: listSeries })
  const penNames = useQuery({
    queryKey: ['pen-names'],
    queryFn: async () => {
      const { data } = await supabase.from('books').select('pen_name').not('pen_name', 'is', null)
      return [...new Set((data ?? []).map((b) => b.pen_name as string).filter(Boolean))]
    },
  })
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState({ scope: 'author' as StyleProfile['scope'], name: '', target: '' })
  const [editing, setEditing] = React.useState<StyleProfile | null>(null)
  const [deleting, setDeleting] = React.useState<StyleProfile | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [compare, setCompare] = React.useState<[string, string]>(['', ''])
  const refresh = () => qc.invalidateQueries({ queryKey: ['style-profiles'] })

  const scopeLabel = (p: StyleProfile) =>
    p.scope === 'author'
      ? 'Overall author style'
      : p.scope === 'pen_name'
        ? `Pen name: ${p.pen_name}`
        : p.scope === 'series'
          ? `Series: ${series.data?.find((s) => s.id === p.series_id)?.name ?? 'series'}`
          : `Book: ${books.data?.find((b) => b.id === p.book_id)?.title ?? 'book'}`

  async function analyze(p: StyleProfile) {
    setBusy(p.id)
    try {
      await runAssistAndWait('analyze_style', p.id)
      toast.success('Style profile updated from your writing')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not analyze')
    } finally {
      setBusy(null)
    }
  }

  const [a, b] = compare.map((id) => profiles.data?.find((p) => p.id === id))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">
          The AI learns how you write from your own chapters: voice, rhythm, dialogue, pacing. It stores descriptions of your patterns, never your passages, and uses the profile you choose when drafting.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus /> New style profile
        </Button>
      </div>

      {profiles.isLoading ? (
        <Spinner />
      ) : !profiles.data?.length ? (
        <EmptyState icon={<Sparkles />} title="No style profiles yet">
          Create one for your overall style, a pen name, a series or a single book, then let the AI analyze your voice.
        </EmptyState>
      ) : (
        <ul className="space-y-4" data-testid="style-profiles">
          {profiles.data.map((p) => (
            <li key={p.id}>
              <Card>
                <CardHeader
                  title={p.name}
                  action={
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ai" disabled={busy !== null} onClick={() => void analyze(p)}>
                        {busy === p.id ? <Loader2 className="animate-spin" /> : <Sparkles />} {p.analyzed_at ? 'Update writing profile' : 'Analyze my voice'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                        <Pencil /> Edit style preferences
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                        <Trash2 />
                      </Button>
                    </div>
                  }
                />
                <div className="space-y-3 px-5 pb-5 text-sm">
                  <p className="text-xs text-fg-muted">
                    {scopeLabel(p)}
                    {p.analyzed_at ? ` · learned from ${formatNumber(p.sample_words)} words in ${p.source_book_ids.length} ${p.source_book_ids.length === 1 ? 'book' : 'books'} · ${formatRelative(p.analyzed_at)}` : ' · not analyzed yet'}
                  </p>
                  {p.summary && <p data-testid="style-summary">{p.summary}</p>}
                  {p.preferences && (
                    <p className="rounded-lg bg-panel-2 p-2">
                      <span className="font-semibold">Your preferences:</span> {p.preferences}
                    </p>
                  )}
                  {p.analyzed_at && (
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-fg-muted">All style details</summary>
                      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                        {STYLE_FIELDS.map(([k, label]) => (
                          <div key={k}>
                            <dt className="text-xs font-semibold text-fg-muted">{label}</dt>
                            <dd>{p.profile?.[k] || <span className="text-fg-faint">Not set</span>}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                  <UseForBook profile={p} books={(books.data ?? []).map((x) => ({ id: x.id, title: x.title, current: x.style_profile_id }))} onDone={() => qc.invalidateQueries({ queryKey: ['books'] })} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {(profiles.data?.length ?? 0) >= 2 && (
        <Card>
          <CardHeader title="Compare styles" />
          <div className="space-y-4 px-5 pb-5 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <Field key={i} label={i === 0 ? 'First profile' : 'Second profile'} htmlFor={`cmp-${i}`}>
                  <Select id={`cmp-${i}`} value={compare[i]} onChange={(e) => setCompare(i === 0 ? [e.target.value, compare[1]] : [compare[0], e.target.value])}>
                    <option value="">Choose</option>
                    {profiles.data!.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            {a && b && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="style-compare">
                  <thead className="text-xs text-fg-muted">
                    <tr>
                      <th className="py-1.5 pr-3 font-semibold">Aspect</th>
                      <th className="py-1.5 pr-3 font-semibold">{a.name}</th>
                      <th className="py-1.5 font-semibold">{b.name}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line align-top">
                    {[['summary', 'Summary'] as [string, string], ...STYLE_FIELDS].map(([k, label]) => {
                      const va = k === 'summary' ? a.summary : a.profile?.[k]
                      const vb = k === 'summary' ? b.summary : b.profile?.[k]
                      return (
                        <tr key={k}>
                          <th scope="row" className="py-2 pr-3 font-semibold">
                            {label}
                          </th>
                          <td className="py-2 pr-3">{va || <span className="text-fg-faint">Not set</span>}</td>
                          <td className="py-2">{vb || <span className="text-fg-faint">Not set</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New style profile">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!draft.name.trim()) return
              if (draft.scope !== 'author' && !draft.target) return toast.error('Choose what this profile covers.')
              try {
                await createProfile({
                  scope: draft.scope,
                  name: draft.name,
                  pen_name: draft.scope === 'pen_name' ? draft.target : null,
                  series_id: draft.scope === 'series' ? draft.target : null,
                  book_id: draft.scope === 'book' ? draft.target : null,
                })
                setCreating(false)
                setDraft({ scope: 'author', name: '', target: '' })
                refresh()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not create')
              }
            }}
          >
            <Field label="Name" htmlFor="sp-name">
              <Input id="sp-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </Field>
            <Field label="Learns from" htmlFor="sp-scope">
              <Select id="sp-scope" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as StyleProfile['scope'], target: '' })}>
                {SCOPES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.scope !== 'author' && (
              <Field label={{ pen_name: 'Pen name', series: 'Series', book: 'Book' }[draft.scope]} htmlFor="sp-target">
                <Select id="sp-target" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })}>
                  <option value="">Choose</option>
                  {draft.scope === 'pen_name' && (penNames.data ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
                  {draft.scope === 'series' && (series.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {draft.scope === 'book' && (books.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </Select>
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <EditProfile profile={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this style profile?"
        description="Books using it will draft without a style profile until you choose another. Your manuscripts are not affected."
        confirmLabel="Delete profile"
        destructive
        onConfirm={async () => {
          await deleteProfile(deleting!.id)
          setDeleting(null)
          refresh()
        }}
      />
    </div>
  )
}

function UseForBook({ profile, books, onDone }: { profile: StyleProfile; books: Array<{ id: string; title: string; current: string | null }>; onDone: () => void }) {
  const [bookId, setBookId] = React.useState('')
  const using = books.filter((b) => b.current === profile.id)
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <Field label="Use this style for drafting in" htmlFor={`use-${profile.id}`} className="w-full max-w-xs">
        <Select id={`use-${profile.id}`} value={bookId} onChange={(e) => setBookId(e.target.value)}>
          <option value="">Choose a book</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        size="sm"
        variant="secondary"
        disabled={!bookId}
        onClick={async () => {
          try {
            await setBookAI(bookId, { style_profile_id: profile.id })
            toast.success('Style set for that book')
            setBookId('')
            onDone()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not set')
          }
        }}
      >
        Use this style for drafting
      </Button>
      {using.length > 0 && <Badge tone="progress">Used by {using.map((b) => b.title).join(', ')}</Badge>}
    </div>
  )
}

function EditProfile({ profile, onClose, onSaved }: { profile: StyleProfile | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = React.useState<StyleProfile | null>(profile)
  React.useEffect(() => setV(profile), [profile])
  if (!v) return <Dialog open={false} />
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Edit ${v.name}`} className="max-w-2xl">
        <form
          className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await updateProfile(v.id, { name: v.name.trim() || 'Style', summary: v.summary, preferences: v.preferences, profile: v.profile })
              toast.success('Style preferences saved')
              onSaved()
              onClose()
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not save')
            }
          }}
        >
          <Field label="Name" htmlFor="ep-name">
            <Input id="ep-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Your preferences" htmlFor="ep-pref" hint="Rules the AI should always follow, like 'never use semicolons' or 'keep sex scenes closed-door'.">
            <Textarea id="ep-pref" value={v.preferences ?? ''} onChange={(e) => setV({ ...v, preferences: e.target.value })} />
          </Field>
          <Field label="Summary" htmlFor="ep-summary">
            <Textarea id="ep-summary" value={v.summary ?? ''} onChange={(e) => setV({ ...v, summary: e.target.value })} />
          </Field>
          {STYLE_FIELDS.map(([k, label]) => (
            <Field key={k} label={label} htmlFor={`ep-${k}`}>
              <Textarea id={`ep-${k}`} className="min-h-16" value={v.profile?.[k] ?? ''} onChange={(e) => setV({ ...v, profile: { ...(v.profile ?? {}), [k]: e.target.value } })} />
            </Field>
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
