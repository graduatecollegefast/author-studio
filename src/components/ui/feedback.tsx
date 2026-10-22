import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-fg-muted', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-fg-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden /> {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="rounded-[var(--radius-panel)] border border-danger/40 bg-danger-soft p-5 text-sm text-danger">
      <p className="font-semibold">Could not load this.</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 font-semibold underline">
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-panel)] border border-dashed border-line px-6 py-14 text-center">
      {icon && <div className="mb-3 text-fg-faint [&_svg]:size-8">{icon}</div>}
      <h3 className="font-serif text-xl font-semibold text-fg">{title}</h3>
      {children && <div className="mt-2 max-w-md text-sm text-fg-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
