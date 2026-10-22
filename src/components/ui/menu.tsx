import * as Menu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger

export function DropdownMenuContent({ className, ...props }: Menu.DropdownMenuContentProps) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={6}
        align="end"
        className={cn('z-50 min-w-44 rounded-lg border border-line bg-panel p-1 shadow-xl', className)}
        {...props}
      />
    </Menu.Portal>
  )
}

export function DropdownMenuItem({
  className,
  danger,
  ...props
}: Menu.DropdownMenuItemProps & { danger?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-panel-2 data-[disabled]:opacity-50 [&_svg]:size-4',
        danger ? 'text-alert-text' : 'text-fg',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-line" />
}

