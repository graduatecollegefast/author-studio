import * as React from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/card'
import { Label, Textarea } from '@/components/ui/field'
import { Spinner } from '@/components/ui/feedback'
import { approvedFactsFor, listCharacters, listWorldElements } from '@/services/bible'
import { listFindings } from '@/services/story'
import { supabase } from '@/lib/supabase/client'
import { throwIfError } from '@/services/errors'
import { attributeLabel } from '@/components/analysis/DiscoveryReview'
import { cn, labelize } from '@/lib/utils'
import type { Book } from '@/types/db'
import { AIPanel } from './AIPanel'
import { VersionHistory } from './VersionHistory'
import type { SceneEditorHandle } from './SceneEditor'

const TABS = [
  { id: 'ai', label: 'AI' },
  { id: 'bible', label: 'Bible' },
  { id: 'notes', label: 'Notes' },
  { id: 'continuity', label: 'Continuity' },
  { id: 'history', label: 'History' },
] as const
type Tab = (typeof TABS)[number]['id']
const TAB_KEY = 'author-studio:side-tab'

interface Props {
  book: Book
  sceneId: string
  chapterId: string
  sceneText: string
  editorRef: React.RefObject<SceneEditorHandle | null>
  onOpenScene: (id: string) => void
}

/** Right panel of the Writing Studio: AI partner, Story Bible references, notes, continuity, history. */
export function StudioSidePanel(props: Props) {
  const [tab, setTabState] = React.useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || 'ai'
    } catch {
      return 'ai'
    }
  })
  const setTab = (t: Tab) => {
    setTabState(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      // ignore
    }
  }
  return (
    <div>
      <div role="tablist" aria-label="Side panel" className="mb-4 flex flex-wrap gap-1 border-b border-m-bar-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('-mb-px border-b-2 px-2 pb-2 text-xs font-semibold', tab === t.id ? 'border-ring text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'ai' && <AIPanel book={props.book} sceneId={props.sceneId} chapterId={props.chapterId} editorRef={props.editorRef} onOpenScene={props.onOpenScene} />}
        {tab === 'bible' && <BibleRefs sceneText={props.sceneText} />}
        {tab === 'notes' && <SceneNotes sceneId={props.sceneId} chapterId={props.chapterId} />}
        {tab === 'continuity' && <ContinuityWarnings bookId={props.book.id} sceneId={props.sceneId} chapterId={props.chapterId} />}
        {tab === 'history' && <VersionHistory sceneId={props.sceneId} editorRef={props.editorRef} />}
      </div>
    </div>
  )
}

