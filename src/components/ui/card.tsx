import * as React from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius-panel)] border border-line bg-panel', className)} {...props} />
}

export function CardHeader({ title, action, className }: { title: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-5 pt-4 pb-2', className)}>
      <h2 className="text-sm font-bold tracking-wide text-fg">{title}</h2>
      {action}
    </div>
  )
}

export type BadgeTone = 'neutral' | 'info' | 'ai' | 'progress' | 'alert'

/** Status chip. Tone carries meaning: ai = AI feature, progress = done, alert = needs attention. */
export function Badge({ className, tone = 'neutral', ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-panel-2 text-fg-muted border-line',
    info: 'bg-selected text-fg border-transparent',
    ai: 'bg-ai-soft text-ai-text border-transparent',
    progress: 'bg-progress-soft text-progress-text border-transparent',
    alert: 'bg-alert-soft text-alert-text border-transparent',
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', tones[tone], className)}
      {...props}
    />
  )
}
