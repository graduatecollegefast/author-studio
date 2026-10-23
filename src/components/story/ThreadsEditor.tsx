import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Spinner } from '@/components/ui/feedback'
import { deleteThread, listThreads, saveThread, THREAD_KINDS, type PlotThread, type ThreadKind } from '@/services/story'

type Draft = Partial<PlotThread> & { title: string; kind: ThreadKind }

/** Series- or universe-wide plot threads, story arcs, unresolved mysteries and future book ideas. */
export function ThreadsEditor({ scope, books }: { scope: { seriesId?: string; universeId?: string }; books: Array<{ id: string; title: string }> }) {
  const qc = useQueryClient()
  const key = ['threads', scope.seriesId ?? '', scope.universeId ?? '']
  const threads = useQuery({ queryKey: key, queryFn: () => listThreads(scope) })
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [busy, setBusy] = React.useState(false)
  const title = (id: string | null) => books.find((b) => b.id === id)?.title

  return (
    <Card>
      <CardHeader
        title="Threads, arcs, mysteries and future books"
        action={
          <Button size="sm" variant="secondary" onClick={() => setDraft({ title: '', kind: 'thread', status: 'open' })}>
            <Plus /> Add thread
          </Button>
        }
      />
      <div className="space-y-5 px-5 pb-5 text-sm">
        {threads.isLoading && <Spinner />}
        {THREAD_KINDS.map((k) => {
          const rows = (threads.data ?? []).filter((t) => t.kind === k.id)
          return (
            <section key={k.id}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{k.label}</h3>
              {!rows.length ? (
                <p className="text-fg-faint">None yet.</p>
              ) : (
                <ul className="divide-y divide-line" data-testid={`threads-${k.id}`}>
                  {rows.map((t) => (
                    <li key={t.id} className="flex items-start gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-fg">{t.title}</span>
                        {k.id !== 'future_idea' && (
                          <Badge className="ml-2" tone={t.status === 'open' ? 'alert' : t.status === 'resolved' ? 'progress' : 'neutral'}>
                            {t.status}
                          </Badge>
                        )}
                        {t.description && <p className="text-fg-muted">{t.description}</p>}
                        {(t.opened_in_book_id || t.resolved_in_book_id) && (
                          <p className="text-xs text-fg-faint">
                            {t.opened_in_book_id && `Opens in ${title(t.opened_in_book_id) ?? 'a book'}`}
                            {t.opened_in_book_id && t.resolved_in_book_id && '. '}
                            {t.resolved_in_book_id && `Resolved in ${title(t.resolved_in_book_id) ?? 'a book'}`}
                          </p>
                        )}
                      </div>
                      <Button size="icon" variant="ghost" aria-label={`Edit ${t.title}`} onClick={() => setDraft(t)}>
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${t.title}`}
                        onClick={async () => {
                          try {
                            await deleteThread(t.id)
                            qc.invalidateQueries({ queryKey: key })
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Could not delete')
                          }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <Dialog open={draft !== null} onOpenChange={(o) => !busy && !o && setDraft(null)}>
        <DialogContent title={draft?.id ? 'Edit' : 'Add a thread, arc, mystery or idea'}>
          {draft && (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!draft.title.trim()) return
                setBusy(true)
                try {
                  await saveThread({ ...draft, series_id: scope.seriesId ?? null, universe_id: scope.universeId ?? null })
                  qc.invalidateQueries({ queryKey: key })
                  setDraft(null)
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not save')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Field label="Type" htmlFor="thread-kind">
                <Select id="thread-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ThreadKind })}>
                  {THREAD_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label.replace(/s$/, '')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title" htmlFor="thread-title">
                <Input id="thread-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={300} required />
              </Field>
              <Field label="Description" htmlFor="thread-description">
                <Textarea id="thread-description" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              {draft.kind !== 'future_idea' && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Status" htmlFor="thread-status">
                    <Select id="thread-status" value={draft.status ?? 'open'} onChange={(e) => setDraft({ ...draft, status: e.target.value as PlotThread['status'] })}>
                      <option value="open">Open</option>
                      <option value="resolved">Resolved</option>
                      <option value="abandoned">Abandoned</option>
                    </Select>
                  </Field>
                  <Field label="Opens in" htmlFor="thread-opened">
                    <Select id="thread-opened" value={draft.opened_in_book_id ?? ''} onChange={(e) => setDraft({ ...draft, opened_in_book_id: e.target.value || null })}>
                      <option value="">Not set</option>
                      {books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Resolved in" htmlFor="thread-resolved">
                    <Select id="thread-resolved" value={draft.resolved_in_book_id ?? ''} onChange={(e) => setDraft({ ...draft, resolved_in_book_id: e.target.value || null })}>
                      <option value="">Not set</option>
                      {books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !draft.title.trim()}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
