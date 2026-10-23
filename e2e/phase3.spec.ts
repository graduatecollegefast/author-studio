import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'

// Phase 3: series and universes, relationship map, story timelines, continuity checker.
// Canon and chapters are seeded as the test author; the continuity check uses the offline
// test model (AI_MOCK=1 on the functions server).

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts)
const run = Date.now().toString(36)
const email = `phase3-${run}@example.test`
const password = `Phase3-${run}-pw!`
let userId = ''
let db: SupabaseClient
const ids: Record<string, string> = {}
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = data.user.id
  db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, opts)
  await db.auth.signInWithPassword({ email, password })

  ids.one = (await db.from('books').insert({ title: 'Tide One' }).select('id').single()).data!.id
  ids.two = (await db.from('books').insert({ title: 'Tide Two' }).select('id').single()).data!.id
  ids.three = (await db.from('books').insert({ title: 'Tide Three' }).select('id').single()).data!.id
  const made = (await db.from('characters').insert([{ full_name: 'Mara Vance' }, { full_name: 'Eli Vance' }, { full_name: 'Cy Lake' }]).select('id, full_name')).data!
  const idOf = (n: string) => made.find((c) => c.full_name === n)!.id
  Object.assign(ids, { mara: idOf('Mara Vance'), eli: idOf('Eli Vance'), cy: idOf('Cy Lake') })
  for (const [c, b] of [
    [ids.mara, ids.one],
    [ids.eli, ids.one],
    [ids.mara, ids.two],
  ])
    await db.from('character_appearances').insert({ character_id: c, book_id: b })

  // Approved canon from book one: Mara's job and eye color. Book two records a different eye color.
  const facts = [
    { book_id: ids.one, attribute: 'occupation', value: 'lighthouse keeper', quote: 'Mara Vance worked as a lighthouse keeper.' },
    { book_id: ids.one, attribute: 'appearance.eyes', value: 'green', quote: 'Her green eyes caught the lamp.' },
    { book_id: ids.two, attribute: 'appearance.eyes', value: 'brown', quote: 'Her brown eyes narrowed.' },
  ]
  for (const f of facts) {
    const row = (
      await db
        .from('canon_facts')
        .insert({ book_id: f.book_id, entity_type: 'character', entity_id: ids.mara, entity_label: 'Mara Vance', attribute: f.attribute, value: f.value, statement_type: 'narrator', status: 'approved', category: 'character' })
        .select('id')
        .single()
    ).data!
    await db.from('fact_sources').insert({ fact_id: row.id, book_id: f.book_id, excerpt: f.quote, location_label: 'Chapter 1' })
  }

  // Books one and two share a world, so book one's canon applies to book two.
  const world = (await db.from('universes').insert({ name: 'Lighthouse World' }).select('id').single()).data!.id
  await db.from('book_universes').insert([
    { universe_id: world, book_id: ids.one },
    { universe_id: world, book_id: ids.two },
  ])

  // Book two, chapter one contradicts the job.
  const chapterId = (await db.rpc('create_chapter', { p_book_id: ids.two, p_title: 'Chapter 1' })).data as string
  const { data: scene } = await db.from('scenes').select('id').eq('chapter_id', chapterId).single()
  const text = 'Dawn came over the harbor. Mara Vance worked as a baker. She smiled at Eli.'
  await db.rpc('save_scene', { p_scene_id: scene!.id, p_content: doc(text), p_content_text: text, p_expected_revision: 1 })
  ids.scene = scene!.id
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

