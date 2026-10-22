import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { PageBody } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { ErrorState, PageLoader } from '@/components/ui/feedback'
import { CanonList } from '@/components/bible/Evidence'
import { approvedFactsFor, deleteWorldElement, getWorldElement, updateWorldElement, WORLD_CATEGORY_LABELS, worldElementBooks, type WorldElement } from '@/services/bible'

export function WorldElementPage() {
  const { elementId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const el = useQuery({ queryKey: ['world', 'one', elementId], queryFn: () => getWorldElement(elementId) })
  const facts = useQuery({ queryKey: ['world', 'facts', elementId], queryFn: () => approvedFactsFor('world_element', elementId) })
  const books = useQuery({ queryKey: ['world', 'books', elementId], queryFn: () => worldElementBooks(elementId) })
  const [draft, setDraft] = React.useState<WorldElement | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  React.useEffect(() => {
    if (el.data) setDraft(el.data)
  }, [el.data])

  if (!draft) {
    if (el.error) return <PageBody><ErrorState error={el.error} onRetry={() => void el.refetch()} /></PageBody>
    return <PageLoader label="Loading" />
  }
  const set = (k: keyof WorldElement, v: string) => setDraft({ ...draft, [k]: v })

  return (
    <PageBody>
      <Link to="/world" className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> World Bible
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{WORLD_CATEGORY_LABELS[el.data!.category] ?? el.data!.category}</p>
          <h1 className="font-serif text-3xl font-semibold">{el.data!.name}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {(books.data ?? []).map((b, i) => (
              <React.Fragment key={b.id}>
                {i > 0 && ', '}
                <Link className="link" to={`/books/${b.id}`}>
                  {b.title}
                </Link>
              </React.Fragment>
            ))}
            {!books.data?.length && 'Not linked to a book yet'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              if (!draft.name.trim()) return toast.error('A name is required.')
              setSaving(true)
              try {
                await updateWorldElement(elementId, {
                  name: draft.name.trim(),
                  category: draft.category,
                  description: draft.description?.trim() || null,
                  history: draft.history?.trim() || null,
                  rules: draft.rules?.trim() || null,
                  notes: draft.notes?.trim() || null,
                })
                toast.success('Saved')
                qc.invalidateQueries({ queryKey: ['world'] })
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Could not save')
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="we-name">
              <Input id="we-name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Category" htmlFor="we-category">
              <Select id="we-category" value={draft.category} onChange={(e) => set('category', e.target.value)}>
                {Object.entries(WORLD_CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            {(
              [
                ['description', 'Description'],
                ['history', 'History'],
                ['rules', 'Rules'],
                ['notes', 'Author notes'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`we-${k}`} className="sm:col-span-2">
                <Textarea id={`we-${k}`} value={draft[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              </Field>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Canon from your books" />
          <div className="px-5 pb-5">
            <CanonList facts={facts.data ?? []} empty="No approved facts yet." />
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this world element?"
        description="The element and its links to books are deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await deleteWorldElement(elementId)
          qc.invalidateQueries({ queryKey: ['world'] })
          navigate('/world', { replace: true })
        }}
      />
    </PageBody>
  )
}
