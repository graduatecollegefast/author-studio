import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'

// Creative Flow design system: accessibility (WCAG 2 AA via axe), writing modes,
// preferences stored in Supabase, daily goal and session counters.

const url = process.env.SUPABASE_URL!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
const run = Date.now().toString(36)
const email = `design-${run}@example.test`
const password = `Design-${run}-pw!`
let userId = ''

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = data.user.id
})
test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId)
})

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function expectAccessible(page: Page, label: string) {
  // Let fonts and data settle so contrast is measured on the final render.
  await page.waitForLoadState('networkidle')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')} ${v.nodes[0]?.failureSummary?.split('\n')[1] ?? ''}`,
  )
  expect(summary, `${label} accessibility violations`).toEqual([])
  // axe cannot always compute contrast (for example text over a gradient or overlapping layers).
  // Treat those as failures too, so nothing is assumed to pass.
  const unverified = results.incomplete
    .filter((v) => v.id === 'color-contrast')
    .flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.any[0]?.message ?? ''}`))
  expect(unverified, `${label} contrast that axe could not verify`).toEqual([])
}

test('every page passes WCAG AA checks in dark and light themes, and all three writing modes', async ({ page, context }) => {
  test.setTimeout(180_000)
  await signIn(page)

  // Content to render: a book with a chapter and some text.
  await page.goto('/library?new=1')
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Palette Test')
  await page.getByRole('dialog').getByLabel('Target word count').fill('50000')
  await page.getByRole('button', { name: 'Create book' }).click()
  await expect(page.getByRole('heading', { name: 'Palette Test' })).toBeVisible()
  const bookUrl = page.url()
  await page.getByRole('button', { name: 'Add chapter' }).click()
  await page.getByRole('link', { name: 'Write' }).click()
  const editor = page.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await editor.click()
  await page.keyboard.type('The tide came in quietly.')
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })

  for (const theme of ['dark', 'light'] as const) {
    await page.goto('/settings')
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme)
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
    await expectAccessible(page, `settings (${theme})`)
    for (const path of ['/', '/library', bookUrl, `${bookUrl}?tab=files`, `${bookUrl}?tab=details`, `${bookUrl}?tab=analysis`, '/studio', '/characters', '/world', '/series', '/relationships', '/timelines', '/continuity', '/partner', '/partner?tab=questions', '/partner?tab=style', '/ideas']) {
      await page.goto(path)
      await expectAccessible(page, `${path} (${theme})`)
    }
  }

  // Writing modes
  const writeUrl = `${bookUrl}/write`
  for (const mode of ['Creative Drafting', 'Deep Focus', 'Editing & Review']) {
    await page.goto(writeUrl)
    await page.getByRole('radio', { name: mode }).click()
    await expect(page.getByRole('radio', { name: mode })).toHaveAttribute('aria-checked', 'true')
    if (mode !== 'Deep Focus') {
      const show = page.getByRole('button', { name: 'Show side panel' })
      if (await show.count()) await show.click()
      await page.getByRole('tab', { name: 'History' }).click()
      await expect(page.getByLabel('Manual checkpoint')).toBeVisible()
    }
    await expectAccessible(page, `studio ${mode}`)
  }

  // Deep Focus hides panels, the toolbar, and notifications but keeps the save indicator.
  await page.goto(writeUrl)
  await page.getByRole('radio', { name: 'Deep Focus' }).click()
  await expect(page.locator('[data-mode="focus"]')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Chapters and scenes' })).toHaveCount(0)
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /side panel/ })).toHaveCount(0)
  await expect(page.getByTestId('save-status')).toBeVisible()

  // The mode is stored in Supabase: a brand-new browser with no local data opens in Deep Focus.
  await expect
    .poll(async () => (await admin.from('profiles').select('preferences').eq('id', userId).single()).data?.preferences?.writingMode)
    .toBe('focus')
  const fresh = await context.browser()!.newContext({ viewport: { width: 1440, height: 900 } })
  const other = await fresh.newPage()
  await signIn(other)
  await other.goto(writeUrl)
  await expect(other.locator('[data-mode="focus"]')).toBeVisible()
  await fresh.close()
})

test('typography controls, daily goal, and session counter', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings')
  await page.getByRole('radio', { name: /Creative Drafting/ }).check({ force: true })
  await page.getByLabel('Daily word goal (optional)').fill('12')
  await page.getByRole('button', { name: 'Set', exact: true }).click()
  await page.getByLabel('Manuscript font size').fill('22')
  await page.getByLabel('Page width').selectOption('narrow')
  await expect(page.getByText('Saved to your account')).toBeVisible()

  await page.goto('/library?new=1')
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Goal Test')
  await page.getByRole('button', { name: 'Create book' }).click()
  await page.getByRole('button', { name: 'Add chapter' }).click()
  await page.getByRole('link', { name: 'Write' }).click()

  const page_ = page.locator('.manuscript').locator('xpath=ancestor::div[contains(@style,"--ms-size")]')
  await expect(page_).toHaveAttribute('style', /--ms-size: 22px/)
  await expect(page_).toHaveAttribute('style', /max-width: 36rem/)

  const editor = page.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await editor.click()
  await page.keyboard.type('one two three four five six seven eight nine ten eleven twelve thirteen')
  await expect(page.getByTestId('session-words')).toHaveText('+13')
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })
  await expect(page.getByTestId('daily-goal')).toContainText('Goal reached')

  // Session words survive a reload in the same tab; today's total comes from the database.
  await page.reload()
  await expect(page.getByTestId('session-words')).toHaveText('+13')
  // Today's total is account-wide (earlier tests in this file also wrote words), so read it back.
  const goalText = await page.getByTestId('daily-goal').innerText()
  const today = Number(/([\d,]+) \/ 12/.exec(goalText)?.[1].replace(/,/g, ''))
  expect(today).toBeGreaterThanOrEqual(13)

  await page.goto('/')
  await expect(page.getByTestId('today-words')).toHaveText(String(today))
  await expect(page.getByText('Goal reached today.')).toBeVisible()
})

test('a preference changed right before leaving the page is kept', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings')
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('light')
  await page.goto('/') // navigate away immediately, before the debounced save
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
  await expect
    .poll(async () => (await admin.from('profiles').select('preferences').eq('id', userId).single()).data?.preferences?.theme)
    .toBe('light')
})