test('series and universes: create, add books, order three ways, shared cast, threads', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Series & Universes' }).click()
  await page.getByRole('button', { name: 'New universe' }).click()
  await page.getByLabel('Name').fill('Harborverse')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Harborverse' })).toBeVisible()
  await page.getByLabel('Add a book').selectOption({ label: 'Tide Three' })
  await page.getByRole('button', { name: 'Add book' }).click()
  await expect(page.getByTestId('universe-books')).toContainText('Tide Three')

  await page.goto('/series')
  await page.getByRole('button', { name: 'New series' }).click()
  await page.getByLabel('Name').fill('The Tides')
  await page.getByLabel('Universe').selectOption({ label: 'Harborverse' })
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'The Tides' })).toBeVisible()

  for (const t of ['Tide One', 'Tide Two']) {
    await page.getByLabel('Add a book').selectOption({ label: t })
    await page.getByRole('button', { name: 'Add to series' }).click()
    await expect(page.getByTestId('series-books')).toContainText(t)
  }
  await page.getByLabel('Planned number of books').fill('3')
  await page.getByRole('button', { name: 'Save series' }).click()
  await expect(page.getByText('Series saved')).toBeVisible()
  await expect(page.getByTestId('series-count')).toHaveText('2 books of 3 planned')

  // Chronological order differs from reading order.
  await page.getByRole('tab', { name: 'Chronological order' }).click()
  await page.getByRole('button', { name: 'Move Tide Two earlier' }).click()
  await expect(page.getByTestId('series-books').getByRole('listitem').first()).toContainText('Tide Two')
  await page.getByRole('tab', { name: 'Reading order' }).click()
  await expect(page.getByTestId('series-books').getByRole('listitem').first()).toContainText('Tide One')

  // Shared characters across the series' books.
  await expect(page.getByTestId('shared-characters')).toContainText('Mara Vance')
  await expect(page.getByTestId('shared-characters').getByRole('link', { name: /Mara Vance/ })).toContainText('2 books')

  // A series-wide mystery.
  await page.getByRole('button', { name: 'Add thread' }).click()
  await page.getByLabel('Type').selectOption('mystery')
  await page.getByLabel('Title').fill('Who lit the lamp?')
  await page.getByLabel('Opens in').selectOption({ label: 'Tide One' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('threads-mystery')).toContainText('Who lit the lamp?')
  await expect(page.getByTestId('threads-mystery')).toContainText('Opens in Tide One')
  await expectAccessible(page)

  // The universe now shows the series and the cast of all its books.
  await page.goto('/series')
  await page.getByTestId('universe-list').getByRole('link', { name: /Harborverse/ }).click()
  await expect(page.getByTestId('universe-series')).toContainText('The Tides')
  await expect(page.getByTestId('shared-characters')).toContainText('Eli Vance')
  await expectAccessible(page)
})

