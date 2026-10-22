import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-panel p-6 shadow-2xl',
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="font-serif text-2xl font-semibold text-fg">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-fg-muted">{description}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  onConfirm: () => Promise<void> | void
  destructive?: boolean
  /** When set, the user must type this text to enable the confirm button. */
  requireText?: string
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
  requireText,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open) {
      setTyped('')
      setError(null)
    }
  }, [open])
  const blocked = requireText !== undefined && typed.trim() !== requireText.trim()

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={title}>
        <div className="space-y-4 text-sm text-fg-muted">
          <div>{description}</div>
          {requireText !== undefined && (
            <div>
              <label htmlFor="confirm-text" className="mb-1.5 block text-xs font-semibold text-fg">
                Type <span className="font-mono">{requireText}</span> to confirm
              </label>
              <input
                id="confirm-text"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="h-10 w-full rounded-lg border border-line bg-panel px-3 text-fg"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              disabled={blocked || busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await onConfirm()
                  onOpenChange(false)
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Something went wrong')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Working...' : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
