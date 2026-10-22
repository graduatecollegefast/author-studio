import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Check, FilePlus2, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menu'
import { qk } from '@/hooks/queries'
import {
  createChapter,
  createScene,
  deleteScene,
  renameChapter,
  renameScene,
  reorderScenes,
} from '@/services/chapters'
import { titleSchema } from '@/lib/schemas'
import { cn, formatNumber } from '@/lib/utils'
import type { Chapter, SceneMeta } from '@/types/db'

interface Props {
  bookId: string
  chapters: Chapter[]
  scenes: SceneMeta[]
  activeSceneId: string | null
  onSelect: (sceneId: string) => void
}

export function Outline({ bookId, chapters, scenes, activeSceneId, onSelect }: Props) {
  const qc = useQueryClient()
  const [editing, setEditing] = React.useState<{ kind: 'chapter' | 'scene'; id: string } | null>(null)
  const [draft, setDraft] = React.useState('')
  const [toDelete, setToDelete] = React.useState<SceneMeta | null>(null)
  const [busy, setBusy] = React.useState(false)

  const byChapter = React.useMemo(() => {
    const map = new Map<string, SceneMeta[]>()
    for (const s of scenes) map.set(s.chapter_id, [...(map.get(s.chapter_id) ?? []), s])
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [scenes])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.chapters(bookId) })
    qc.invalidateQueries({ queryKey: qk.scenes(bookId) })
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true)
    try {
      return await fn()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
      return undefined
    } finally {
      setBusy(false)
      invalidate()
    }
  }

  async function commitRename() {
    if (!editing) return
    const parsed = titleSchema.safeParse(draft)
    if (!parsed.success) return toast.error(parsed.error.issues[0].message)
    const target = editing
    setEditing(null)
    await run(() => (target.kind === 'chapter' ? renameChapter(target.id, parsed.data) : renameScene(target.id, parsed.data)))
  }

  async function addScene(chapter: Chapter) {
    const list = byChapter.get(chapter.id) ?? []
    const pos = list.length ? Math.max(...list.map((s) => s.position)) + 1 : 0
    const created = await run(() => createScene(bookId, chapter.id, pos, `Scene ${list.length + 1}`))
    if (created) onSelect(created.id)
  }

  async function moveScene(chapterId: string, index: number, dir: -1 | 1) {
    const ids = (byChapter.get(chapterId) ?? []).map((s) => s.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    await run(() => reorderScenes(chapterId, ids))
  }

  const renameForm = (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        void commitRename()
      }}
    >
      <Input aria-label="New title" className="h-8" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
      <Button type="submit" size="icon" variant="ghost" aria-label="Save title" className="size-8">
        <Check />
      </Button>
      <Button size="icon" variant="ghost" aria-label="Cancel" className="size-8" onClick={() => setEditing(null)}>
        <X />
      </Button>
    </form>
  )

  return (
    <nav aria-label="Chapters and scenes" className="space-y-4">
      <ol className="space-y-3">
        {chapters.map((chapter, ci) => {
          const list = byChapter.get(chapter.id) ?? []
          return (
            <li key={chapter.id}>
              <div className="group flex items-center gap-1">
                {editing?.kind === 'chapter' && editing.id === chapter.id ? (
                  renameForm
                ) : (
                  <>
                    <span className="flex-1 truncate text-xs font-bold uppercase tracking-wide text-fg-muted" title={chapter.title}>
                      {ci + 1}. {chapter.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-60 group-hover:opacity-100"
                      aria-label={`Rename ${chapter.title}`}
                      onClick={() => {
                        setEditing({ kind: 'chapter', id: chapter.id })
                        setDraft(chapter.title)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-60 group-hover:opacity-100"
                      aria-label={`Add scene to ${chapter.title}`}
                      disabled={busy}
                      onClick={() => void addScene(chapter)}
                    >
                      <Plus />
                    </Button>
                  </>
                )}
              </div>
              <ol className="mt-1 space-y-0.5 border-l border-line pl-2">
                {list.map((scene, si) => (
                  <li key={scene.id} className="group/scene flex items-center gap-1">
                    {editing?.kind === 'scene' && editing.id === scene.id ? (
                      renameForm
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelect(scene.id)}
                          aria-current={scene.id === activeSceneId ? 'page' : undefined}
                          className={cn(
                            'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                            scene.id === activeSceneId ? 'bg-selected font-semibold text-fg' : 'text-fg hover:bg-panel-2',
                          )}
                        >
                          <span className="truncate">{scene.title}</span>
                          <span className="shrink-0 text-[11px] text-fg-faint">{formatNumber(scene.word_count)}</span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-7 opacity-50 group-hover/scene:opacity-100" aria-label={`Actions for ${scene.title}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing({ kind: 'scene', id: scene.id })
                                setDraft(scene.title)
                              }}
                            >
                              <Pencil /> Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={si === 0} onSelect={() => void moveScene(chapter.id, si, -1)}>
                              <ArrowUp /> Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={si === list.length - 1} onSelect={() => void moveScene(chapter.id, si, 1)}>
                              <ArrowDown /> Move down
                            </DropdownMenuItem>
                            <DropdownMenuItem danger disabled={list.length <= 1} onSelect={() => setToDelete(scene)}>
                              <Trash2 /> Delete scene
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          )
        })}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          const chapterId = await run(() => createChapter(bookId))
          if (chapterId) {
            await qc.refetchQueries({ queryKey: qk.scenes(bookId) })
            const fresh = qc.getQueryData<SceneMeta[]>(qk.scenes(bookId))
            const first = fresh?.find((s) => s.chapter_id === chapterId)
            if (first) onSelect(first.id)
          }
        }}
      >
        <FilePlus2 /> Add chapter
      </Button>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this scene?"
        description={
          <>
            <strong className="text-fg">{toDelete?.title}</strong> ({formatNumber(toDelete?.word_count)} words) and its version history will
            be permanently deleted.
          </>
        }
        confirmLabel="Delete scene"
        destructive
        requireText={toDelete && toDelete.word_count > 0 ? 'delete' : undefined}
        onConfirm={async () => {
          if (!toDelete) return
          await deleteScene(toDelete.id)
          toast.success('Scene deleted')
          invalidate()
          if (toDelete.id === activeSceneId) {
            const sibling = (byChapter.get(toDelete.chapter_id) ?? []).find((s) => s.id !== toDelete.id)
            if (sibling) onSelect(sibling.id)
          }
        }}
      />
    </nav>
  )
}
