import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'

// Phase 2B: AI analysis with the offline test provider (AI_MOCK=1 on the functions server).
// Upload, estimate, analyze, review with evidence, bulk approve, and see the Story Bible fill in.

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const run = Date.now().toString(36)
const email = `analysis-${run}@example.test`
const password = `Analysis-${run}-pw!`
let userId = ''

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = data.user.id
})
test.afterAll(async () => {
  if (!userId) return
  const { data: folders } = await admin.storage.from('manuscripts').list(userId)
  for (const f of folders ?? []) {
    const { data: files } = await admin.storage.from('manuscripts').list(`${userId}/${f.name}`)
    if (files?.length) await admin.storage.from('manuscripts').remove(files.map((x) => `${userId}/${f.name}/${x.name}`))
  }
  await admin.auth.admin.deleteUser(userId)
})

const filler = Array.from({ length: 45 }, () => 'The tide came in and went out again.').join(' ')
const book = [
  'Chapter 1',
  'Mara Vance worked as a lighthouse keeper. Mara and Eli were sisters.',
  'They met at the Harbor Diner on Sundays.',
  'People said Eli hid letters under the pier.',
  filler,
  'Chapter 2',
  'Years earlier, the lighthouse had burned to the waterline.',
  filler,
  'Chapter 3',
  'MOCK_DECLINE The storm took the lantern room.',
  filler,
].join('\n\n')

test('analyze a book, review discoveries with evidence, and build the Story Bible', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)

  // The Story Bible is open now, and empty.
  await page.getByRole('link', { name: 'Character Bible' }).click()
  await expect(page.getByRole('heading', { name: 'No characters yet' })).toBeVisible()

  await page.goto('/library?new=1')
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Salt Letters')
  await page.getByRole('button', { name: 'Create book' }).click()
  await expect(page.getByRole('heading', { name: 'Salt Letters' })).toBeVisible()
  const bookUrl = page.url()

  await page.getByRole('tab', { name: 'Manuscript files' }).click()
  await page.getByTestId('manuscript-input').setInputFiles({ name: 'salt.txt', mimeType: 'text/plain', buffer: Buffer.from(book) })
  await expect(page.getByRole('row', { name: /salt\.txt/ }).getByTestId('extraction-status')).toHaveText('Completed', { timeout: 30_000 })

  // Estimate first, then analyze.
  await page.getByRole('tab', { name: 'AI analysis' }).click()
  const estimate = page.getByTestId('analysis-estimate')
  await expect(estimate).toContainText('Estimated cost')
  await expect(estimate).toContainText('Test model')
  await page.getByRole('button', { name: 'Analyze book' }).click()
  await expect(page.getByTestId('analysis-status')).toHaveText('Complete', { timeout: 60_000 })
  const progress = page.getByTestId('analysis-progress')
  await expect(progress).toContainText('3 of 3 passages, whole book done')
  await expect(progress).toContainText('1 passage was declined by the AI provider')
  await expect(progress).toContainText('left out because their quotes could not be found')

  // Review: evidence is the exact text; invented quotes never appear; statement types are labeled.
  const list = page.getByTestId('discoveries')
  const occupation = list.getByTestId('discovery').filter({ hasText: 'lighthouse keeper' }).first()
  await expect(occupation).toContainText('Mara Vance')
  await expect(occupation).toContainText('"Mara Vance worked as a lighthouse keeper."')
  await expect(occupation).toContainText('Chapter 1')
  await expect(list).not.toContainText('Nobody Real')
  const rumor = list.getByTestId('discovery').filter({ hasText: 'hid letters' })
  await expect(rumor).toContainText('Rumor')
  await expect(rumor).toContainText('60% confidence')
  await expect(list).toContainText('Mock plot')

  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(a11y.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])

  // Bulk approval takes only high-confidence, literal statements (not the rumor, not the 80% place).
  await page.getByRole('button', { name: 'Approve all high-confidence (3)' }).click()
  await page.getByRole('button', { name: 'Approve them' }).click()
  await expect(page.getByText('Approved 3 discoveries')).toBeVisible()

  await rumor.getByRole('button', { name: /^Reject/ }).click()
  await expect(page.getByText('Rejected 1 discovery')).toBeVisible()

  // Correct a discovery before approving it.
  const diner = list.getByTestId('discovery').filter({ hasText: 'Harbor Diner' })
  await diner.getByRole('button', { name: 'Edit before approving' }).click()
  await diner.getByLabel('Value').fill('A diner on the harbor where the sisters meet every Sunday.')
  await diner.getByRole('button', { name: 'Save' }).click()
  await expect(diner).toContainText('Author confirmed')
  await diner.getByRole('button', { name: /^Approve/ }).click()
  await expect(page.getByText('Approved 1 discovery')).toBeVisible()

  // Character Bible: profile, relationship, and canon with its quote.
  await page.getByRole('link', { name: 'Character Bible' }).click()
  const chars = page.getByTestId('character-list')
  await expect(chars.getByRole('link')).toHaveCount(2)
  await chars.getByRole('link', { name: /Mara Vance/ }).click()
  await expect(page.getByLabel('Occupation')).toHaveValue('lighthouse keeper')
  await expect(page.getByTestId('character-relationships')).toContainText('sisters with Eli')
  await expect(page.getByTestId('canon-facts')).toContainText('"Mara Vance worked as a lighthouse keeper."')
  await page.getByLabel('Hair').fill('Salt gray, cut short')
  await page.getByRole('button', { name: 'Save character' }).click()
  await expect(page.getByText('Character saved')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Hair')).toHaveValue('Salt gray, cut short')

  // World Bible.
  await page.getByRole('link', { name: 'World Bible' }).click()
  await expect(page.getByTestId('world-list')).toContainText('Businesses')
  await page.getByRole('link', { name: /Harbor Diner/ }).click()
  await expect(page.getByLabel('Description')).toHaveValue('A diner on the harbor where the sisters meet every Sunday.')
  await expect(page.getByRole('link', { name: 'Salt Letters' }).first()).toBeVisible()

  // Settings: provider status, usage, and limits that block new jobs.
  await page.goto('/settings')
  await expect(page.getByTestId('ai-providers')).toContainText('Test provider: connected')
  await expect(page.getByTestId('ai-usage')).not.toContainText('$0.00')
  await page.getByLabel('Per day').fill('0')
  await page.getByRole('button', { name: 'Save AI settings' }).click()
  await expect(page.getByText('AI settings saved')).toBeVisible()
  await page.goto(`${bookUrl}?tab=analysis`)
  await expect(page.getByRole('alert').filter({ hasText: 'daily AI limit of $0.00' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Analyze again from the start' })).toBeDisabled()
})
