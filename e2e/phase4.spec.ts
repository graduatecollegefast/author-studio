import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'

// Phase 4: AI writing partner in the studio, writing modes, questions, style profiles,
// Creative Partner, and the Ideas Vault, all with the offline test model (AI_MOCK=1).

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts)
const run = Date.now().toString(36)
const email = `phase4-${run}@example.test`
const password = `Phase4-${run}-pw!`
let userId = ''
let db: SupabaseClient
const ids: Record<string, string> = {}
const doc = (...paras: string[]) => ({ type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) })
const P1 = 'Mara Vance worked as a lighthouse keeper on the northern rock.'
const P2 = 'Eli brought bread every Sunday and never stayed long.'

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = data.user.id
  db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, opts)
  await db.auth.signInWithPassword({ email, password })
  ids.book = (await db.from('books').insert({ title: 'Salt Letters', pen_name: 'S. Phree' }).select('id').single()).data!.id
  ids.partnerBook = (await db.from('books').insert({ title: 'Partner Book' }).select('id').single()).data!.id
  const ch = (await db.rpc('create_chapter', { p_book_id: ids.book, p_title: 'Chapter 1' })).data as string
  ids.chapter = ch
  ids.scene = (await db.from('scenes').select('id').eq('chapter_id', ch).single()).data!.id
  await db.rpc('save_scene', { p_scene_id: ids.scene, p_content: doc(P1, P2), p_content_text: `${P1}\n\n${P2}`, p_expected_revision: 1 })
  // A longer chapter so there is enough writing to learn a style from.
  const long = Array.from({ length: 60 }, () => 'The lamp turned and the sea answered in long grey breaths.').join(' ')
  const ch2 = (await db.rpc('create_chapter', { p_book_id: ids.book, p_title: 'Chapter 2' })).data as string
  const s2 = (await db.from('scenes').select('id').eq('chapter_id', ch2).single()).data!.id
  await db.rpc('save_scene', { p_scene_id: s2, p_content: doc(long), p_content_text: long, p_expected_revision: 1 })
  ids.mara = (await db.from('characters').insert({ full_name: 'Mara Vance', occupation: 'lighthouse keeper' }).select('id').single()).data!.id
  await db.from('character_appearances').insert({ character_id: ids.mara, book_id: ids.book })
  await db
    .from('canon_facts')
    .insert({
      book_id: ids.book,
      entity_type: 'character',
      entity_id: ids.mara,
      entity_label: 'Mara Vance',
      attribute: 'occupation',
      value: 'lighthouse keeper',
      statement_type: 'narrator',
      status: 'approved',
      category: 'character',
    })
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

async function openAI(page: Page) {
  await page.goto(`/books/${ids.book}/write?scene=${ids.scene}`)
  await expect(page.getByRole('textbox', { name: /Manuscript:/ })).toBeVisible()
  const show = page.getByRole('button', { name: 'Show side panel' })
  if (await show.count()) await show.click()
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  return page.getByTestId('ai-panel')
}

