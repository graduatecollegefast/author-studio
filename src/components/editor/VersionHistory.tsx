import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bookmark, Eye, History, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ErrorState, Spinner } from '@/components/ui/feedback'
import { createCheckpoint, listVersions, restoreVersion } from '@/services/chapters'
import { qk } from '@/hooks/queries'
import { formatNumber, formatRelative } from '@/lib/utils'
import { ConflictError } from '@/lib/autosave'
import type { SceneVersion } from '@/types/db'
import type { SceneEditorHandle } from './SceneEditor'

const KIND_LABEL: Record<SceneVersion['kind'], string> = {
  autosnapshot: 'Automatic snapshot',
  checkpoint: 'Checkpoint',
  pre_restore: 'Before restore',
  ai_accept: 'Before AI change',
  import: 'Imported',
}

export function VersionHistory({ sceneId, editorRef }: { sceneId: string; editorRef: React.RefObject<SceneEditorHandle | null> }) {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.versions(sceneId), queryFn: () => listVersions(sceneId) })
  const [label, setLabel] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [preview, setPreview] = React.useState<SceneVersion | null>(null)

  async function checkpoint(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await editorRef.current?.flush()
      await createCheckpoint(sceneId, label || null)
      setLabel('')
      toast.success('Checkpoint saved')
      await qc.invalidateQueries({ queryKey: qk.versions(sceneId) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save checkpoint')
    } finally {
      setBusy(false)
    }
  }

  async function restore(v: SceneVersion) {
    const handle = editorRef.current
    if (!handle) return
    setBusy(true)
    try {
      await handle.flush()
      const result = await restoreVersion(v.id, handle.revision())
      handle.replaceContent(v.content, result.revision)
      setPreview(null)
      toast.success('Version restored. Your previous text was kept in history.')
      await qc.invalidateQueries({ queryKey: qk.versions(sceneId) })
    } catch (err) {
      toast.error(
        err instanceof ConflictError ? 'The scene changed elsewhere. Reload before restoring.' : err instanceof Error ? err.message : 'Restore failed',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={checkpoint} className="space-y-2">
        <label htmlFor="checkpoint-label" className="block text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Manual checkpoint
        </label>
        <Input id="checkpoint-label" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        <Button type="submit" variant="secondary" size="sm" className="w-full" disabled={busy}>
          <Bookmark /> Save checkpoint
        </Button>
      </form>

      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          <History className="size-3.5" aria-hidden /> Version history
        </h3>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data?.length ? (
          <p className="text-xs text-fg-faint">
            No earlier versions yet. Previous text is snapshotted automatically as you write (at most every 10 minutes), and whenever
            you save a checkpoint.
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="version-list">
            {data.map((v) => (
              <li key={v.id} className="rounded-lg border border-line bg-panel px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-fg">{v.label || KIND_LABEL[v.kind]}</span>
                  <span className="text-fg-faint">{formatRelative(v.created_at)}</span>
                </div>
                <div className="mt-0.5 text-fg-faint">
                  Revision {v.revision} · {formatNumber(v.word_count)} words
                </div>
                <div className="mt-1.5 flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPreview(v)}>
                    <Eye /> Preview
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2" disabled={busy} onClick={() => void restore(v)}>
                    <RotateCcw /> Restore
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent title={preview?.label || (preview ? KIND_LABEL[preview.kind] : '')} description={preview ? `Saved ${formatRelative(preview.created_at)}` : undefined} className="max-w-2xl">
          <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-paper p-5 font-serif text-paper-fg">
            {preview?.content_text || <span className="italic opacity-60">Empty</span>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Close
            </Button>
            <Button disabled={busy} onClick={() => preview && void restore(preview)}>
              <RotateCcw /> Restore this version
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
