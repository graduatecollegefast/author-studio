import * as React from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Archive, Download, FileDown, Loader2, Trash2, Upload } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { Checklist } from '@/components/ui/checklist'
import { useAuth } from '@/contexts/AuthContext'
import { useBooks, useChapters } from '@/hooks/queries'
import { listCharacters } from '@/services/bible'
import { listSeries } from '@/services/story'
import {
  createExport,
  deleteExport,
  downloadExport,
  EXPORT_CONTENT,
  FORMAT_LABELS,
  isStalled,
  listExports,
  restoreBackup,
  type ExportContent,
  type ExportFormat,
  type ExportRow,
} from '@/services/exports'
import { formatBytes, formatNumber, formatRelative } from '@/lib/utils'

const LABEL = Object.fromEntries(EXPORT_CONTENT.map((c) => [c.id, c.label])) as Record<ExportContent, string>

export function ExportsPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const books = useBooks()
  const history = useQuery({
    queryKey: ['exports'],
    queryFn: listExports,
    refetchInterval: (q) => (q.state.data?.some((r) => (r.status === 'pending' || r.status === 'processing') && !isStalled(r)) ? 2000 : false),
  })
  const [content, setContent] = React.useState<ExportContent>('manuscript')
  const def = EXPORT_CONTENT.find((c) => c.id === content)!
  const [format, setFormat] = React.useState<ExportFormat>('docx')
  const [bookId, setBookId] = React.useState('')
  const [seriesId, setSeriesId] = React.useState('')
  const [chapterIds, setChapterIds] = React.useState<string[]>([])
  const [characterIds, setCharacterIds] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)
  const [restoring, setRestoring] = React.useState(false)
  const [removing, setRemoving] = React.useState<ExportRow | null>(null)
  const book = bookId || books.data?.[0]?.id || ''
  const chapters = useChapters(book)
  const characters = useQuery({ queryKey: ['characters', ''], queryFn: () => listCharacters(''), enabled: def.scope === 'characters' })
  const series = useQuery({ queryKey: ['series'], queryFn: listSeries, enabled: def.scope === 'series' })
  const seriesPick = seriesId || series.data?.[0]?.id || ''
  const titles = new Map((books.data ?? []).map((b) => [b.id, b.title]))

  React.useEffect(() => {
    if (!(def.formats as readonly string[]).includes(format)) setFormat(def.formats[0])
  }, [def, format])

  const missing =
    def.scope === 'book' && !book
      ? 'Add a book to your library first.'
      : content === 'chapters' && !chapterIds.length
        ? 'Choose at least one chapter.'
        : def.scope === 'characters' && !characterIds.length
          ? 'Choose at least one character.'
          : def.scope === 'series' && !seriesPick
            ? 'Create a series first.'
            : null

  async function create() {
    setBusy(true)
    try {
      await createExport({
        content,
        format,
        bookId: def.scope === 'book' || (def.scope === 'characters' && bookId) ? book : null,
        seriesId: def.scope === 'series' ? seriesPick : null,
        chapterIds: content === 'chapters' ? chapterIds : undefined,
        characterIds: def.scope === 'characters' ? characterIds : undefined,
      })
      toast.success('Export started. It appears in your download history when it is ready.')
      void qc.invalidateQueries({ queryKey: ['exports'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the export')
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    if (!file || !user) return
    setRestoring(true)
    try {
      await restoreBackup(file, user.id)
      toast.success('Restore started. Your restored books appear in the library when it finishes.')
      setFile(null)
      void qc.invalidateQueries({ queryKey: ['exports'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not restore the backup')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <PageBody>
      <PageHeader eyebrow="Publishing" title="Exports">
        Download your manuscript, bibles, outlines and timelines as Word, EPUB, PDF, plain text or Markdown, or back up the whole project. Chapter
        order, titles, paragraphs, scene breaks, bold and italic are kept.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Create an export" />
          <div className="space-y-4 px-5 pb-5">
            <Field label="What to export" htmlFor="ex-content">
              <Select id="ex-content" value={content} onChange={(e) => setContent(e.target.value as ExportContent)}>
                {EXPORT_CONTENT.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            {(def.scope === 'book' || def.scope === 'characters') && (
              <Field label={def.scope === 'characters' ? 'Book (optional, shown as the subtitle)' : 'Book'} htmlFor="ex-book">
                <Select
                  id="ex-book"
                  value={def.scope === 'characters' ? bookId : book}
                  onChange={(e) => {
                    setBookId(e.target.value)
                    setChapterIds([])
                  }}
                >
                  {def.scope === 'characters' && <option value="">None</option>}
                  {(books.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {content === 'chapters' && (
              <Checklist
                label="Chapters"
                options={(chapters.data ?? []).map((c, i) => ({ id: c.id, label: `${i + 1}. ${c.title}` }))}
                value={chapterIds}
                onChange={setChapterIds}
                empty="This book has no chapters yet."
              />
            )}
            {def.scope === 'characters' && (
              <Checklist
                label="Characters"
                options={(characters.data ?? []).map((c) => ({ id: c.id, label: c.full_name }))}
                value={characterIds}
                onChange={setCharacterIds}
                empty="No characters yet."
              />
            )}
            {def.scope === 'series' && (
              <Field label="Series" htmlFor="ex-series">
                <Select id="ex-series" value={seriesPick} onChange={(e) => setSeriesId(e.target.value)}>
                  {(series.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {content === 'backup' ? (
              <p className="text-sm text-fg-muted">
                One ZIP file with every book, chapter, scene and version, your Character and World Bibles, timelines, relationships, ideas, notes,
                reviews, uploaded manuscripts and covers.
              </p>
            ) : (
              <Field label="Format" htmlFor="ex-format">
                <Select id="ex-format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                  {def.formats.map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_LABELS[f]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {missing && <p className="text-sm text-fg-muted">{missing}</p>}
            <Button disabled={busy || Boolean(missing)} onClick={() => void create()}>
              {content === 'backup' ? <Archive /> : <FileDown />} {busy ? 'Starting...' : content === 'backup' ? 'Create backup' : 'Create export'}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Restore a backup" />
          <div className="space-y-4 px-5 pb-5 text-sm">
            <p className="text-fg-muted">
              Upload a backup ZIP made by Author Studio. Everything in it is added to your account as a copy with its files. Nothing you already have
              is replaced or removed; a book whose title you already use gets "(restored)" after its name.
            </p>
            <Field label="Backup file" htmlFor="ex-restore">
              <input
                id="ex-restore"
                type="file"
                accept=".zip,application/zip"
                className="block w-full text-sm text-fg file:mr-3 file:rounded-lg file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:font-semibold file:text-fg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Button variant="secondary" disabled={!file || restoring} onClick={() => void restore()}>
              <Upload /> {restoring ? 'Uploading...' : 'Restore backup'}
            </Button>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Download history" />
        <div className="px-5 pb-5">
          {history.isLoading ? (
            <Spinner />
          ) : history.error ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : !history.data?.length ? (
            <EmptyState icon={<Download />} title="No exports yet">
              Files you export appear here so you can download them again.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line" data-testid="export-history">
              {history.data.map((r) => (
                <HistoryRow key={r.id} r={r} bookTitle={r.book_id ? titles.get(r.book_id) : undefined} onRemove={() => setRemoving(r)} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove from history?"
        description="The exported file is deleted from your download history. Your books are not affected, and you can export again at any time."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (removing) await deleteExport(removing)
          void qc.invalidateQueries({ queryKey: ['exports'] })
        }}
      />
    </PageBody>
  )
}

function HistoryRow({ r, bookTitle, onRemove }: { r: ExportRow; bookTitle?: string; onRemove: () => void }) {
  const stalled = isStalled(r)
  const working = (r.status === 'pending' || r.status === 'processing') && !stalled
  const restore = r.export_type === 'restore'
  const title = restore ? 'Backup restore' : (LABEL[r.export_type as ExportContent] ?? r.export_type)
  const restored = (
    [
      ['books', 'book', 'books'],
      ['chapters', 'chapter', 'chapters'],
      ['scenes', 'scene', 'scenes'],
      ['characters', 'character', 'characters'],
      ['world_elements', 'world element', 'world elements'],
    ] as const
  ).flatMap(([k, one, many]) => {
    const n = r.result?.counts?.[k] ?? 0
    return n ? [`${formatNumber(n)} ${n === 1 ? one : many}`] : []
  })
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="export-row">
      <div className="min-w-0">
        <p className="font-semibold text-fg">
          {title}
          {bookTitle && <span className="font-normal text-fg-muted"> · {bookTitle}</span>}
        </p>
        <p className="text-xs text-fg-muted">
          {restore ? (r.file_name ?? 'Backup ZIP') : FORMAT_LABELS[r.format as ExportFormat]} · {formatRelative(r.created_at)}
          {r.size_bytes && !restore ? ` · ${formatBytes(r.size_bytes)}` : ''}
        </p>
        {working && r.result?.progress && <p className="text-xs text-fg-muted">{r.result.progress}</p>}
        {r.status === 'failed' && <p className="text-xs text-alert-text">{r.error_message}</p>}
        {stalled && <p className="text-xs text-alert-text">This stopped before it finished. Start it again.</p>}
        {restore && r.status === 'completed' && (
          <p className="text-xs text-fg-muted" data-testid="restore-summary">
            Restored {restored.join(', ') || 'the backup'}
            {r.result?.files ? ` and ${formatNumber(r.result.files)} ${r.result.files === 1 ? 'file' : 'files'}` : ''}.{' '}
            {r.result?.books?.[0] && (
              <Link to={`/books/${r.result.books[0].id}`} className="link">
                Open {r.result.books[0].title}
              </Link>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={r.status === 'completed' ? 'progress' : working ? 'ai' : 'alert'} data-testid="export-status">
          {working ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
          {stalled
            ? 'Stopped'
            : { pending: 'Queued', processing: restore ? 'Restoring' : 'Creating', completed: restore ? 'Restored' : 'Ready', failed: 'Failed' }[
                r.status
              ]}
        </Badge>
        {r.status === 'completed' && !restore && (
          <Button size="sm" onClick={() => void downloadExport(r).catch((e) => toast.error(e.message))}>
            <Download /> Download
          </Button>
        )}
        {!working && (
          <Button size="icon" variant="ghost" aria-label={`Remove ${title} from history`} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
    </li>
  )
}