test('studio AI: proposals for selected text, continue, checks; nothing changes until accepted', async ({ page }) => {
  await signIn(page)
  const panel = await openAI(page)
  const editor = page.getByRole('textbox', { name: /Manuscript:/ })
  await expect(editor).toContainText(P1)
  await expectAccessible(page)

  // Assistant mode leaves drafting scenes to the author.
  await expect(panel.getByRole('button', { name: 'Draft Scene' })).toHaveCount(0)

  // A selection command needs a selection.
  await panel.getByRole('button', { name: 'Rewrite Selection' }).click()
  await expect(page.getByText('Select the passage in the manuscript first.')).toBeVisible()

  // Rewrite the first paragraph: a proposal appears; the text is unchanged until accepted.
  await editor.locator('p').first().click({ clickCount: 3 })
  await panel.getByRole('button', { name: 'Rewrite Selection' }).click()
  const proposal = panel.getByTestId('proposal').first()
  await expect(proposal.getByTestId('proposal-text')).toContainText(`Mock rewrite of: ${P1.slice(0, 40)}`, { timeout: 20_000 })
  await expect(editor).toContainText(P1)
  await proposal.getByRole('button', { name: 'Accept and replace' }).click()
  await expect(editor).toContainText('Mock rewrite of:')
  await expect(editor).not.toContainText('on the northern rock.')
  await expect(editor).toContainText(P2)

  // The replaced text is recoverable from History.
  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.getByTestId('version-list')).toContainText('Before AI: Rewrite Selection')
  await page.getByRole('tab', { name: 'AI', exact: true }).click()

  // Continue writing, edited before inserting.
  await panel.getByRole('button', { name: 'Continue Writing' }).click()
  const cont = panel.getByTestId('proposal').first()
  await expect(cont.getByTestId('proposal-text')).toContainText('Mock continuation', { timeout: 20_000 })
  await cont.getByRole('button', { name: 'Edit before inserting' }).click()
  await cont.getByLabel('Edit before inserting').fill('The fog rolled in, and *she* waited.')
  await cont.getByRole('button', { name: 'Insert edited text' }).click()
  await expect(editor).toContainText('The fog rolled in, and she waited.')
  await expect(editor.locator('em').filter({ hasText: 'she' })).toHaveCount(1)
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })

  // A check gives notes, not text to insert. Reject removes a proposal.
  await panel.getByRole('button', { name: 'Check POV' }).click()
  await expect(panel.getByTestId('proposal-notes').first()).toContainText('Mock notes for: Check the point of view', { timeout: 20_000 })
  await panel.getByTestId('proposal').first().getByRole('button', { name: 'Close' }).click()
  await expect(panel.getByTestId('proposal-notes')).toHaveCount(0)

  // A declined request explains the limit and is never rerouted.
  await panel.getByLabel(/Direction/).fill('MOCK_DECLINE')
  await panel.getByRole('button', { name: 'Continue Writing' }).click()
  await expect(panel.getByTestId('proposal').first()).toContainText('declined this request under its content policy', { timeout: 20_000 })
  await expect(panel.getByTestId('proposal').first()).toContainText('not sent to any other provider')
  await panel.getByTestId('proposal').first().getByRole('button', { name: 'Dismiss' }).click()
  await panel.getByLabel(/Direction/).fill('')

  // Story Bible references for the scene.
  await page.getByRole('tab', { name: 'Bible' }).click()
  await expect(page.getByTestId('bible-refs')).toContainText('Mara Vance')
  await expect(page.getByTestId('bible-refs')).toContainText('Occupation: lighthouse keeper')
})

