import * as React from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import {
  BookOpen,
  BookText,
  Download,
  FileSearch,
  Globe2,
  LayoutDashboard,
  Library,
  Lightbulb,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  PenLine,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  CalendarRange,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { usePreferences } from '@/contexts/PreferencesContext'
import { Button } from '@/components/ui/button'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Phase in which the page becomes available. Items above the current phase are shown but not linked. */
  phase: number
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, phase: 1 },
  { to: '/library', label: 'My Library', icon: Library, phase: 1 },
  { to: '/series', label: 'Series & Universes', icon: Globe2, phase: 3 },
  { to: '/characters', label: 'Character Bible', icon: Users, phase: 2 },
  { to: '/world', label: 'World Bible', icon: BookText, phase: 2 },
  { to: '/timelines', label: 'Story Timelines', icon: CalendarRange, phase: 3 },
  { to: '/studio', label: 'Writing Studio', icon: PenLine, phase: 1 },
  { to: '/partner', label: 'AI Writing Partner', icon: MessageSquareText, phase: 4 },
  { to: '/continuity', label: 'Continuity Checker', icon: ShieldCheck, phase: 3 },
  { to: '/ideas', label: 'Ideas Vault', icon: Lightbulb, phase: 4 },
  { to: '/editorial', label: 'Editorial Studio', icon: FileSearch, phase: 5 },
  { to: '/exports', label: 'Exports', icon: Download, phase: 5 },
  { to: '/settings', label: 'Settings', icon: Settings, phase: 1 },
]

export const CURRENT_PHASE = 1

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  const { prefs, setPrefs } = usePreferences()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
        <div className="grid size-9 place-items-center rounded-xl bg-plum text-white dark:text-ink">
          <BookOpen className="size-5" aria-hidden />
        </div>
        <div className="leading-tight">
          <div className="font-serif text-lg font-semibold text-fg">Author Studio</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber">Private workspace</div>
        </div>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const available = item.phase <= CURRENT_PHASE
            if (!available) {
              return (
                <li key={item.to}>
                  <span
                    className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-faint"
                    aria-disabled="true"
                    title={`Arrives in Phase ${item.phase}`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="rounded-full border border-line px-1.5 text-[10px] font-semibold">P{item.phase}</span>
                  </span>
                </li>
              )
            }
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-plum-soft text-plum-strong' : 'text-fg-muted hover:bg-panel-2 hover:text-fg',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-line px-3 py-3">
        <div className="mb-2 truncate px-3 text-xs text-fg-faint" title={user?.email ?? ''}>
          {user?.email}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start"
            onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
            aria-label={prefs.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {prefs.theme === 'dark' ? <Sun /> : <Moon />}
            {prefs.theme === 'dark' ? 'Light' : 'Dark'}
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => void signOut()}>
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const location = useLocation()
  React.useEffect(() => setMobileOpen(false), [location.pathname])

  return (
    <div className="min-h-dvh bg-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-ink-2 lg:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-ink-2/95 px-4 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu />
        </Button>
        <span className="font-serif text-lg font-semibold">Author Studio</span>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink-2 shadow-2xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-4"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <X />
            </Button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <main id="main" className="lg:pl-64">
        <Outlet />
      </main>
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string
  title: string
  children?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-amber">{eyebrow}</div>}
        <h1 className="font-serif text-3xl font-semibold text-fg sm:text-4xl">{title}</h1>
        {children && <div className="mt-2 max-w-2xl text-sm text-fg-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10', className)}>{children}</div>
}