test('relationship map: pair and group relationships, navigate between characters', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Relationship Map' }).click()
  await page.getByLabel('Character', { exact: true }).selectOption({ label: 'Mara Vance' })
  await page.getByRole('button', { name: 'New relationship' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Connected to').selectOption({ label: 'Eli Vance' })
  await dialog.getByLabel('Category').selectOption('family')
  await dialog.getByLabel('Label (optional)').fill('sisters')
  await dialog.getByLabel('Current status').fill('estranged')
  await dialog.getByLabel('Past status').fill('close')
  await dialog.getByRole('checkbox', { name: 'Tide Two' }).check()
  await dialog.getByRole('button', { name: 'Save relationship' }).click()
  await expect(page.getByText('Relationship saved')).toBeVisible()
  const list = page.getByTestId('connections')
  await expect(list.getByRole('listitem').first()).toContainText(/sisters\s*with\s*Eli Vance/)
  await expect(list).toContainText('Now: estranged')
  await expect(page.getByRole('group', { name: /Relationship map for Mara Vance/ })).toBeVisible()

  // A three-person group, not forced into pairs.
  await page.getByRole('button', { name: 'New group' }).click()
  const g = page.getByRole('dialog')
  await g.getByLabel('Name').fill('The lamp keepers')
  await g.getByLabel('Structure').fill('triad')
  for (const n of ['Mara Vance', 'Eli Vance', 'Cy Lake']) await g.getByRole('checkbox', { name: n, exact: true }).check()
  await g.getByLabel('Role of Mara Vance').fill('anchor')
  await g.getByRole('button', { name: 'Save group' }).click()
  await expect(list).toContainText('The lamp keepers')
  await expect(list).toContainText('Mara Vance (anchor), Eli Vance, Cy Lake')

  // Selecting a connection re-centers the map.
  await list.getByRole('button', { name: 'Eli Vance', exact: true }).click()
  await expect(page.getByRole('group', { name: /Relationship map for Eli Vance/ })).toBeVisible()
  await expect(page.getByTestId('connections')).toContainText(/sisters\s*with\s*Mara Vance/)
  await expectAccessible(page)
})

test('timeline: story order versus reveal order, flashbacks and filters', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Story Timelines' }).click()
  const add = async (o: { title: string; date?: string; approx?: string; book: string; reveal: string; flashback?: boolean; character?: string }) => {
    await page.getByRole('button', { name: 'New event' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Title').fill(o.title)
    if (o.date) {
      await d.getByLabel('Date', { exact: true }).selectOption('exact')
      await d.getByLabel('Starts').fill(o.date)
    } else if (o.approx) {
      await d.getByLabel('Date', { exact: true }).selectOption('approximate')
      await d.getByLabel('When').fill(o.approx)
    }
    await d.getByLabel('Position in reveal order').fill(o.reveal)
    await d.getByLabel('Book').selectOption({ label: o.book })
    if (o.flashback) await d.getByLabel('Shown as a flashback').check()
    if (o.character) await d.getByRole('checkbox', { name: o.character, exact: true }).check()
    await d.getByRole('button', { name: 'Save event' }).click()
    await expect(d).toBeHidden()
  }
  await add({ title: 'The wedding', date: '2020-06-01', book: 'Tide One', reveal: '1' })
  await add({ title: 'The lighthouse fire', date: '2001-03-03', book: 'Tide One', reveal: '2', flashback: true, character: 'Mara Vance' })
  await add({ title: 'Someday at sea', approx: 'Someday', book: 'Tide Two', reveal: '1' })

  const items = page.getByTestId('timeline').getByRole('heading', { level: 2 })
  await expect(items).toHaveText(['The lighthouse fire', 'The wedding', 'Someday at sea'])
  await expect(page.getByTestId('timeline')).toContainText('Flashback')
  await page.getByRole('tab', { name: 'Reveal order' }).click()
  await expect(items).toHaveText(['The wedding', 'The lighthouse fire', 'Someday at sea'])

  await page.getByLabel('Character').selectOption({ label: 'Mara Vance' })
  await expect(items).toHaveText(['The lighthouse fire'])
  await expectAccessible(page)
})

test('continuity: free canon check, AI chapter check with evidence, and review actions that change nothing else', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Continuity Checker' }).click()
  await page.getByLabel('Book').selectOption({ label: 'Tide Two' })
  await expect(page.getByTestId('continuity-estimate')).toContainText('Compares 1 of 1 chapters')
  await page.getByRole('button', { name: 'Check continuity' }).click()
  await expect(page.getByTestId('continuity-status')).toHaveText('Complete', { timeout: 60_000 })
  await expect(page.getByTestId('continuity-progress')).toContainText('1 left out because their quotes or canon could not be verified')

  const findings = page.getByTestId('finding')
  await expect(findings).toHaveCount(2)
  const job = findings.filter({ hasText: 'lighthouse keeper' })
  await expect(job).toContainText('Warning')
  await expect(job).toContainText('Chapter 1, Scene 1')
  await job.getByRole('button', { name: 'View evidence' }).click()
  const evidence = job.getByTestId('finding-evidence')
  await expect(evidence).toContainText('Mara Vance worked as a lighthouse keeper.')
  await expect(evidence).toContainText('Tide One, Chapter 1')
  await expect(evidence).toContainText('"Mara Vance worked as a baker."')
  await expect(job.getByRole('link', { name: 'Open the scene' })).toHaveAttribute('href', new RegExp(`scene=${ids.scene}`))
  const eyes = findings.filter({ hasText: 'eye color' })
  await expect(eyes).toContainText('"green" and as "brown"')
  await expectAccessible(page)

  await job.getByRole('button', { name: 'Mark intentional' }).click()
  await expect(page.getByText('Marked intentional')).toBeVisible()
  await eyes.getByRole('button', { name: 'Save for later' }).click()
  await expect(findings).toHaveCount(0)
  await page.getByRole('tab', { name: /Intentional/ }).click()
  await expect(findings).toHaveCount(1)

  // Nothing was edited: the scene text and the canon are exactly as before.
  const { data: scene } = await db.from('scenes').select('content_text').eq('id', ids.scene).single()
  expect(scene!.content_text).toBe('Dawn came over the harbor. Mara Vance worked as a baker. She smiled at Eli.')
  const { data: canon } = await db.from('canon_facts').select('value, status').eq('entity_id', ids.mara).eq('attribute', 'occupation').single()
  expect(canon).toEqual({ value: 'lighthouse keeper', status: 'approved' })

  // Checking again never repeats a finding already reviewed.
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByTestId('continuity-status')).toHaveText('Complete', { timeout: 60_000 })
  const { count } = await db.from('editorial_findings').select('id', { count: 'exact', head: true }).eq('book_id', ids.two)
  expect(count).toBe(2)
})
