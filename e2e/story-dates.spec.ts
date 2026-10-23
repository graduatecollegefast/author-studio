import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'

// Where characters live, story dates read from the text, and ages checked against birth dates.

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts)
const run = Date.now().toString(36)
const email = `dates-${run}@example.test`
const password = `Dates-${run}-pw!`
let userId = ''
let db: SupabaseClient
const ids: Record<string, string> = {}
const doc = (text: string) => ({ type: 'doc', content: text.split('\n\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) })

async function chapter(title: string, text: string) {
  const ch = (await db.rpc('create_chapter', { p_book_id: ids.book, p_title: title })).data as string
  const scene = (await db.from('scenes').select('id').eq('chapter_id', ch).single()).data!.id
  await db.rpc('save_scene', { p_scene_id: scene, p_content: doc(text), p_content_text: text, p_expected_revision: 1 })
  return ch
}

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = data.user.id
  db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, opts)
  await db.auth.signInWithPassword({ email, password })
  ids.book = (await db.from('books').insert({ title: 'Dated Book' }).select('id').single()).data!.id
  ids.c1 = await chapter('Arrival', 'It was March 3, 2024 when Mara Vance came home.\n\nMara, 34, unpacked slowly.')
  ids.c2 = await chapter('Weeks Later', 'Nothing changed for a while.')
  ids.c3 = await chapter('The Party', 'By June 9th the town was ready.\n\nMara was thirty-six years old, or so she joked.')
  ids.mara = (
    await db.from('characters').insert({ full_name: 'Mara Vance', date_of_birth: 'January 12, 1990', age: '30' }).select('id').single()
  ).data!.id
  await db.from('character_appearances').insert({ character_id: ids.mara, book_id: ids.book })
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

test('where a character lives is saved on their profile', async ({ page }) => {
  await signIn(page)
  await page.goto(`/characters/${ids.mara}`)
  await page.getByLabel('Where they live').fill('Harbor Street, Portsmouth')
  await page.getByRole('button', { name: 'Save character' }).click()
  await expect(page.getByText('Character saved')).toBeVisible()
  expect((await db.from('characters').select('residence').eq('id', ids.mara).single()).data!.residence).toBe('Harbor Street, Portsmouth')
})

test('story dates are read from the text, carried forward, editable, and ages are checked', async ({ page }) => {
  await signIn(page)
  await page.goto(`/books/${ids.book}?tab=dates`)
  const rows = page.getByTestId('chapter-date')
  await expect(rows.nth(0)).toContainText('March 3, 2024')
  await expect(rows.nth(0)).toContainText('"March 3, 2024"')
  await expect(rows.nth(1)).toContainText('Same as an earlier chapter')
  await expect(rows.nth(1)).toContainText('carried from Arrival')
  await expect(rows.nth(2)).toContainText('June 9, 2024')
  await expectAccessible(page)

  // Ages: born January 12, 1990 makes Mara 34 in March and June 2024.
  const ages = page.getByTestId('character-ages')
  await expect(ages).toContainText('January 12, 1990')
  await expect(ages).toContainText('Harbor Street, Portsmouth')
  const issues = page.getByTestId('age-issues')
  await expect(issues).toContainText('2 ages do not match')
  await expect(issues).toContainText(
    "Mara Vance's profile says age 30, but born January 12, 1990 makes them 34 when this book begins (March 3, 2024).",
  )
  await expect(issues).toContainText('Mara Vance is given as 36 here, but born January 12, 1990 makes them 34 on June 9, 2024.')

  // Save what was found; nothing you set is overwritten.
  await page.getByRole('button', { name: 'Save 2 dates found in the text' }).click()
  await expect(page.getByText('2 chapter dates saved')).toBeVisible()
  const saved = (await db.from('chapters').select('title, story_date, story_date_source').eq('book_id', ids.book).order('position')).data!
  expect(saved.map((c) => [c.story_date, c.story_date_source])).toEqual([
    ['2024-03-03', 'detected'],
    [null, null],
    ['2024-06-09', 'detected'],
  ])

  // Set chapter 3 yourself: a later year makes Mara 36, so that age now matches.
  await page.getByLabel('Story date for The Party').fill('2026-06-09')
  await rows.nth(2).getByRole('button', { name: 'Set' }).click()
  await expect(rows.nth(2)).toContainText('Set by you')
  await expect(issues).toContainText('1 age does not match')
  expect((await db.from('chapters').select('story_date_source').eq('id', ids.c3).single()).data!.story_date_source).toBe('author')

  // Fix the profile age: everything matches.
  await db.from('characters').update({ age: '34' }).eq('id', ids.mara)
  await page.reload()
  await expect(page.getByTestId('ages-ok')).toBeVisible()
})

test('the continuity check lists age conflicts for free, quoting the text', async ({ page }) => {
  await db.from('chapters').update({ story_date: null, story_date_source: null, story_date_text: null }).eq('id', ids.c3)
  await signIn(page)
  await page.goto(`/continuity?book=${ids.book}`)
  await page.getByRole('button', { name: 'Check continuity' }).click()
  await expect(page.getByTestId('continuity-status')).toHaveText('Complete', { timeout: 30_000 })
  const finding = page.getByTestId('finding').filter({ hasText: 'is given as 36' })
  await expect(finding).toHaveCount(1)
  await finding.getByRole('button', { name: 'View evidence' }).click()
  await expect(finding.getByTestId('finding-evidence')).toContainText('"Mara was thirty-six years old"')
  await expect(finding.getByTestId('finding-evidence')).toContainText('Born January 12, 1990')
})
