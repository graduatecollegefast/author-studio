import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Eye, PenLine, SearchCheck, Type } from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { modes, type WritingMode } from '@/styles/tokens'
import { PAGE_WIDTHS, usePreferences } from '@/contexts/PreferencesContext'

const MODE_ICONS: Record<WritingMode, React.ComponentType<{ className?: string }>> = {
  creative: PenLine,
  focus: Eye,
  review: SearchCheck,
}

export function ModeSwitcher({ compact }: { compact?: boolean }) {
  const { prefs, setPrefs } = usePreferences()
  return (
    <div role="radiogroup" aria-label="Writing mode" className="flex items-center rounded-lg border border-m-bar-line p-0.5">
      {(Object.keys(modes) as WritingMode[]).map((m) => {
        const Icon = MODE_ICONS[m]
        const active = prefs.writingMode === m
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${modes[m].label}: ${modes[m].description}`}
            onClick={() => setPrefs({ writingMode: m })}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border-b-2 px-2.5 text-xs font-semibold transition-colors',
              active ? 'border-m-accent text-m-bar-fg' : 'border-transparent text-m-bar-muted hover:text-m-bar-fg',
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className={cn(compact && 'sr-only')}>{modes[m].label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Slider({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  id: string
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <label htmlFor={id} className="font-semibold text-fg">
          {label}
        </label>
        <span className="text-fg-muted">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--action)]"
      />
    </div>
  )
}

/** Manuscript typography: font size, line spacing, page width. Saved to the author's preferences. */
export function TypographyMenu() {
  const { prefs, setPrefs } = usePreferences()
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Text and page settings"
          className="grid size-9 place-items-center rounded-md text-m-bar-muted hover:text-m-bar-fg [&_svg]:size-4"
        >
          <Type />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="end"
          className="z-50 w-72 space-y-4 rounded-[var(--radius-panel)] border border-line bg-panel p-4 text-fg shadow-xl"
        >
          <h2 className="text-sm font-bold">Text and page</h2>
          <Slider
            id="ms-size"
            label="Font size"
            value={prefs.manuscriptSize}
            display={`${prefs.manuscriptSize}px`}
            min={15}
            max={28}
            step={1}
            onChange={(v) => setPrefs({ manuscriptSize: v })}
          />
          <Slider
            id="ms-leading"
            label="Line spacing"
            value={prefs.lineSpacing}
            display={prefs.lineSpacing.toFixed(1)}
            min={1.4}
            max={2.4}
            step={0.1}
            onChange={(v) => setPrefs({ lineSpacing: Math.round(v * 10) / 10 })}
          />
          <fieldset>
            <legend className="mb-1 text-xs font-semibold">Page width</legend>
            <div className="grid grid-cols-3 gap-1">
              {(Object.keys(PAGE_WIDTHS) as Array<keyof typeof PAGE_WIDTHS>).map((w) => (
                <label
                  key={w}
                  className={cn(
                    'cursor-pointer rounded-md border px-2 py-1.5 text-center text-xs font-semibold capitalize',
                    prefs.pageWidth === w ? 'border-fg bg-selected text-fg' : 'border-control text-fg-muted hover:text-fg',
                  )}
                >
                  <input
                    type="radio"
                    name="page-width"
                    value={w}
                    checked={prefs.pageWidth === w}
                    onChange={() => setPrefs({ pageWidth: w })}
                    className="sr-only"
                  />
                  {w}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">App theme</span>
            <div className="flex gap-1">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={prefs.theme === t}
                  onClick={() => setPrefs({ theme: t })}
                  className={cn(
                    'rounded-md border px-2.5 py-1 font-semibold capitalize',
                    prefs.theme === t ? 'border-fg bg-selected text-fg' : 'border-control text-fg-muted hover:text-fg',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-fg-muted">Saved to your account and used on every device.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Session and daily-goal counters for the studio status bar. Progress uses sage. */
export function WordProgress({
  sessionWords,
  todayWords,
  goal,
}: {
  sessionWords: number
  todayWords: number
  goal: number | null
}) {
  const pct = goal ? Math.min(100, Math.round((todayWords / goal) * 100)) : null
  const met = goal !== null && todayWords >= goal
  return (
    <div className="flex items-center gap-4 text-xs text-m-bar-muted">
      <span>
        Session{' '}
        <strong className="text-m-bar-fg" data-testid="session-words">
          {sessionWords >= 0 ? '+' : ''}
          {formatNumber(sessionWords)}
        </strong>
      </span>
      {goal ? (
        <span className="flex items-center gap-2" data-testid="daily-goal">
          <span>
            Today{' '}
            <strong className="text-m-bar-fg">
              {formatNumber(todayWords)} / {formatNumber(goal)}
            </strong>
          </span>
          <span
            className="h-1.5 w-20 overflow-hidden rounded-full bg-m-bar-line"
            role="progressbar"
            aria-label="Daily word goal"
            aria-valuenow={pct ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="block h-full rounded-full bg-m-progress" style={{ width: `${pct}%` }} />
          </span>
          {met && <span className="font-semibold text-m-bar-fg">Goal reached</span>}
        </span>
      ) : (
        <span>
          Today <strong className="text-m-bar-fg">{formatNumber(todayWords)}</strong>
        </span>
      )}
    </div>
  )
}
