import * as React from 'react'
import { cn } from '@/lib/utils'

const control =
  'w-full rounded-lg border border-line bg-panel px-3 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-ring aria-[invalid=true]:border-danger'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(control, 'h-10', className)} {...props} />,
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(control, 'min-h-24 py-2', className)} {...props} />,
)
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(control, 'h-10 pr-8', className)} {...props} />,
)
Select.displayName = 'Select'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted', className)} {...props} />
}

interface FieldProps {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  className?: string
  children: React.ReactNode
}

export function Field({ label, htmlFor, error, hint, className, children }: FieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-fg-faint">{hint}</p>
      ) : null}
    </div>
  )
}