test('co-writer mode drafts a new scene from direction; questions are asked once and can be decided', async ({ page }) => {
  await signIn(page)
  const panel = await openAI(page)
  await panel.getByLabel('AI mode').selectOption('co_writer')
  await expect(panel.getByRole('button', { name: 'Draft Scene' })).toBeVisible()
  await panel.getByRole('button', { name: 'Draft Scene' }).click()
  await expect(page.getByText('Write a direction first')).toBeVisible()
  await panel.getByLabel(/Direction/).fill('Mara finds a letter in the lamp room')
  await panel.getByRole('button', { name: 'Draft Scene' }).click()
  const p = panel.getByTestId('proposal').first()
  await expect(p.getByTestId('proposal-text')).toContainText('following: Mara finds a letter in the lamp room', { timeout: 20_000 })
  await p.getByRole('button', { name: 'Add as new scene' }).click()
  await expect(page.getByText('New scene added after this one')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Manuscript: New scene' })).toContainText('Mara finds a letter in the lamp room')
  const { data: scenes } = await db.from('scenes').select('title, content_text').eq('chapter_id', ids.chapter).order('position')
  expect(scenes!.map((s) => s.title)).toEqual(['Scene 1', 'New scene'])

  // Questions: asked once, stored with the book.
  await page.goto(`/books/${ids.book}/write?scene=${ids.scene}`)
  await panel.getByRole('button', { name: 'Ask Clarification Questions' }).click()
  await expect(panel.getByTestId('proposal-notes').first()).toContainText('2 new questions were added', { timeout: 20_000 })
  await panel.getByTestId('proposal').first().getByRole('button', { name: 'Close' }).click()
  await panel.getByRole('button', { name: 'Ask Clarification Questions' }).click()
  await expect(panel.getByTestId('proposal-notes').first()).toContainText('No new questions', { timeout: 20_000 })
  await panel.getByRole('link', { name: /2 questions waiting for you/ }).click()

  const list = page.getByTestId('questions')
  await expect(list.getByTestId('question')).toHaveCount(2)
  const want = list.getByTestId('question').filter({ hasText: 'What does Mara want most' })
  await want.getByRole('radio', { name: 'To leave the island' }).check()
  await want.getByRole('button', { name: 'Answer' }).click()
  await expect(page.getByText('Answered', { exact: true })).toBeVisible()
  const secret = list.getByTestId('question').filter({ hasText: 'secret from Eli' })
  await secret.getByRole('button', { name: 'Let AI decide' }).click()
  await expect(page.getByText('The AI made a provisional decision')).toBeVisible()
  await page.getByRole('tab', { name: /Answered and decided/ }).click()
  const decided = list.getByTestId('question').filter({ hasText: 'secret from Eli' })
  await expect(decided).toContainText('Provisional AI decision')
  await expect(decided).toContainText('AI chose: To protect Eli')
  await expectAccessible(page)
  // Provisional decisions are not canon until the author says so.
  const before = await db.from('canon_facts').select('id', { count: 'exact', head: true }).eq('attribute', 'decision')
  expect(before.count).toBe(0)
  await decided.getByRole('button', { name: 'Confirm decision' }).click()
  await expect(decided).not.toContainText('Provisional AI decision')
  await decided.getByRole('button', { name: 'Add to canon' }).click()
  await expect(page.getByText('Added to canon')).toBeVisible()
  const after = await db.from('canon_facts').select('status, statement_type').eq('attribute', 'decision').single()
  expect(after.data).toEqual({ status: 'approved', statement_type: 'author_confirmed' })
})

test('style profiles: analyze my voice, edit preferences, compare, use for drafting', async ({ page }) => {
  await signIn(page)
  await page.goto('/partner?tab=style')
  for (const n of ['My voice', 'Pen name voice']) {
    await page.getByRole('button', { name: 'New style profile' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Name').fill(n)
    if (n === 'Pen name voice') {
      await d.getByLabel('Learns from').selectOption('pen_name')
      await d.getByLabel('Pen name', { exact: true }).selectOption('S. Phree')
    }
    await d.getByRole('button', { name: 'Create' }).click()
    await expect(d).toBeHidden()
  }
  const card = page
    .getByTestId('style-profiles')
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'My voice', exact: true }) })
  await card.getByRole('button', { name: 'Analyze my voice' }).click()
  await expect(page.getByText('Style profile updated from your writing')).toBeVisible({ timeout: 30_000 })
  await expect(card.getByTestId('style-summary')).toContainText('Short, rhythmic sentences')
  await expect(card.getByTestId('style-summary')).toContainText('[quote removed]')
  await expect(card).toContainText('learned from')

  await card.getByRole('button', { name: 'Edit style preferences' }).click()
  await page.getByRole('dialog').getByLabel('Your preferences').fill('Never use semicolons.')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(card).toContainText('Your preferences: Never use semicolons.')

  await card.getByLabel('Use this style for drafting in').selectOption({ label: 'Salt Letters' })
  await card.getByRole('button', { name: 'Use this style for drafting' }).click()
  await expect(card).toContainText('Used by Salt Letters')

  await page.getByLabel('First profile').selectOption({ label: 'My voice' })
  await page.getByLabel('Second profile').selectOption({ label: 'Pen name voice' })
  await expect(page.getByTestId('style-compare')).toContainText('Close third person.')
  await expectAccessible(page)
})

