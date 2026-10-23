import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageBody, PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { supabase } from '@/lib/supabase/client'
import { passwordSchema } from '@/lib/schemas'
import { useAuth } from '@/contexts/AuthContext'
import { usePreferences } from '@/contexts/PreferencesContext'
import { throwIfError } from '@/services/errors'
import type { Profile } from '@/types/db'
import { modes, type WritingMode } from '@/styles/tokens'
import { PAGE_WIDTHS } from '@/contexts/PreferencesContext'
import { cn } from '@/lib/utils'
import { AISettingsCard } from '@/components/settings/AISettingsCard'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Link } from 'react-router'
import { deleteAccount } from '@/services/account'

function WritingPreferences() {
  const { prefs, setPrefs, syncState } = usePreferences()
  const [goal, setGoal] = React.useState(prefs.dailyWordGoal ? String(prefs.dailyWordGoal) : '')
  const [goalError, setGoalError] = React.useState<string | null>(null)
  React.useEffect(() => setGoal(prefs.dailyWordGoal ? String(prefs.dailyWordGoal) : ''), [prefs.dailyWordGoal])

  function saveGoal() {
    const v = goal.replace(/,/g, '').trim()
    if (v === '') {
      setGoalError(null)
      return setPrefs({ dailyWordGoal: null })
    }
    const n = Number(v)
    if (!Number.isInteger(n) || n < 10 || n > 50000) return setGoalError('Enter a whole number from 10 to 50,000, or leave it empty.')
    setGoalError(null)
    setPrefs({ dailyWordGoal: n })
  }

  return (
    <Card>
      <CardHeader
        title="Writing"
        action={
          <span className="text-xs text-fg-muted" role="status">
            {syncState === 'saving' ? 'Saving...' : syncState === 'error' ? 'Could not save' : syncState === 'saved' ? 'Saved to your account' : ''}
          </span>
        }
      />
      <div className="space-y-6 px-5 pb-5">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Writing mode</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(modes) as WritingMode[]).map((m) => (
              <label
                key={m}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 text-sm',
                  prefs.writingMode === m ? 'border-fg bg-selected' : 'border-control hover:bg-panel-2',
                )}
              >
                <input
                  type="radio"
                  name="writing-mode"
                  value={m}
                  checked={prefs.writingMode === m}
                  onChange={() => setPrefs({ writingMode: m })}
                  className="sr-only"
                />
                <span className="mb-2 flex h-10 overflow-hidden rounded-md border border-line" aria-hidden>
                  <span className="w-1/4" style={{ background: modes[m].surround }} />
                  <span className="flex-1" style={{ background: modes[m].paper }}>
                    <span className="mx-auto mt-3 block h-1 w-2/3 rounded" style={{ background: modes[m].paperFg }} />
                    <span className="mx-auto mt-1.5 block h-1 w-1/2 rounded" style={{ background: modes[m].accentOnPaper }} />
                  </span>
                  <span className="w-1/4" style={{ background: modes[m].surround }} />
                </span>
                <span className="block font-semibold text-fg">{modes[m].label}</span>
                <span className="mt-0.5 block text-xs text-fg-muted">{modes[m].description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <label htmlFor="pref-size" className="font-semibold text-fg">
                Manuscript font size
              </label>
              <span className="text-fg-muted">{prefs.manuscriptSize}px</span>
            </div>
            <input
              id="pref-size"
              type="range"
              min={15}
              max={28}
              step={1}
              value={prefs.manuscriptSize}
              onChange={(e) => setPrefs({ manuscriptSize: Number(e.target.value) })}
              className="w-full accent-[var(--action)]"
            />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <label htmlFor="pref-leading" className="font-semibold text-fg">
                Line spacing
              </label>
              <span className="text-fg-muted">{prefs.lineSpacing.toFixed(1)}</span>
            </div>
            <input
              id="pref-leading"
              type="range"
              min={1.4}
              max={2.4}
              step={0.1}
              value={prefs.lineSpacing}
              onChange={(e) => setPrefs({ lineSpacing: Math.round(Number(e.target.value) * 10) / 10 })}
              className="w-full accent-[var(--action)]"
            />
          </div>
          <div>
            <label htmlFor="pref-width" className="mb-1 block text-xs font-semibold text-fg">
              Page width
            </label>
            <Select id="pref-width" value={prefs.pageWidth} onChange={(e) => setPrefs({ pageWidth: e.target.value as keyof typeof PAGE_WIDTHS })}>
              <option value="narrow">Narrow</option>
              <option value="standard">Standard</option>
              <option value="wide">Wide</option>
            </Select>
          </div>
          <div>
            <label htmlFor="pref-goal" className="mb-1 block text-xs font-semibold text-fg">
              Daily word goal (optional)
            </label>
            <div className="flex gap-2">
              <Input
                id="pref-goal"
                inputMode="numeric"
                placeholder="No goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onBlur={saveGoal}
                aria-invalid={goalError ? true : undefined}
                aria-describedby={goalError ? 'pref-goal-error' : undefined}
              />
              <Button variant="secondary" onClick={saveGoal}>
                Set
              </Button>
            </div>
            {goalError && (
              <p id="pref-goal-error" role="alert" className="mt-1 text-xs text-alert-text">
                {goalError}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function Toggle({
  id,
  label,
  checked,
  onChange,
  hint,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
      <input id={id} type="checkbox" className="mt-1 size-4 accent-[var(--action)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const { prefs, setPrefs } = usePreferences()
  const qc = useQueryClient()
  const profile = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user!.id).single()
      throwIfError(error)
      return data as Profile
    },
  })
  const [displayName, setDisplayName] = React.useState('')
  const [penNames, setPenNames] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [pwError, setPwError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'profile' | 'password' | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  React.useEffect(() => {
    if (profile.data) {
      setDisplayName(profile.data.display_name ?? '')
      setPenNames(profile.data.pen_names.join(', '))
    }
  }, [profile.data])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setBusy('profile')
    try {
      const pen_names = penNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20)
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName.trim() || null, pen_names })
        .eq('id', user!.id)
      throwIfError(error)
      await supabase.auth.updateUser({ data: { display_name: displayName.trim() || null } })
      toast.success('Profile saved')
      qc.invalidateQueries({ queryKey: ['profile', user?.id] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save profile')
    } finally {
      setBusy(null)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null)
    const parsed = passwordSchema.safeParse(password)
    if (!parsed.success) return setPwError(parsed.error.issues[0].message)
    if (password !== confirm) return setPwError('Passwords do not match.')
    setBusy('password')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(null)
    if (error) return setPwError(error.message)
    setPassword('')
    setConfirm('')
    toast.success('Password updated')
  }

  return (
    <PageBody className="max-w-3xl">
      <PageHeader eyebrow="Settings" title="Account and preferences" />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" />
          <form onSubmit={saveProfile} className="space-y-4 px-5 pb-5">
            <Field label="Email" htmlFor="email">
              <Input id="email" value={user?.email ?? ''} disabled />
            </Field>
            <Field label="Display name" htmlFor="display-name">
              <Input id="display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
            </Field>
            <Field label="Pen names" htmlFor="pen-names" hint="Separate with commas">
              <Input id="pen-names" value={penNames} onChange={(e) => setPenNames(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy !== null || profile.isLoading}>
              {busy === 'profile' ? 'Saving...' : 'Save profile'}
            </Button>
          </form>
        </Card>

        <WritingPreferences />

        <AISettingsCard />

        <Card>
          <CardHeader title="Display" />
          <div className="divide-y divide-line px-5 pb-3">
            <div className="flex items-center justify-between gap-4 py-2">
              <label htmlFor="theme" className="text-sm font-medium">
                Theme
              </label>
              <Select id="theme" className="w-40" value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as 'dark' | 'light' })}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 py-2">
              <label htmlFor="font-scale" className="text-sm font-medium">
                Text size
              </label>
              <Select
                id="font-scale"
                className="w-40"
                value={String(prefs.fontScale)}
                onChange={(e) => setPrefs({ fontScale: Number(e.target.value) })}
              >
                <option value="0.875">Small</option>
                <option value="1">Default</option>
                <option value="1.125">Large</option>
                <option value="1.25">Extra large</option>
              </Select>
            </div>
            <Toggle id="high-contrast" label="High contrast" checked={prefs.highContrast} onChange={(v) => setPrefs({ highContrast: v })} />
            <Toggle id="reduce-motion" label="Reduce motion" checked={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Change password" />
          <form onSubmit={changePassword} className="space-y-4 px-5 pb-5" noValidate>
            <Field label="New password" htmlFor="new-password" hint="At least 8 characters">
              <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-password" error={pwError ?? undefined}>
              <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy !== null}>
              {busy === 'password' ? 'Updating...' : 'Update password'}
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Session" />
          <div className="px-5 pb-5">
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </Card>

        <Card className="border-alert">
          <CardHeader title="Delete account" />
          <div className="space-y-3 px-5 pb-5 text-sm text-fg-muted">
            <p>
              Permanently deletes your account with every book, chapter, version, character, world element, timeline, review, export and uploaded
              file. This cannot be undone.
            </p>
            <p>
              Download a complete project backup first from{' '}
              <Link to="/exports" className="link">
                Exports
              </Link>{' '}
              if you may want any of it later.
            </p>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete my account
            </Button>
          </div>
        </Card>
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          destructive
          title="Delete your account?"
          description="Everything in your account is deleted permanently, including uploaded manuscripts and covers. There is no way to recover it."
          confirmLabel="Delete account permanently"
          requireText="DELETE MY ACCOUNT"
          onConfirm={async () => {
            await deleteAccount(user!.id)
            toast.success('Your account was deleted.')
            window.location.assign('/login')
          }}
        />
      </div>
    </PageBody>
  )
}
