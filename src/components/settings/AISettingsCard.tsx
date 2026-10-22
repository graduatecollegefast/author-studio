import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, Spinner } from '@/components/ui/feedback'
import { getAISettings, getAIStatus, getUsageSummary, saveAISettings, type AISettingsRow } from '@/services/ai'
import { findModel, formatUsd, MODELS, resolveRoute, TASK_TYPES, type ProviderId, type TaskType } from '@/lib/ai/catalog'
import { formatNumber } from '@/lib/utils'

const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', mock: 'Test provider' }

export function AISettingsCard() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['ai-status'], queryFn: getAIStatus, staleTime: 60_000 })
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: getAISettings })
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => getUsageSummary() })
  const [draft, setDraft] = React.useState<AISettingsRow | null>(null)
  const [limits, setLimits] = React.useState({ daily: '', monthly: '', task: '' })
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!settings.data) return
    setDraft(settings.data)
    setLimits({ daily: String(settings.data.daily_limit_usd), monthly: String(settings.data.monthly_limit_usd), task: String(settings.data.max_task_usd) })
  }, [settings.data])

  React.useEffect(() => {
    if (window.location.hash === '#ai' && settings.data) document.getElementById('ai')?.scrollIntoView({ block: 'start' })
  }, [settings.data])

  const available = (status.data?.providers ?? []).map((p) => p.id as ProviderId)

  async function save() {
    if (!draft) return
    const nums = [limits.daily, limits.monthly, limits.task].map((v) => Number(v.replace(/[$,]/g, '')))
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) return setError('Enter limits in dollars from 0 to 1,000.')
    if (nums[0] > nums[1]) return setError('The daily limit cannot be higher than the monthly limit.')
    setError(null)
    setSaving(true)
    try {
      await saveAISettings({ ...draft, daily_limit_usd: nums[0], monthly_limit_usd: nums[1], max_task_usd: nums[2] })
      toast.success('AI settings saved')
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
      qc.invalidateQueries({ queryKey: ['analysis-estimate'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card id="ai">
      <CardHeader title="AI providers, limits and usage" action={<Badge tone="ai">AI</Badge>} />
      <div className="space-y-6 px-5 pb-5 text-sm">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Providers</h3>
          {status.isLoading ? (
            <Spinner />
          ) : status.error ? (
            <ErrorState error={status.error} onRetry={() => void status.refetch()} />
          ) : available.length ? (
            <ul className="flex flex-wrap gap-2" data-testid="ai-providers">
              {available.map((p) => (
                <li key={p}>
                  <Badge tone="progress">{PROVIDER_NAMES[p] ?? p}: connected</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-alert bg-alert-soft p-3 text-alert-text" role="status">
              No AI provider is connected. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the Netlify environment variables for this site, then
              redeploy. Keys are kept on the server and never shown here.
            </p>
          )}
        </section>

        {draft && available.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Models</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {(Object.keys(TASK_TYPES) as TaskType[]).map((t) => {
                const current = resolveRoute(t, draft.routing, available)
                return (
                  <Field key={t} label={TASK_TYPES[t].label} htmlFor={`route-${t}`}>
                    <Select
                      id={`route-${t}`}
                      value={current ? `${current.provider}/${current.model}` : ''}
                      onChange={(e) => {
                        const [provider, ...rest] = e.target.value.split('/')
                        setDraft({ ...draft, routing: { ...draft.routing, [t]: { provider: provider as ProviderId, model: rest.join('/') } } })
                      }}
                    >
                      {MODELS.filter((m) => available.includes(m.provider)).map((m) => (
                        <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                          {m.label} (${m.inputPerM} in / ${m.outputPerM} out per million tokens)
                        </option>
                      ))}
                    </Select>
                  </Field>
                )
              })}
            </div>
          </section>
        )}

        {draft && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Spending limits (US dollars)</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Per day" htmlFor="limit-daily">
                <Input id="limit-daily" inputMode="decimal" value={limits.daily} onChange={(e) => setLimits({ ...limits, daily: e.target.value })} />
              </Field>
              <Field label="Per month" htmlFor="limit-monthly">
                <Input id="limit-monthly" inputMode="decimal" value={limits.monthly} onChange={(e) => setLimits({ ...limits, monthly: e.target.value })} />
              </Field>
              <Field label="Per job" htmlFor="limit-task">
                <Input id="limit-task" inputMode="decimal" value={limits.task} onChange={(e) => setLimits({ ...limits, task: e.target.value })} />
              </Field>
            </div>
            <p className="mt-2 text-xs text-fg-muted">Jobs that would pass a limit do not start, and running jobs pause before they pass one. Days and months are counted in UTC.</p>
            {error && (
              <p role="alert" className="mt-2 text-alert-text">
                {error}
              </p>
            )}
            <Button className="mt-3" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving...' : 'Save AI settings'}
            </Button>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Usage</h3>
          {usage.isLoading ? (
            <Spinner />
          ) : usage.error ? (
            <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
          ) : (
            <>
              <dl className="mb-3 grid grid-cols-2 gap-3" data-testid="ai-usage">
                <div className="rounded-lg bg-panel-2 p-3">
                  <dt className="text-xs text-fg-muted">Today</dt>
                  <dd className="font-serif text-xl font-semibold">{formatUsd(usage.data!.today)}</dd>
                </div>
                <div className="rounded-lg bg-panel-2 p-3">
                  <dt className="text-xs text-fg-muted">This month</dt>
                  <dd className="font-serif text-xl font-semibold">{formatUsd(usage.data!.month)}</dd>
                </div>
              </dl>
              {usage.data!.byModel.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-fg-muted">
                      <tr>
                        <th className="py-1.5 pr-3 font-semibold">Model</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Calls</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Tokens in</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Tokens out</th>
                        <th className="py-1.5 text-right font-semibold">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {usage.data!.byModel.map((m) => (
                        <tr key={`${m.provider}/${m.model}`}>
                          <td className="py-1.5 pr-3">{findModel(m.provider, m.model)?.label ?? m.model}</td>
                          <td className="py-1.5 pr-3 text-right">{formatNumber(m.calls)}</td>
                          <td className="py-1.5 pr-3 text-right">{formatNumber(m.input)}</td>
                          <td className="py-1.5 pr-3 text-right">{formatNumber(m.output)}</td>
                          <td className="py-1.5 text-right">{formatUsd(m.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-fg-muted">
                Costs are calculated from the token counts each provider reports and the published list prices as of October 22, 2026. Your provider
                bill is the final word.
              </p>
            </>
          )}
        </section>
      </div>
    </Card>
  )
}
