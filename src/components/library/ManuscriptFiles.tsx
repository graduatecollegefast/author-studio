import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Download, FileUp, MoreHorizontal, RefreshCw, Star, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageLoader, Spinner } from '@/components/ui/feedback'
import { Select } from '@/components/ui/field'
import { useManuscripts, qk } from '@/hooks/queries'
import { deleteManuscript, getDownloadUrl, setCurrentManuscript, uploadManuscript, verifyUpload } from '@/services/manuscripts'
import { validateManuscriptFile } from '@/lib/documents/validation'
import { formatBytes, formatDate, labelize } from '@/lib/utils'
import type { Book, ManuscriptFile } from '@/types/db'

interface LocalUpload {
  key: string
  name: string
  size: number
  state: 'uploading' | 'done' | 'error'
  error?: string
}

const ACCEPT = '.docx,.pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function statusTone(s: string): 'ok' | 'danger' | 'amber' | 'neutral' {
  if (s === 'validated' || s === 'completed') return 'ok'
  if (s === 'rejected' || s === 'failed') return 'danger'
  if (s === 'pending' || s === 'uploaded' || s === 'queued' || s === 'processing') return 'amber'
  return 'neutral'
}

export function ManuscriptFiles({ book, autoOpenPicker }: { book: Book; autoOpenPicker?: boolean }) {
  const qc = useQueryClient()
  const { data: files, isLoading, error, refetch } = useManuscripts(book.id)
  const [uploads, setUploads] = React.useState<LocalUpload[]>([])
  const [kind, setKind] = React.useState<'manuscript' | 'supporting'>('manuscript')
  const [dragging, setDragging] = React.useState(false)
  const [toDelete, setToDelete] = React.useState<ManuscriptFile | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)


  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: qk.manuscripts(book.id) })
    qc.invalidateQueries({ queryKey: qk.book(book.id) })
    qc.invalidateQueries({ queryKey: qk.recentUploads })
  }, [qc, book.id])

  async function handleFiles(list: FileList | File[]) {
    const arr = Array.from(list)
    for (const file of arr) {
      const key = crypto.randomUUID()
      const check = validateManuscriptFile(file.name, file.size)
      if (!check.ok) {
        setUploads((u) => [...u, { key, name: file.name, size: file.size, state: 'error', error: check.error }])
        continue
      }
      setUploads((u) => [...u, { key, name: file.name, size: file.size, state: 'uploading' }])
      try {
        const saved = await uploadManuscript({ bookId: book.id, file, kind })
        if (saved.upload_status === 'validated' && kind === 'manuscript') {
          await setCurrentManuscript(book.id, saved.id)
        }
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: 'done' } : x)))
        if (saved.upload_status === 'rejected') toast.error(`${file.name}: ${saved.error_message ?? 'rejected'}`)
        else toast.success(`${file.name} uploaded`)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Upload failed'
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: 'error', error: message } : x)))
        toast.error(message)
      } finally {
        refresh()
      }
    }
    setTimeout(() => setUploads((u) => u.filter((x) => x.state !== 'done')), 2500)
  }

  async function download(file: ManuscriptFile) {
    try {
      const url = await getDownloadUrl(file)
      window.location.assign(url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create a download link')
    }
  }

  async function reverify(file: ManuscriptFile) {
    try {
      const saved = await verifyUpload(file.id)
      toast[saved.upload_status === 'validated' ? 'success' : 'error'](
        saved.upload_status === 'validated' ? 'File verified' : saved.error_message ?? 'File rejected',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      refresh()
    }
  }

  return (
    <div className="space-y-5">
      {autoOpenPicker && !files?.length && (
        <p className="rounded-lg bg-amber-soft px-4 py-3 text-sm font-medium text-amber">
          Book created. Now add the manuscript file for this book.
        </p>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void handleFiles(e.dataTransfer.files)
        }}
        className={`rounded-[var(--radius-panel)] border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-plum bg-plum-soft' : 'border-line bg-panel'}`}
      >
        <FileUp className="mx-auto size-8 text-fg-faint" aria-hidden />
        <p className="mt-2 font-semibold">Drop files here or choose files</p>
        <p className="mt-1 text-xs text-fg-muted">DOCX, PDF, EPUB, TXT, or Markdown. Up to 100 MB each. Stored privately.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Select aria-label="File role" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-auto">
            <option value="manuscript">Manuscript</option>
            <option value="supporting">Supporting document</option>
          </Select>
          <Button onClick={() => inputRef.current?.click()}>
            <FileUp /> Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label="Upload manuscript files"
            data-testid="manuscript-input"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {uploads.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm">
              {u.state === 'uploading' ? (
                <Spinner label="Uploading" />
              ) : u.state === 'done' ? (
                <CheckCircle2 className="size-4 text-ok" aria-hidden />
              ) : (
                <XCircle className="size-4 text-danger" aria-hidden />
              )}
              <span className="flex-1 truncate">{u.name}</span>
              <span className="text-xs text-fg-faint">{formatBytes(u.size)}</span>
              {u.error && <span className="text-xs text-danger">{u.error}</span>}
              {u.state === 'error' && (
                <Button variant="ghost" size="sm" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                  Dismiss
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isLoading ? (
        <PageLoader label="Loading files" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !files?.length ? (
        <EmptyState title="No files yet">Upload a manuscript or supporting document for this book.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-panel">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-fg-faint">
              <tr>
                <th className="px-4 py-3 font-semibold">File</th>
                <th className="px-4 py-3 font-semibold">Size</th>
                <th className="px-4 py-3 font-semibold">Upload</th>
                <th className="px-4 py-3 font-semibold">Extraction</th>
                <th className="px-4 py-3 font-semibold">Analysis</th>
                <th className="px-4 py-3 font-semibold">Uploaded</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium text-fg">
                      <span className="max-w-64 truncate" title={f.original_name}>
                        {f.original_name}
                      </span>
                      {book.current_manuscript_file_id === f.id && (
                        <Badge tone="amber">
                          <Star className="size-3" aria-hidden /> Current
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-faint">
                      {f.file_ext.toUpperCase()} · {f.kind === 'manuscript' ? `Manuscript v${f.version}` : 'Supporting'}
                    </div>
                    {f.error_message && <div className="mt-1 text-xs text-danger">{f.error_message}</div>}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{formatBytes(f.size_bytes)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(f.upload_status)}>{labelize(f.upload_status)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(f.extraction_status)} title="Text extraction arrives in Phase 2">
                      {labelize(f.extraction_status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(f.analysis_status)} title="AI analysis arrives in Phase 2">
                      {labelize(f.analysis_status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{formatDate(f.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${f.original_name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => void download(f)} disabled={f.upload_status !== 'validated' && f.upload_status !== 'uploaded'}>
                          <Download /> Download
                        </DropdownMenuItem>
                        {f.upload_status !== 'validated' && f.upload_status !== 'failed' && (
                          <DropdownMenuItem onSelect={() => void reverify(f)}>
                            <RefreshCw /> Verify again
                          </DropdownMenuItem>
                        )}
                        {f.kind === 'manuscript' && f.upload_status === 'validated' && book.current_manuscript_file_id !== f.id && (
                          <DropdownMenuItem
                            onSelect={async () => {
                              try {
                                await setCurrentManuscript(book.id, f.id)
                                toast.success('Set as current manuscript')
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'Could not update')
                              } finally {
                                refresh()
                              }
                            }}
                          >
                            <Star /> Set as current manuscript
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem danger onSelect={() => setToDelete(f)}>
                          <Trash2 /> Delete file
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this file?"
        description={
          <>
            <strong className="text-fg">{toDelete?.original_name}</strong> will be permanently removed from storage. Your chapters
            and scenes are not affected.
          </>
        }
        confirmLabel="Delete file"
        destructive
        onConfirm={async () => {
          if (!toDelete) return
          await deleteManuscript(toDelete)
          toast.success('File deleted')
          refresh()
        }}
      />
    </div>
  )
}
