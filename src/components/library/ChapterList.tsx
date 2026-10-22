import * as React from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Check, FilePlus2, Pencil, PenLine, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/dialog'
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback'
import { qk, useChapters } from '@/hooks/queries'
import { createChapter, deleteChapter, renameChapter, reorderChapters } from '@/services/chapters'
import { formatNumber } from '@/lib/utils'
import { titleSchema } from '@/lib/schemas'
import type { Chapter } from '@/types/db'

export function ChapterList({ bookId }: { bookId: string }) {
  const qc = useQueryClient()
  const { data: chapters, isLoading, error, refetch } = useChapters(bookId)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [toDelete, setToDelete] = React.useState<Chapter | null>(null)
  const [busy, setBusy] = React.useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.chapters(bookId) })
    qc.invalidateQueries({ queryKey: qk.scenes(bookId) })
    qc.invalidateQueries({ queryKey: qk.book(bookId) })
  }

  async function run(fn: () => Promise<unknown>, success?: string) {
    setBusy(true)
    try {
      await fn()
      if (success) toast.success(success)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
      invalidate()
    }
  }

  async function move(index: number, dir: -1 | 1) {
    if (!chapters) return
    const ids = chapters.map((c) => c.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    await run(() => reorderChapters(bookId, ids))
  }

  async function saveTitle(id: string) {
    const parsed = titleSchema.safeParse(draft)
    if (!parsed.success) return toast.error(parsed.error.issues[0].message)
    setEditing(null)
    await run(() => renameChapter(id, parsed.data))
  }

  if (isLoading) return <PageLoader label="Loading chapters" />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => void run(() => createChapter(bookId), 'Chapter added')} disabled={busy}>
          <FilePlus2 /> Add chapter
        </Button>
      </div>
      {!chapters?.length ? (
        <EmptyState title="No chapters yet" icon={<FilePlus2 />}>
          Add a chapter to start writing. Each chapter starts with one scene, and you can add more in the Writing Studio.
        </EmptyState>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
          {chapters.map((c, i) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-8 shrink-0 text-right font-serif text-lg text-fg-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                {editing === c.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void saveTitle(c.id)
                    }}
                  >
                    <Input aria-label="Chapter title" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                    <Button type="submit" size="icon" variant="secondary" aria-label="Save title">
                      <Check />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}>
                      <X />
                    </Button>
                  </form>
                ) : (
                  <>
                    <Link to={`/books/${bookId}/write?chapter=${c.id}`} className="font-serif text-lg font-semibold text-fg hover:text-plum">
                      {c.title}
                    </Link>
                    <div className="text-xs text-fg-muted">{formatNumber(c.word_count)} words</div>
                  </>
                )}
              </div>
              {editing !== c.id && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Move ${c.title} up`} disabled={busy || i === 0} onClick={() => void move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${c.title} down`}
                    disabled={busy || i === chapters.length - 1}
                    onClick={() => void move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Rename ${c.title}`}
                    onClick={() => {
                      setEditing(c.id)
                      setDraft(c.title)
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${c.title}`} onClick={() => setToDelete(c)}>
                    <Trash2 />
                  </Button>
                  <Button asChild variant="secondary" size="sm">
                    <Link to={`/books/${bookId}/write?chapter=${c.id}`}>
                      <PenLine /> Write
                    </Link>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this chapter?"
        description={
          <>
            <strong className="text-fg">{toDelete?.title}</strong> and all of its scenes and saved versions will be permanently deleted
            ({formatNumber(toDelete?.word_count)} words). This cannot be undone.
          </>
        }
        confirmLabel="Delete chapter"
        destructive
        requireText={toDelete && toDelete.word_count > 0 ? 'delete' : undefined}
        onConfirm={async () => {
          if (!toDelete) return
          await deleteChapter(toDelete.id)
          toast.success('Chapter deleted')
          invalidate()
        }}
      />
    </div>
  )
}