function BibleRefs({ sceneText }: { sceneText: string }) {
  const chars = useQuery({ queryKey: ['characters', ''], queryFn: () => listCharacters('') })
  const world = useQuery({ queryKey: ['world', '', ''], queryFn: () => listWorldElements('', '') })
  const text = sceneText.toLowerCase()
  const firsts = new Map<string, number>()
  for (const c of chars.data ?? []) firsts.set(c.full_name.split(' ')[0], (firsts.get(c.full_name.split(' ')[0]) ?? 0) + 1)
  const present = (chars.data ?? []).filter((c) => {
    const names = [c.full_name, c.preferred_name ?? '', ...c.aliases]
    const first = c.full_name.split(' ')[0]
    if (first.length >= 3 && firsts.get(first) === 1) names.push(first)
    return names.some((n) => n && new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase()}(?=$|[^\\p{L}])`, 'u').test(text))
  })
  const places = (world.data ?? []).filter((w) => w.name.length >= 3 && text.includes(w.name.toLowerCase()))
  if (chars.isLoading || world.isLoading) return <Spinner />
  return (
    <div className="space-y-4 text-sm" data-testid="bible-refs">
      {!present.length && !places.length && <p className="text-fg-muted">No characters or places from the Story Bible are mentioned in this scene yet.</p>}
      {present.map((c) => (
        <CharacterCard key={c.id} id={c.id} name={c.full_name} role={[c.role, c.occupation].filter(Boolean).join(' · ')} />
      ))}
      {places.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Places and world</h3>
          <ul className="space-y-1">
            {places.map((w) => (
              <li key={w.id}>
                <Link className="link font-semibold" to={`/world/${w.id}`}>
                  {w.name}
                </Link>
                {w.description && <span className="text-fg-muted">: {w.description.slice(0, 140)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function CharacterCard({ id, name, role }: { id: string; name: string; role: string }) {
  const facts = useQuery({ queryKey: ['characters', 'facts', id], queryFn: () => approvedFactsFor('character', id) })
  return (
    <section className="rounded-lg border border-line p-3">
      <Link className="link font-serif font-semibold" to={`/characters/${id}`}>
        {name}
      </Link>
      {role && <p className="text-xs text-fg-muted">{role}</p>}
      <ul className="mt-1 space-y-0.5 text-xs">
        {(facts.data ?? []).slice(0, 8).map((f) => (
          <li key={f.id}>
            <span className="text-fg-muted">{attributeLabel(f.attribute)}:</span> {f.value}
          </li>
        ))}
      </ul>
    </section>
  )
}

function SceneNotes({ sceneId, chapterId }: { sceneId: string; chapterId: string }) {
  const qc = useQueryClient()
  const data = useQuery({
    queryKey: ['scene-notes', sceneId],
    queryFn: async () => {
      const [{ data: s, error: e1 }, { data: c, error: e2 }] = await Promise.all([
        supabase.from('scenes').select('summary').eq('id', sceneId).single(),
        supabase.from('chapters').select('summary').eq('id', chapterId).single(),
      ])
      throwIfError(e1 ?? e2)
      return { scene: (s?.summary as string | null) ?? '', chapter: (c?.summary as string | null) ?? '' }
    },
  })
  const [scene, setScene] = React.useState('')
  const [chapter, setChapter] = React.useState('')
  React.useEffect(() => {
    if (data.data) {
      setScene(data.data.scene)
      setChapter(data.data.chapter)
    }
  }, [data.data])
  const save = async (table: 'scenes' | 'chapters', id: string, value: string) => {
    const { error } = await supabase.from(table).update({ summary: value.trim() || null }).eq('id', id)
    if (error) toast.error('Could not save the note')
    else qc.invalidateQueries({ queryKey: ['scene-notes', sceneId] })
  }
  if (data.isLoading) return <Spinner />
  return (
    <div className="space-y-4 text-sm">
      <div>
        <Label htmlFor="note-scene">Scene notes</Label>
        <Textarea id="note-scene" className="min-h-32" value={scene} onChange={(e) => setScene(e.target.value)} onBlur={() => void save('scenes', sceneId, scene)} />
      </div>
      <div>
        <Label htmlFor="note-chapter">Chapter summary</Label>
        <Textarea id="note-chapter" className="min-h-24" value={chapter} onChange={(e) => setChapter(e.target.value)} onBlur={() => void save('chapters', chapterId, chapter)} />
      </div>
      <p className="text-xs text-fg-faint">Notes save when you leave the box. The AI reads chapter summaries as part of the outline.</p>
    </div>
  )
}

function ContinuityWarnings({ bookId, sceneId, chapterId }: { bookId: string; sceneId: string; chapterId: string }) {
  const findings = useQuery({ queryKey: ['findings', bookId], queryFn: () => listFindings(bookId) })
  const here = (findings.data ?? []).filter((f) => (f.status === 'open' || f.status === 'saved_for_later') && (f.scene_id === sceneId || (!f.scene_id && f.chapter_id === chapterId)))
  if (findings.isLoading) return <Spinner />
  return (
    <div className="space-y-3 text-sm">
      {!here.length ? (
        <p className="text-fg-muted">No open continuity warnings for this scene.</p>
      ) : (
        <ul className="space-y-2">
          {here.map((f) => (
            <li key={f.id} className="rounded-lg border border-line p-3">
              <Badge tone={f.severity === 'suggestion' ? 'info' : 'alert'}>{labelize(f.severity)}</Badge>
              <p className="mt-1">{f.description}</p>
              {f.conflicting_evidence && <p className="mt-1 font-serif italic text-fg-muted">"{f.conflicting_evidence}"</p>}
            </li>
          ))}
        </ul>
      )}
      <Link className="link text-xs font-semibold" to={`/continuity?book=${bookId}`}>
        Open the Continuity Checker
      </Link>
    </div>
  )
}
