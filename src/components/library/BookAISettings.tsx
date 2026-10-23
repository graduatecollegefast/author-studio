import * as React from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Field, Select } from '@/components/ui/field'
import { Checklist } from '@/components/ui/checklist'
import { AI_MODES } from '@/lib/ai/commands'
import { qk } from '@/hooks/queries'
import { listUniverses } from '@/services/story'
import { listCrossovers, listProfiles, setBookAI, setCrossovers } from '@/services/writing'
import type { Book } from '@/types/db'

/** How the AI works on this book: mode, style profile, and which other universes it may draw on. */
export function BookAISettings({ book }: { book: Book }) {
  const qc = useQueryClient()
  const profiles = useQuery({ queryKey: ['style-profiles'], queryFn: listProfiles })
  const universes = useQuery({ queryKey: ['universes'], queryFn: listUniverses })
  const crossovers = useQuery({ queryKey: ['crossovers', book.id], queryFn: () => listCrossovers(book.id) })
  const [picked, setPicked] = React.useState<string[] | null>(null)
  const own = new Set((universes.data ?? []).filter((u) => u.book_universes.some((b) => b.book_id === book.id)).map((u) => u.id))
  const value = picked ?? crossovers.data ?? []
  const save = async (patch: { ai_mode?: string; style_profile_id?: string | null }) => {
    try {
      await setBookAI(book.id, patch)
      qc.invalidateQueries({ queryKey: qk.book(book.id) })
      toast.success('Saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    }
  }

  return (
    <Card>
      <CardHeader title="AI for this book" action={<Badge tone="ai">AI</Badge>} />
      <div className="space-y-5 px-5 pb-5 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="AI mode" htmlFor="book-ai-mode" hint={AI_MODES.find((m) => m.id === book.ai_mode)?.description}>
            <Select id="book-ai-mode" value={book.ai_mode} onChange={(e) => void save({ ai_mode: e.target.value })}>
              {AI_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Style for drafting" htmlFor="book-ai-style" hint="Manage profiles under AI Writing Partner, Style profiles.">
            <Select id="book-ai-style" value={book.style_profile_id ?? ''} onChange={(e) => void save({ style_profile_id: e.target.value || null })}>
              <option value="">No style profile</option>
              {(profiles.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {book.ai_mode === 'creative_partner' && (
          <Link className="link font-semibold" to={`/partner?book=${book.id}`}>
            Open the Creative Partner workspace
          </Link>
        )}
        <div>
          <Checklist
            label="Crossover universes"
            options={(universes.data ?? []).filter((u) => !own.has(u.id)).map((u) => ({ id: u.id, label: u.name }))}
            value={value}
            onChange={setPicked}
            empty="No other universes to cross over with."
          />
          <p className="mt-1 text-xs text-fg-muted">
            The AI only uses canon from this book's own series and universe. Tick a universe here to deliberately let its characters, places and history into this book's AI context.
          </p>
          {picked !== null && (
            <Button
              size="sm"
              className="mt-2"
              onClick={async () => {
                try {
                  await setCrossovers(book.id, picked)
                  setPicked(null)
                  qc.invalidateQueries({ queryKey: ['crossovers', book.id] })
                  toast.success('Crossovers saved')
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Could not save')
                }
              }}
            >
              Save crossovers
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
