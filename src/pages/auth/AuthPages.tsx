import * as React from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { BookOpen } from 'lucide-react'
import { supabase, supabaseConfigured } from '@/lib/supabase/client'
import { emailSchema, passwordSchema } from '@/lib/schemas'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { PageLoader } from '@/components/ui/feedback'

const allowSignup = import.meta.env.VITE_ALLOW_SIGNUP === 'true'

function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-plum text-white dark:text-ink">
            <BookOpen className="size-5" aria-hidden />
          </div>
          <div>
            <div className="font-serif text-xl font-semibold">Author Studio</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber">Private workspace</div>
          </div>
        </div>
        <div className="rounded-[var(--radius-panel)] border border-line bg-panel p-6 shadow-sm">
          <h1 className="font-serif text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {!supabaseConfigured && (
          <p role="alert" className="mt-4 rounded-lg bg-danger-soft p-3 text-xs text-danger">
            Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </p>
        )}
      </div>
    </div>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  )
}

export function LoginPage() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  if (loading) return <PageLoader />
  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const parsedEmail = emailSchema.safeParse(email)
    if (!parsedEmail.success) return setError(parsedEmail.error.issues[0].message)
    if (mode === 'signup') {
      const parsedPw = passwordSchema.safeParse(password)
      if (!parsedPw.success) return setError(parsedPw.error.issues[0].message)
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: parsedEmail.data, password })
        if (error) setError(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message)
      } else {
        const { data, error } = await supabase.auth.signUp({ email: parsedEmail.data, password })
        if (error) setError(error.message)
        else if (!data.session) setNotice('Check your email to confirm your account, then sign in.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title={mode === 'signin' ? 'Welcome back' : 'Create your account'}
      subtitle={mode === 'signin' ? 'Sign in to your manuscripts.' : undefined}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <FormError message={error} />
        {notice && <p className="rounded-lg bg-plum-soft px-3 py-2 text-sm text-plum-strong">{notice}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between text-sm">
        <Link to="/forgot-password" className="text-plum hover:underline">
          Forgot password?
        </Link>
        {allowSignup && (
          <button type="button" className="text-plum hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Create account' : 'I have an account'}
          </button>
        )}
      </div>
    </AuthFrame>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('')
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    // Same message whether or not the address exists, so accounts cannot be probed.
    if (error && !/rate limit/i.test(error.message)) setSent(true)
    else if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <AuthFrame title="Reset your password" subtitle="We will email you a secure link.">
      {sent ? (
        <p className="text-sm text-fg-muted">If an account exists for that address, a reset link is on its way. The link expires after one hour.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Sending...' : 'Send reset link'}
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-5 inline-block text-sm text-plum hover:underline">
        Back to sign in
      </Link>
    </AuthFrame>
  )
}

export function ResetPasswordPage() {
  const { session, loading, finishRecovery } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  if (loading) return <PageLoader />
  if (!session) {
    return (
      <AuthFrame title="Link expired" subtitle="This reset link is invalid or has expired.">
        <Link to="/forgot-password" className="text-sm text-plum hover:underline">
          Request a new link
        </Link>
      </AuthFrame>
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = passwordSchema.safeParse(password)
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    finishRecovery()
    navigate('/', { replace: true })
  }

  return (
    <AuthFrame title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="New password" htmlFor="password" hint="At least 8 characters">
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Saving...' : 'Save password'}
        </Button>
      </form>
    </AuthFrame>
  )
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading, recovering } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoader label="Checking your session" />
  if (session && recovering) return <Navigate to="/reset-password" replace />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}
