import { cn } from '@/lib/utils'

/** A labeled, scrollable set of checkboxes for choosing several items. */
export function Checklist({
  label,
  options,
  value,
  onChange,
  empty = 'Nothing to choose from yet.',
  className,
}: {
  label: string
  options: Array<{ id: string; label: string }>
  value: string[]
  onChange: (ids: string[]) => void
  empty?: string
  className?: string
}) {
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</legend>
      {!options.length ? (
        <p className="text-sm text-fg-faint">{empty}</p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
          {options.map((o) => (
            <label key={o.id} className={cn('flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-panel-2')}>
              <input
                type="checkbox"
                className="size-4 accent-[var(--action)]"
                checked={value.includes(o.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((v) => v !== o.id))}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}
