import * as React from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, FileText } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ErrorState, Spinner } from '@/components/ui/feedback'
import { getExtraction, importExtraction, previousImport } from '@/services/manuscripts'
import { qk, useChapters } from '@/hooks/queries'
import { formatNumber } from '@/lib/utils'
import type { ManuscriptFile } from '@/types/db'

interface Props {
  file: ManuscriptFile | null
  onOpenChange: (open: boolean) => void
}

/** Shows what was read from a manuscript and lets the author choose which chapters to import. */
export function ImportDialog({ file, onOpenChange }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const extraction = useQuery({
    queryKey: ['extraction', file?.id],
    queryFn: () => getExtraction(file!.id),
    enabled: Boolean(file),
  })
  const existing = useChapters(file?.book_id ?? '')
  const previous = useQuery({ queryKey: ['previous-import', file?.id], queryFn: () => previousImport(file!.id), enabled: Boolean(file) })
  const [replace, setReplace] = React.useState(true)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const chapters = React.useMemo(() => extraction.data?.structure ?? [], [extraction.data])

  React.useEffect(() => {
    // Front matter (title page, copyright) is left out unless the author chooses it.
    setSelected(new Set(chapters.flatMap((c, i) => (c.frontMatter ? [] : [i]))))
  }, [chapters])

  const chosen = chapters.filter((_, i) => selected.has(i))
  const words = chosen.reduce((n, c) => n + c.wordCount, 0)

  async function doImport() {
    if (!file || !chosen.length) return
    setBusy(true)
    try {
      const prev = previous.data?.total ?? 0
      const r = await importExtraction(file.id, chosen, prev > 0 && replace)
      toast.success(
        `Imported ${r.imported} ${r.imported === 1 ? 'chapter' : 'chapters'}` +
          (r.replaced ? `, replaced ${r.replaced} from the earlier import` : '') +
          (r.kept ? `. Kept ${r.kept} you had edited.` : ''),
      )
      qc.invalidateQueries({ queryKey: qk.chapters(file.book_id) })
      qc.invalidateQueries({ queryKey: qk.scenes(file.book_id) })
      qc.invalidateQueries({ queryKey: qk.book(file.book_id) })
      qc.invalidateQueries({ queryKey: qk.manuscripts(file.book_id) })
      qc.invalidateQueries({ queryKey: ['previous-import', file.id] })
      qc.invalidateQueries({ queryKey: qk.books })
      onOpenChange(false)
      navigate(`/books/${file.book_id}?tab=chapters`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        title="Import into chapters"
        description={file ? `Read from ${file.original_name}. Your original file is not changed.` : undefined}
        className="max-w-2xl"
      >
        {extraction.isLoading ? (
          <Spinner />
        ) : extraction.error ? (
          <ErrorState error={extraction.error} onRetry={() => void extraction.refetch()} />
        ) : !extraction.data ? (
          <p className="text-sm text-fg-muted">This file has not been read yet.</p>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-panel-2 p-3">
                <dt className="text-xs text-fg-muted">Words found</dt>
                <dd className="font-serif text-xl font-semibold">{formatNumber(extraction.data.word_count)}</dd>
              </div>
              <div className="rounded-lg bg-panel-2 p-3">
                <dt className="text-xs text-fg-muted">Chapters found</dt>
                <dd className="font-serif text-xl font-semibold">{extraction.data.chapter_count}</dd>
              </div>
              <div className="rounded-lg bg-panel-2 p-3">
                <dt className="text-xs text-fg-muted">{extraction.data.page_count ? 'Pages' : 'Format'}</dt>
                <dd className="font-serif text-xl font-semibold uppercase">{extraction.data.page_count ?? extraction.data.format}</dd>
              </div>
            </dl>

            {extraction.data.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-alert bg-alert-soft p-3 text-sm text-alert-text">
                {extraction.data.warnings.map((w) => (
                  <li key={w} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {w}
                  </li>
                ))}
              </ul>
            )}

            {extraction.data.cleanup && (
              <p className="rounded-lg bg-progress-soft px-3 py-2 text-sm text-progress-text" data-testid="cleanup-summary">
                Cleaned up print layout:{' '}
                {[
                  extraction.data.cleanup.runningHeadsRemoved + extraction.data.cleanup.pageNumbersRemoved > 0 &&
                    `removed ${extraction.data.cleanup.runningHeadsRemoved} running headers and ${extraction.data.cleanup.pageNumbersRemoved} page numbers`,
                  extraction.data.cleanup.paragraphsRejoined > 0 && `rejoined ${extraction.data.cleanup.paragraphsRejoined} paragraphs split across pages`,
                  extraction.data.cleanup.wordsRejoined > 0 && `repaired ${extraction.data.cleanup.wordsRejoined} split words`,
                  extraction.data.cleanup.dropCapsMerged > 0 && `restored ${extraction.data.cleanup.dropCapsMerged} decorative first letters`,
                ]
                  .filter(Boolean)
                  .join(', ') || 'nothing needed fixing'}
                .
              </p>
            )}

            {(previous.data?.total ?? 0) > 0 && (
              <label className="flex gap-3 rounded-lg border border-control p-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--action)]" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                <span>
                  <span className="font-semibold text-fg">Replace the {previous.data!.total} chapters imported from this file earlier</span>
                  <span className="block text-fg-muted">
                    {previous.data!.edited
                      ? `${previous.data!.edited} of them ${previous.data!.edited === 1 ? 'has' : 'have'} been edited since, so ${previous.data!.edited === 1 ? 'it stays' : 'they stay'}. The others are removed.`
                      : 'None of them have been edited since importing.'}
                  </span>
                </span>
              </label>
            )}

            {(existing.data?.length ?? 0) > 0 && !(replace && (previous.data?.total ?? 0) > 0) && (
              <p className="text-sm text-fg-muted">
                This book already has {existing.data!.length} {existing.data!.length === 1 ? 'chapter' : 'chapters'}. Imported chapters are added
                after them; nothing existing is changed.
              </p>
            )}

            <fieldset>
              <legend className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-fg-muted">
                <span>Chapters to import</span>
                <button
                  type="button"
                  className="link normal-case tracking-normal"
                  onClick={() => setSelected(selected.size === chapters.length ? new Set() : new Set(chapters.map((_, i) => i)))}
                >
                  {selected.size === chapters.length ? 'Select none' : 'Select all'}
                </button>
              </legend>
              <ul className="max-h-[40vh] divide-y divide-line overflow-y-auto rounded-lg border border-line" data-testid="import-chapters">
                {chapters.map((c, i) => {
                  const preview = c.scenes[0]?.text.slice(0, 140) ?? ''
                  return (
                    <li key={i}>
                      <label className="flex cursor-pointer gap-3 px-3 py-2.5 hover:bg-panel-2">
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-[var(--action)]"
                          checked={selected.has(i)}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(i)
                            else next.delete(i)
                            setSelected(next)
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="truncate font-serif font-semibold text-fg">
                              {c.title}
                              {c.frontMatter && <span className="ml-2 font-sans text-xs font-normal text-fg-muted">(title page, copyright: not imported unless selected)</span>}
                            </span>
                            <span className="shrink-0 text-xs text-fg-muted">
                              {formatNumber(c.wordCount)} words
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">
                            {preview}
                            {preview.length === 140 ? '...' : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>

            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                <FileText className="size-4" aria-hidden /> {chosen.length} chapters, {formatNumber(words)} words
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={() => void doImport()} disabled={busy || chosen.length === 0}>
                  {busy ? 'Importing...' : `Import ${chosen.length} ${chosen.length === 1 ? 'chapter' : 'chapters'}`}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
