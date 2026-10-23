import * as React from 'react'
import { toast } from 'sonner'
import { Bookmark, BookPlus, Check, Lightbulb, Loader2, RotateCcw, SkipForward, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/field'
import { answerQuestion, confirmDecision, decisionToCanon, runAssistAndWait, setQuestionStatus, type Question } from '@/services/writing'

/** One clarification question with every way to respond: answer, skip, save, let AI decide, view options. */
export function QuestionCard({ q, bookTitle, onChanged }: { q: Question; bookTitle?: string; onChanged: () => void }) {
  const [answer, setAnswer] = React.useState('')
  const [choice, setChoice] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const act = async (key: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(key)
    try {
      await fn()
      if (msg) toast.success(msg)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update')
    } finally {
      setBusy(null)
    }
  }
  const id = `q-${q.id}`
  const decided = q.status === 'answered' || q.status === 'ai_decided'

  return (
    <li data-testid="question">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {bookTitle && <span className="text-fg-muted">{bookTitle}</span>}
          {q.status === 'ai_decided' && q.is_provisional && <Badge tone="ai">Provisional AI decision</Badge>}
          {q.status === 'saved_for_later' && <Badge>Saved for later</Badge>}
          {q.status === 'skipped' && <Badge>Skipped</Badge>}
        </div>
        <p id={`${id}-q`} className="mt-1 font-serif text-base font-semibold">
          {q.question}
        </p>
        {q.context && <p className="text-sm text-fg-muted">{q.context}</p>}

        {decided ? (
          <div className="mt-3 rounded-lg bg-panel-2 p-3 text-sm">
            <p>
              <span className="font-semibold">{q.answered_by === 'ai' ? 'AI chose' : 'Your answer'}:</span> {q.answer}
            </p>
            {q.reasoning && <p className="mt-1 text-xs text-fg-muted">Why: {q.reasoning}</p>}
            {q.is_provisional && <p className="mt-1 text-xs text-fg-muted">The AI uses this as guidance. It is not canon unless you add it.</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {q.is_provisional && (
                <Button size="sm" disabled={busy !== null} onClick={() => void act('confirm', () => confirmDecision(q.id), 'Decision confirmed')}>
                  <Check /> Confirm decision
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void act('canon', () => decisionToCanon(q), 'Added to canon')}>
                <BookPlus /> Add to canon
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act('reopen', () => setQuestionStatus(q.id, 'open'))}>
                <RotateCcw /> Change answer
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {q.options.length > 0 && (
              <fieldset>
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Possible answers</legend>
                <div className="space-y-1">
                  {q.options.map((o) => (
                    <label key={o} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-panel-2">
                      <input
                        type="radio"
                        name={`${id}-opt`}
                        className="mt-1 size-4 accent-[var(--action)]"
                        checked={choice === o}
                        onChange={() => {
                          setChoice(o)
                          setAnswer(o)
                        }}
                      />
                      {o}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <Textarea aria-label="Your answer" aria-describedby={`${id}-q`} className="min-h-16" placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" disabled={busy !== null || !answer.trim()} onClick={() => void act('answer', () => answerQuestion(q.id, answer, choice ?? undefined), 'Answered')}>
                <Check /> Answer
              </Button>
              <Button size="sm" variant="ai" disabled={busy !== null} onClick={() => void act('decide', () => runAssistAndWait('decide_question', q.id), 'The AI made a provisional decision')}>
                {busy === 'decide' ? <Loader2 className="animate-spin" /> : <Sparkles />} Let AI decide
              </Button>
              {!q.options.length && (
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void act('options', () => runAssistAndWait('question_options', q.id))}>
                  {busy === 'options' ? <Loader2 className="animate-spin" /> : <Lightbulb />} View possible options
                </Button>
              )}
              {q.status !== 'saved_for_later' && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act('later', () => setQuestionStatus(q.id, 'saved_for_later'), 'Saved for later')}>
                  <Bookmark /> Save for later
                </Button>
              )}
              {q.status !== 'skipped' && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act('skip', () => setQuestionStatus(q.id, 'skipped'), 'Skipped')}>
                  <SkipForward /> Skip
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </li>
  )
}
