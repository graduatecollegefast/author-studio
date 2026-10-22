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

export function Badge({ className, tone = 'neutral', ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'plum' | 'amber' | 'danger' | 'ok' }) {
  const tones = {
    neutral: 'bg-panel-2 text-fg-muted border-line',
    plum: 'bg-plum-soft text-plum-strong border-transparent',
    amber: 'bg-amber-soft text-amber border-transparent',
    danger: 'bg-danger-soft text-danger border-transparent',
    ok: 'bg-panel-2 text-ok border-line',
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', tones[tone], className)}
      {...props}
    />
  )
}
