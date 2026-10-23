import * as React from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CalendarSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { ErrorState, Spinner } from '@/components/ui/feedback'
import { ageLabel, ageOn, checkAges, effectiveDates, formatStoryDate, parseBirth, type EffectiveDate } from '@/lib/story/dates'
import { loadStoryDates, saveDetectedDates, setBookStartDate, setChapterDate, type BookCharacter } from '@/services/storyDates'

const SOURCE: Record<NonNullable<EffectiveDate['from']>, string> = {
  author: 'Set by you',
  saved: 'Read from the text',
  text: 'Found in the text (not saved yet)',
  earlier: 'Same as an earlier chapter',
  book: 'When the book begins',
}

const names = (c: BookCharacter) => {
  const first = c.full_name.trim().split(/\s+/)[0]
  return [
    ...new Set(
      [c.full_name, c.preferred_name, ...(c.aliases ?? []), ...(c.nicknames ?? []), first].filter((n): n is string => Boolean(n && n.length >= 3)),
    ),
  ].sort((a, b) => b.length - a.length)
}

/** When the story happens, chapter by chapter, and how old everyone is on those dates. */
export function StoryDates({ bookId }: { bookId: string }) {
  const data = useQuery({ queryKey: ['story-dates', bookId], queryFn: () => loadStoryDates(bookId) })
  const [start, setStart] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setStart(data.data?.start ?? ''), [data.data?.start])

  const d = data.data
  const dates = React.useMemo(
    () =>
      d
        ? effectiveDates(
            d.chapters.map((c) => ({ ...c, text: c.scenes.map((s) => s.content_text ?? '').join('\n\n') })),
            d.start,
          )
        : [],
    [d],
  )
  const issues = React.useMemo(
    () =>
      d
        ? checkAges(
            d.chapters.map((c, i) => ({
              id: c.id,
              title: c.title,
              date: dates[i]?.date ?? null,
              dateNote: dates[i]?.note ?? '',
              scenes: c.scenes.map((s) => ({ id: s.id, title: s.title, text: s.content_text ?? '' })),
            })),
            d.characters
              .filter((c) => c.date_of_birth)
              .map((c) => ({ id: c.id, name: c.full_name, names: names(c), dateOfBirth: c.date_of_birth, age: c.age })),
            d.start,
          )
        : [],
    [d, dates],
  )

  if (data.isLoading) return <Spinner label="Reading story dates" />
  if (data.error || !d) return <ErrorState error={data.error} onRetry={() => void data.refetch()} />

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(msg)
      await data.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }
  const unsaved = dates.filter((x) => x.from === 'text').length
  const dated = dates.filter((x) => x.date)
  const first = dated[0]?.date ?? null
  const last = dated[dated.length - 1]?.date ?? null

  return (
    <div className="space-y-6" data-testid="story-dates">
      <Card>
        <CardHeader title="When the story happens" />
        <div className="space-y-4 px-5 pb-5 text-sm">
          <p className="text-fg-muted">
            Each chapter's date is read from dates written in it (like "March 3, 2024"). A chapter without one takes the date of the chapter before
            it. Set a date yourself whenever the text does not say. The AI writing partner and the continuity check use these dates to keep ages
            right.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="The book begins on" htmlFor="sd-start" className="w-56">
              <Input id="sd-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Button
              variant="secondary"
              disabled={busy || start === (d.start ?? '')}
              onClick={() => void run(() => setBookStartDate(bookId, start || null), 'Start date saved')}
            >
              Save start date
            </Button>
            {unsaved > 0 && (
              <Button
                disabled={busy}
                onClick={() => void run(() => saveDetectedDates(dates), `${unsaved} chapter ${unsaved === 1 ? 'date' : 'dates'} saved`)}
              >
                <CalendarSearch /> Save {unsaved} {unsaved === 1 ? 'date' : 'dates'} found in the text
              </Button>
            )}
          </div>
          {!d.chapters.length ? (
            <p className="text-fg-muted">This book has no chapters yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-sm" data-testid="chapter-dates">
                <thead className="bg-panel-2 text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Chapter</th>
                    <th className="px-3 py-2 font-semibold">Story date</th>
                    <th className="px-3 py-2 font-semibold">From</th>
                    <th className="px-3 py-2 font-semibold">Set it yourself</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.chapters.map((c, i) => (
                    <ChapterRow key={c.id} index={i} chapter={c} date={dates[i]} busy={busy} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Ages and homes" action={<Badge>Free</Badge>} />
        <div className="space-y-4 px-5 pb-5 text-sm">
          {!d.characters.length ? (
            <p className="text-fg-muted">
              No characters are linked to this book yet. Link them from the{' '}
              <Link to="/characters" className="link">
                Character Bible
              </Link>{' '}
              or by approving discoveries.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-sm" data-testid="character-ages">
                  <thead className="bg-panel-2 text-xs uppercase tracking-wide text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Character</th>
                      <th className="px-3 py-2 font-semibold">Born</th>
                      <th className="px-3 py-2 font-semibold">Age {first ? `on ${formatStoryDate(first)}` : 'when the book begins'}</th>
                      {last && last !== first && <th className="px-3 py-2 font-semibold">Age on {formatStoryDate(last)}</th>}
                      <th className="px-3 py-2 font-semibold">Where they live</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.characters.map((c) => {
                      const b = parseBirth(c.date_of_birth)
                      const a1 = b && first ? ageOn(b, first) : null
                      const a2 = b && last ? ageOn(b, last) : null
                      return (
                        <tr key={c.id}>
                          <td className="px-3 py-2">
                            <Link to={`/characters/${c.id}`} className="link font-semibold">
                              {c.full_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{b ? formatStoryDate(b.iso, b.precision) : <span className="text-fg-faint">Not set</span>}</td>
                          <td className="px-3 py-2">
                            {a1 ? ageLabel(a1) : c.age ? `${c.age} (profile)` : <span className="text-fg-faint">Unknown</span>}
                          </td>
                          {last && last !== first && (
                            <td className="px-3 py-2">{a2 ? ageLabel(a2) : <span className="text-fg-faint">Unknown</span>}</td>
                          )}
                          <td className="px-3 py-2">{c.residence || <span className="text-fg-faint">Not set</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {d.characters.some((c) => !c.date_of_birth) && (
                <p className="text-xs text-fg-muted">
                  Add a date of birth (a year is enough) on a character's page to check their age everywhere in the book.
                </p>
              )}
            </>
          )}
          {issues.length > 0 ? (
            <div className="space-y-2" data-testid="age-issues">
              <p className="font-semibold text-fg">
                {issues.length} {issues.length === 1 ? 'age does' : 'ages do'} not match
              </p>
              <ul className="space-y-2">
                {issues.map((i, n) => (
                  <li key={n} className="flex gap-2 rounded-lg border border-alert bg-alert-soft p-3 text-alert-text">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <div>
                      <p>{i.description}</p>
                      <p className="mt-1 text-xs">
                        {i.conflictingWhere}: "{i.conflicting}".{' '}
                        {i.sceneId ? (
                          <Link to={`/books/${bookId}/write?scene=${i.sceneId}`} className="link font-semibold">
                            Open the scene
                          </Link>
                        ) : (
                          <Link to={`/characters/${i.characterId}`} className="link font-semibold">
                            Open the profile
                          </Link>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">
                The{' '}
                <Link to={`/continuity?book=${bookId}`} className="link">
                  Continuity Checker
                </Link>{' '}
                also lists these, so you can mark them fixed or intentional.
              </p>
            </div>
          ) : d.characters.some((c) => c.date_of_birth) && dated.length ? (
            <p className="text-fg-muted" data-testid="ages-ok">
              Every age written in this book matches the birth dates on its story dates.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}

function ChapterRow({
  index,
  chapter,
  date,
  busy,
  run,
}: {
  index: number
  chapter: { id: string; title: string; story_date_source: 'detected' | 'author' | null }
  date: EffectiveDate | undefined
  busy: boolean
  run: (fn: () => Promise<unknown>, msg: string) => Promise<void>
}) {
  const [value, setValue] = React.useState(chapter.story_date_source === 'author' ? (date?.date ?? '') : '')
  return (
    <tr data-testid="chapter-date">
      <td className="px-3 py-2 font-semibold text-fg">
        {index + 1}. {chapter.title}
      </td>
      <td className="px-3 py-2">{date?.date ? formatStoryDate(date.date) : <span className="text-fg-faint">Unknown</span>}</td>
      <td className="px-3 py-2 text-fg-muted">
        {date?.from ? SOURCE[date.from] : 'No date yet'}
        {date?.note && date.from !== 'author' ? <span className="block text-xs">{date.note}</span> : null}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`sd-${chapter.id}`} className="sr-only">
            Story date for {chapter.title}
          </label>
          <Input id={`sd-${chapter.id}`} type="date" className="w-40" value={value} onChange={(e) => setValue(e.target.value)} />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !value}
            onClick={() => void run(() => setChapterDate(chapter.id, value), `Date set for ${chapter.title}`)}
          >
            Set
          </Button>
          {chapter.story_date_source && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setValue('')
                void run(() => setChapterDate(chapter.id, null), `Date cleared for ${chapter.title}`)
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}
