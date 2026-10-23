import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'

// Series review in the AI Writing Partner: book 2 against book 1 (offline test model, AI_MOCK=1).

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts)
const run = Date.now().toString(36)
const email = `series-${run}@example.test`
const password = `Series-${run}-pw!`
let userId = ''
let db: SupabaseClient
const ids: Record<string, string> = {}
const B1 = 'Mara Vance had green eyes like the sea in winter.\n\nEli Stone kept the boat ready at the pier.'
const B2 = 'Mara Vance blinked her brown eyes against the wind.\n\nThe gulls circled the empty harbor all morning.'
const doc = (text: string) => ({ type: 'doc', content: text.split('\n\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) })

async function book(title: string, text: string) {
  const id = (await db.from('books').insert({ title }).select('id').single()).data!.id as string
  const ch = (await db.rpc('create_chapter', { p_book_id: id, p_title: 'Chapter One' })).data as string
  const scene = (await db.from('scenes').select('id').eq('chapter_id', ch).single()).data!.id
  await db.rpc('save_scene', { p_scene_id: scene, p_content: doc(text), p_content_text: text, p_expected_revision: 1 })
  return id
}

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = data.user.id
  db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, opts)
  await db.auth.signInWithPassword({ email, password })
  ids.b1 = await book('Tide One', B1)
  ids.b2 = await book('Tide Two', B2)
  ids.solo = await book('Standalone', 'Nothing to see.')
  ids.series = (await db.from('series').insert({ name: 'Tide Series' }).select('id').single()).data!.id
  await db.from('series_books').insert([
    { series_id: ids.series, book_id: ids.b1, reading_order: 1 },
    { series_id: ids.series, book_id: ids.b2, reading_order: 2 },
  ])
  ids.mara = (
    await db
      .from('characters')
      .insert({ full_name: 'Mara Vance', appearance: { eyes: 'green' } })
      .select('id')
      .single()
  ).data!.id
  await db.from('character_appearances').insert({ character_id: ids.mara, book_id: ids.b1 })
  await db.from('characters').insert([{ full_name: 'Eli Stone' }, { full_name: 'Eli Stone' }])
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

async function expectAccessible(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
}

test('series review: shared characters, linking, and quoted conflicts with the earlier book', async ({ page }) => {
  await signIn(page)

  // A book outside any series explains what to do.
  await page.goto(`/partner?tab=series&book=${ids.solo}`)
  await expect(page.getByText('This book is not in a series')).toBeVisible()

  await page.goto(`/partner?tab=series&book=${ids.b2}`)
  await expect(page.getByRole('tab', { name: 'Series review' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('earlier-books')).toContainText('1. Tide One')
  const shared = page.getByTestId('shared-characters')
  await expect(shared.getByRole('listitem')).toHaveCount(1)
  await expect(shared).toContainText('Mara Vance')
  await expect(shared).toContainText('1 mention here · in Tide One')
  await expect(shared).toContainText('Not linked')
  await expect(page.getByTestId('duplicates')).toContainText('Eli Stone (2 records)')
  await expect(page.getByTestId('series-estimate')).toContainText('Reviews 1 character and 1 chapter')
  await expectAccessible(page)

  await page.getByRole('button', { name: 'Link 1 to this book' }).click()
  await expect(shared).toContainText('Linked')
  expect((await db.from('character_appearances').select('id').eq('book_id', ids.b2).eq('character_id', ids.mara)).data).toHaveLength(1)

  const before = (await db.from('scenes').select('content_text').eq('book_id', ids.b2)).data
  await page.getByRole('button', { name: 'Review against earlier books' }).click()
  await expect(page.getByTestId('series-status')).toHaveText('Complete', { timeout: 30_000 })
  await expect(page.getByTestId('series-progress')).toContainText('left out because a quote could not be found')
  const finding = page.getByTestId('finding')
  await expect(finding).toHaveCount(1)
  await finding.getByRole('button', { name: 'View evidence' }).click()
  await expect(finding.getByTestId('finding-evidence')).toContainText('Established (Tide One, Chapter One, Scene 1)')
  await expect(finding.getByTestId('finding-evidence')).toContainText('Mara Vance had green eyes like the sea in winter.')
  await expect(finding.getByTestId('finding-evidence')).toContainText('"Mara Vance blinked her brown eyes against the wind."')
  await expectAccessible(page)
  // Nothing in the book changed, and the finding is also in the Continuity Checker.
  expect((await db.from('scenes').select('content_text').eq('book_id', ids.b2)).data).toEqual(before)
  await page.goto(`/continuity?book=${ids.b2}`)
  await expect(page.getByTestId('finding')).toHaveCount(1)

  // Resolving it here removes it from the series review list.
  await page.getByRole('button', { name: 'Mark intentional' }).click()
  await page.goto(`/partner?tab=series&book=${ids.b2}`)
  await expect(page.getByText('No open findings')).toBeVisible()
})

test('merge duplicates: from the series review warning or a character page, with confirmation', async ({ page }) => {
  await signIn(page)
  await page.goto(`/partner?tab=series&book=${ids.b2}`)
  await page.getByRole('link', { name: 'Merge Eli Stone' }).click()
  const dialog = page.getByRole('dialog', { name: 'Merge into Eli Stone' })
  await expect(dialog).toBeVisible()
  const candidates = dialog.getByTestId('merge-candidates')
  // The other Eli Stone is first, marked, and already ticked.
  await expect(candidates.getByRole('listitem').first()).toContainText('Same name')
  await expect(candidates.getByRole('checkbox').first()).toBeChecked()
  await expectAccessible(page)
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog.getByTestId('merge-confirm')).toContainText('A full copy of each is kept in your activity history.')
  await dialog.getByRole('button', { name: 'Merge 1 into Eli Stone' }).click()
  await expect(page.getByText('1 character was merged into Eli Stone.')).toBeVisible()
  expect((await db.from('characters').select('id').eq('full_name', 'Eli Stone')).data).toHaveLength(1)

  // The warning is gone once the duplicate is merged.
  await page.goto(`/partner?tab=series&book=${ids.b2}`)
  await expect(page.getByTestId('shared-characters')).toBeVisible()
  await expect(page.getByTestId('duplicates')).toHaveCount(0)

  // From a character page: search, pick, go back, cancel. Nothing changes.
  await page.goto(`/characters/${ids.mara}`)
  await page.getByRole('button', { name: 'Merge duplicates' }).click()
  const d2 = page.getByRole('dialog', { name: 'Merge into Mara Vance' })
  await expect(d2.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await d2.getByLabel('Find characters').fill('Eli')
  await d2.getByRole('checkbox').first().check()
  await d2.getByRole('button', { name: 'Continue' }).click()
  await d2.getByRole('button', { name: 'Back' }).click()
  await d2.getByRole('button', { name: 'Cancel' }).click()
  expect((await db.from('characters').select('id')).data).toHaveLength(2)
})