test('ideas vault: capture, suggest connections, link, and turn into a character', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Ideas Vault' }).click()
  await page.getByRole('button', { name: 'New idea' }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel('Title').fill('The keeper’s daughter')
  await d.getByLabel('Description').fill('A girl who reads the lamp signals.')
  await d.getByLabel('Category').selectOption('character_idea')
  await d.getByLabel('Tags').fill('Lighthouse, kids')
  await d.getByRole('button', { name: 'Save idea' }).click()
  const idea = page.getByTestId('idea').filter({ hasText: 'The keeper’s daughter' })
  await expect(idea).toContainText('Character idea')
  await expect(idea).toContainText('#lighthouse')

  await idea.getByRole('button', { name: 'Suggest connections' }).click()
  const links = idea.getByTestId('idea-links')
  await expect(links.getByRole('listitem')).toHaveCount(1, { timeout: 20_000 }) // the invented reference is dropped
  await links.getByRole('button', { name: 'Link' }).click()
  await expect(idea).toContainText(/Book: (Salt Letters|Partner Book)/)
  await expectAccessible(page)

  await idea.getByRole('button', { name: 'Turn into' }).click()
  await page.getByRole('menuitem', { name: 'A character' }).click()
  await expect(page.getByRole('heading', { name: 'The keeper’s daughter' })).toBeVisible()
  await page.goto('/ideas')
  await expect(page.getByTestId('idea').filter({ hasText: 'The keeper’s daughter' })).toContainText('Became a character')

  await page.getByLabel('Status').selectOption('new')
  await expect(page.getByTestId('idea')).toHaveCount(0)
})

test('creative partner: questions, editable plan, approval, scene-by-scene draft, redraft keeps history', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page)
  await page.goto(`/partner?book=${ids.partnerBook}`)
  // A long, pasted concept (larger than the old 16 KB request limit) must still start the job.
  await page
    .getByLabel('Book concept')
    .fill('Two estranged sisters inherit a lighthouse. ' + 'They argue about who keeps the light burning. '.repeat(400))
  await page.getByLabel('Chapters').fill('2')
  await page.getByLabel('Scenes per chapter').fill('1')
  await page.getByLabel('Words per scene').fill('300')
  await page.getByRole('button', { name: 'Start with this concept' }).click()
  await expect(page.getByTestId('partner-stage')).toHaveText('Waiting for your answers', { timeout: 30_000 })
  await expect(page.getByText('Mock analysis of the concept.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Answer 1 more question to continue/ })).toBeDisabled()
  await page.getByTestId('question').getByRole('button', { name: 'Let AI decide' }).click()
  await page.getByRole('button', { name: 'Continue to the plan' }).click()
  await expect(page.getByTestId('partner-stage')).toHaveText('Waiting for you to approve the plan', { timeout: 30_000 })
  await expect(page.getByTestId('scene-plan')).toHaveCount(2)
  await expect(page.getByTestId('partner-status')).toContainText('drafting all scenes is estimated at')

  // Edit a scene plan before approving.
  await page.getByLabel('Scene 1 title').first().fill('The reading of the will')
  await page.getByLabel('Scene 1 plan').first().click()
  await expectAccessible(page)
  await page.getByRole('button', { name: 'Approve plan and start drafting' }).click()
  await expect(page.getByTestId('partner-stage')).toHaveText('Draft complete', { timeout: 60_000 })
  await expect(page.getByTestId('partner-status')).toContainText('2 of 2 scenes drafted')

  const { data: chapters } = await db.from('chapters').select('title, scenes(title, content_text)').eq('book_id', ids.partnerBook).order('position')
  expect(chapters!.map((c) => c.title)).toEqual(['Mock Chapter 1', 'Mock Chapter 2'])
  expect((chapters![0].scenes as Array<{ title: string; content_text: string }>)[0]).toEqual({
    title: 'The reading of the will',
    content_text: 'Mock scene: The reading of the will.\n\nThe tide turned slowly against the pier.',
  })

  // Redraft one scene: the earlier draft is kept in its history.
  await page.getByTestId('scene-plan').first().getByRole('button', { name: 'Mark for redraft' }).click()
  await page.getByRole('button', { name: 'Redraft marked scenes' }).click()
  await expect(page.getByRole('button', { name: 'Redraft marked scenes' })).toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByTestId('partner-stage')).toHaveText('Draft complete')
  const { data: plan } = await db
    .from('story_plans')
    .select('scene_id')
    .eq('book_id', ids.partnerBook)
    .eq('kind', 'scene')
    .eq('chapter_index', 0)
    .single()
  await expect
    .poll(async () => ((await db.from('scene_versions').select('label').eq('scene_id', plan!.scene_id)).data ?? []).map((v) => v.label), {
      timeout: 30_000,
    })
    .toContain('Before Creative Partner redraft')
})
