import * as React from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Loader2, Pencil, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/card'
import { Label, Select, Textarea } from '@/components/ui/field'
import { AI_MODES, commandById, commandsForMode, proseToDoc, splitScenes, type AIMode, type WritingCommand } from '@/lib/ai/commands'
import { createCheckpoint } from '@/services/chapters'
import { closeProposal, insertDraft, listProfiles, listQuestions, recentProposals, requestProposal, setBookAI, type Proposal } from '@/services/writing'
import { qk } from '@/hooks/queries'
import { cn } from '@/lib/utils'
import type { Book } from '@/types/db'
import type { SceneEditorHandle } from './SceneEditor'

interface Props {
  book: Book
  sceneId: string
  chapterId: string
  editorRef: React.RefObject<SceneEditorHandle | null>
  onOpenScene: (id: string) => void
}

const GROUPS = [
  { id: 'write', label: 'Write' },
  { id: 'selection', label: 'Selected text' },
  { id: 'check', label: 'Check and plan' },
] as const

/** The AI Writing Partner in the Writing Studio. Every result is a proposal until the author accepts it. */
export function AIPanel({ book, sceneId, chapterId, editorRef, onOpenScene }: Props) {
  const qc = useQueryClient()
  const mode = (book.ai_mode ?? 'assistant') as AIMode
  const [direction, setDirection] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const proposals = useQuery({
    queryKey: ['proposals', sceneId],
    queryFn: () => recentProposals(sceneId),
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === 'generating') ? 1500 : false),
  })
  const profiles = useQuery({ queryKey: ['style-profiles'], queryFn: listProfiles })
  const questions = useQuery({ queryKey: ['questions', book.id], queryFn: () => listQuestions(book.id) })
  const openQuestions = (questions.data ?? []).filter((q) => q.status === 'open').length
  // New questions arrive when an "Ask Clarification Questions" proposal finishes.
  const finishedQuestionRuns = (proposals.data ?? []).filter((p) => p.command === 'questions' && p.status !== 'generating').map((p) => p.id).join(',')
  React.useEffect(() => {
    if (finishedQuestionRuns) qc.invalidateQueries({ queryKey: ['questions', book.id] })
  }, [finishedQuestionRuns, qc, book.id])
  const refreshBook = () => {
    qc.invalidateQueries({ queryKey: qk.book(book.id) })
    qc.invalidateQueries({ queryKey: qk.books })
  }

  async function run(cmd: WritingCommand, regenerateOf?: Proposal) {
    const editor = editorRef.current
    const selection = regenerateOf
      ? regenerateOf.original_text
        ? { from: regenerateOf.selection_from ?? 0, to: regenerateOf.selection_to ?? 0, text: regenerateOf.original_text }
        : null
      : (editor?.selection() ?? null)
    if (cmd.needsSelection && !selection) return toast.error('Select the passage in the manuscript first.')
    const instruction = regenerateOf ? (regenerateOf.instruction ?? '') : direction
    if (cmd.needsDirection && !instruction.trim()) return toast.error('Write a direction first: what should happen in it?')
    setBusy(cmd.id)
    try {
      await editor?.flush()
      if (regenerateOf) await closeProposal(regenerateOf.id, 'rejected')
      await requestProposal({
        bookId: book.id,
        sceneId,
        revision: editor?.revision() ?? 1,
        command: cmd.id,
        insertMode: cmd.insertMode,
        instruction,
        selection: cmd.group === 'write' ? null : selection,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not ask the AI')
    } finally {
      setBusy(null)
      qc.invalidateQueries({ queryKey: ['proposals', sceneId] })
    }
  }

  async function accept(p: Proposal, text: string, edited: boolean) {
    const editor = editorRef.current
    const cmd = commandById(p.command)
    if (!editor || !cmd) return
    const doc = proseToDoc(text)
    try {
      if (p.insert_mode === 'new_scene' || p.insert_mode === 'new_chapter') {
        await editor.flush()
        const made =
          p.insert_mode === 'new_scene'
            ? await insertDraft({ bookId: book.id, afterSceneId: sceneId, scenes: [{ title: 'New scene', content: doc, text }] })
            : await insertDraft({
                bookId: book.id,
                afterChapterId: chapterId,
                chapterTitle: 'New chapter',
                scenes: splitScenes(text).map((t, i) => ({ title: `Scene ${i + 1}`, content: proseToDoc(t), text: t })),
              })
        await closeProposal(p.id, edited ? 'edited' : 'accepted', text)
        qc.invalidateQueries({ queryKey: qk.chapters(book.id) })
        qc.invalidateQueries({ queryKey: qk.scenes(book.id) })
        qc.invalidateQueries({ queryKey: qk.book(book.id) })
        toast.success(p.insert_mode === 'new_scene' ? 'New scene added after this one' : 'New chapter added after this one')
        onOpenScene(made.scene_ids[0])
        return
      }
      // Keep the current text recoverable before changing it.
      await editor.flush()
      await createCheckpoint(sceneId, `Before AI: ${cmd.label}`)
      const range = p.selection_from !== null ? { from: p.selection_from, to: p.selection_to ?? p.selection_from, text: p.original_text } : undefined
      const ok = editor.applyAI(p.insert_mode === 'replace' ? 'replace' : 'append', doc, range)
      if (!ok) {
        toast.error('The selected passage has changed since you asked, so nothing was replaced. Select it again and regenerate, or edit and copy the text in yourself.')
        return
      }
      await closeProposal(p.id, edited ? 'edited' : 'accepted', text)
      qc.invalidateQueries({ queryKey: qk.versions(sceneId) })
      toast.success(p.insert_mode === 'replace' ? 'Replaced. The earlier text is in History.' : 'Added to the scene')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not insert')
    } finally {
      qc.invalidateQueries({ queryKey: ['proposals', sceneId] })
    }
  }

  const available = commandsForMode(mode)

  return (
    <div className="space-y-5 text-sm" data-testid="ai-panel">
      <div className="grid gap-3">
        <div>
          <Label htmlFor="ai-mode">AI mode</Label>
          <Select
            id="ai-mode"
            value={mode}
            onChange={async (e) => {
              await setBookAI(book.id, { ai_mode: e.target.value }).catch((err) => toast.error(err.message))
              refreshBook()
            }}
          >
            {AI_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-fg-muted">{AI_MODES.find((m) => m.id === mode)?.description}</p>
          {mode === 'creative_partner' && (
            <Link className="link mt-1 inline-block text-xs font-semibold" to={`/partner?book=${book.id}`}>
              Open the Creative Partner workspace
            </Link>
          )}
        </div>
        <div>
          <Label htmlFor="ai-style">Style for drafting</Label>
          <Select
            id="ai-style"
            value={book.style_profile_id ?? ''}
            onChange={async (e) => {
              await setBookAI(book.id, { style_profile_id: e.target.value || null }).catch((err) => toast.error(err.message))
              refreshBook()
            }}
          >
            <option value="">No style profile</option>
            {(profiles.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.analyzed_at ? '' : ' (not analyzed yet)'}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ai-direction">Direction {mode === 'co_writer' ? '' : '(optional)'}</Label>
          <Textarea
            id="ai-direction"
            className="min-h-20"
            placeholder={mode === 'co_writer' ? 'What should happen in the scene or chapter?' : 'Anything the AI should keep in mind'}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          />
        </div>
      </div>

      {openQuestions > 0 && (
        <Link to={`/partner?tab=questions&book=${book.id}`} className="flex items-center gap-2 rounded-lg bg-ai-soft px-3 py-2 text-ai-text">
          <Sparkles className="size-4" aria-hidden /> {openQuestions} {openQuestions === 1 ? 'question' : 'questions'} waiting for you
        </Link>
      )}

      {GROUPS.map((g) => {
        const cmds = available.filter((c) => c.group === g.id)
        if (!cmds.length) return null
        return (
          <section key={g.id}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{g.label}</h3>
            <div className="flex flex-wrap gap-1.5">
              {cmds.map((c) => (
                <Button key={c.id} size="sm" variant={c.group === 'write' ? 'ai' : 'secondary'} disabled={busy !== null} onClick={() => void run(c)}>
                  {busy === c.id && <Loader2 className="animate-spin" />}
                  {c.label}
                </Button>
              ))}
            </div>
          </section>
        )
      })}

      <section aria-live="polite">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Proposals</h3>
        {!proposals.data?.length ? (
          <p className="text-fg-faint">Nothing yet. AI text appears here for you to accept, edit, regenerate or reject. It never goes into the scene on its own.</p>
        ) : (
          <ul className="space-y-3" data-testid="proposals">
            {proposals.data.map((p) => (
              <ProposalCard key={p.id} p={p} onAccept={accept} onRegenerate={() => void run(commandById(p.command)!, p)} onClose={async (s) => {
                await closeProposal(p.id, s).catch((e) => toast.error(e.message))
                qc.invalidateQueries({ queryKey: ['proposals', sceneId] })
              }} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ProposalCard({
  p,
  onAccept,
  onRegenerate,
  onClose,
}: {
  p: Proposal
  onAccept: (p: Proposal, text: string, edited: boolean) => Promise<void>
  onRegenerate: () => void
  onClose: (status: 'rejected') => Promise<void>
}) {
  const cmd = commandById(p.command)
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState(p.proposed_text)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setText(p.proposed_text), [p.proposed_text])
  const isNotes = p.insert_mode === 'notes'
  const acceptLabel = { replace: 'Accept and replace', append: 'Accept and add', insert_after: 'Accept and insert', new_scene: 'Add as new scene', new_chapter: 'Add as new chapter', notes: 'Done' }[p.insert_mode]

  return (
    <li className="rounded-lg border border-line bg-panel p-3" data-testid="proposal">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">{cmd?.label ?? p.command}</span>
        <Badge tone={p.status === 'failed' ? 'alert' : 'ai'}>{p.status === 'generating' ? 'Writing...' : p.status === 'failed' ? 'Not done' : 'Proposal'}</Badge>
      </div>
      {p.instruction && <p className="mb-2 text-xs text-fg-muted">Direction: {p.instruction}</p>}
      {p.status === 'generating' && (
        <p className="flex items-center gap-2 text-fg-muted" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> The AI is working on it.
        </p>
      )}
      {p.status === 'failed' && (
        <>
          <p className="text-alert-text" role="alert">
            {p.error}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={onRegenerate}>
              <RefreshCw /> Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onClose('rejected')}>
              Dismiss
            </Button>
          </div>
        </>
      )}
      {p.status === 'pending' && (
        <>
          {p.original_text && !isNotes && (
            <details className="mb-2 text-xs text-fg-muted">
              <summary className="cursor-pointer">Original selection</summary>
              <p className="mt-1 whitespace-pre-wrap font-serif">{p.original_text}</p>
            </details>
          )}
          {isNotes ? (
            <p className="whitespace-pre-wrap" data-testid="proposal-notes">
              {p.notes}
            </p>
          ) : editing ? (
            <Textarea aria-label="Edit before inserting" className="min-h-40 font-serif" value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <div className={cn('max-h-80 overflow-y-auto whitespace-pre-wrap rounded bg-paper p-3 font-serif text-paper-fg')} data-testid="proposal-text">
              {p.proposed_text}
            </div>
          )}
          {!isNotes && p.notes && <p className="mt-2 text-xs text-alert-text">{p.notes}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {!isNotes && (
              <Button
                size="sm"
                disabled={busy || !text.trim()}
                onClick={async () => {
                  setBusy(true)
                  await onAccept(p, editing ? text : p.proposed_text, editing && text !== p.proposed_text)
                  setBusy(false)
                }}
              >
                <Check /> {editing ? 'Insert edited text' : acceptLabel}
              </Button>
            )}
            {!isNotes && !editing && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil /> Edit before inserting
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onRegenerate}>
              <RefreshCw /> Regenerate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onClose('rejected')}>
              <X /> {isNotes ? 'Close' : 'Reject'}
            </Button>
          </div>
        </>
      )}
    </li>
  )
}
