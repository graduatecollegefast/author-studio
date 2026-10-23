import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import JSZip from 'jszip'

// Phase 5: Editorial Studio (offline test model, AI_MOCK=1), exports with download history,
// backup and restore, and account deletion.

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts)
const run = Date.now().toString(36)
const email = `phase5-${run}@example.test`
const password = `Phase5-${run}-pw!`
let userId = ''
let db: SupabaseClient
const ids: Record<string, string> = {}
const S1 = 'Mara Vance climbed the lighthouse stairs before dawn.'
const S2 = 'The sea was quiet.'
const P2 = 'Eli waited below with the bread.'
const content = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: `${S1} ` },
        { type: 'text', text: S2, marks: [{ type: 'italic' }] },
      ],
    },
    { type: 'horizontalRule' },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Eli waited ' },
        { type: 'text', text: 'below', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' with the bread.' },
      ],
    },
  ],
}
const contentText = `${S1} ${S2}\n\n\n\n${P2}`

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = data.user.id
  db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, opts)
  await db.auth.signInWithPassword({ email, password })
  ids.book = (
    await db.from('books').insert({ title: 'Salt Letters', pen_name: 'S. Phree', synopsis: 'Two sisters and a lighthouse.' }).select('id').single()
  ).data!.id
  ids.chapter = (await db.rpc('create_chapter', { p_book_id: ids.book, p_title: 'The Stairs' })).data as string
  ids.scene = (await db.from('scenes').select('id').eq('chapter_id', ids.chapter).single()).data!.id
  await db.rpc('save_scene', { p_scene_id: ids.scene, p_content: content, p_content_text: contentText, p_expected_revision: 1 })
  const ch2 = (await db.rpc('create_chapter', { p_book_id: ids.book, p_title: 'The Harbor' })).data as string
  const s2 = (await db.from('scenes').select('id').eq('chapter_id', ch2).single()).data!.id
  const t2 = 'Boats rocked against the harbor wall all night.'
  await db.rpc('save_scene', {
    p_scene_id: s2,
    p_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t2 }] }] },
    p_content_text: t2,
    p_expected_revision: 1,
  })
  ids.mara = (
    await db
      .from('characters')
      .insert({ full_name: 'Mara Vance', occupation: 'lighthouse keeper', personality: { trait: 'stubborn' } })
      .select('id')
      .single()
  ).data!.id
  await db.from('character_appearances').insert({ character_id: ids.mara, book_id: ids.book })
})

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId)
})

async function signIn(page: Page, e = email, p = password) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(e)
  await page.getByLabel('Password').fill(p)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function expectAccessible(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
}

/** Start an export or restore and wait until its new row is at the top of the history. */
async function startJob(page: Page, button: string) {
  const rows = page.getByTestId('export-row')
  const before = await rows.count()
  await page.getByRole('button', { name: button }).click()
  await expect(rows).toHaveCount(before + 1, { timeout: 15_000 })
}

const sceneNow = async () => (await db.from('scenes').select('content, content_text, revision').eq('id', ids.scene).single()).data!

test('editorial: findings show their passage; revisions apply only when approved and keep the original', async ({ page }) => {
  await signIn(page)
  await page.goto(`/editorial?book=${ids.book}&type=line`)
  await expect(page.getByRole('tab', { name: 'Line editing' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('review-estimate')).toContainText('Reviews 2 chapters')
  await expectAccessible(page)

  // Review just the first chapter.
  await page.getByLabel('Chosen chapters').check()
  await page.getByRole('checkbox', { name: '1. The Stairs' }).check()
  await expect(page.getByTestId('review-estimate')).toContainText('Reviews 1 chapter')
  await page.getByRole('button', { name: 'Start review' }).click()
  await expect(page.getByTestId('review-status')).toHaveText('Complete', { timeout: 30_000 })
  await expect(page.getByTestId('review-progress')).toContainText('1 left out because their passage could not be found')
  const cards = page.getByTestId('finding')
  await expect(cards).toHaveCount(2)
  await expect(page.getByText('Invented passage.')).toHaveCount(0)

  // Nothing changed yet.
  const before = await sceneNow()
  expect(before.content_text).toBe(contentText)

  const withRevision = cards.filter({ has: page.getByTestId('revision') })
  await expect(withRevision.getByTestId('finding-evidence')).toContainText(`"${S1}"`)
  await expect(withRevision.getByTestId('revision')).toContainText('Mara Vance climbed the lighthouse stairs before dawn, revised.')
  await expectAccessible(page)
  await withRevision.getByRole('button', { name: 'Approve revision' }).click()
  await expect(page.getByText('Revision applied.')).toBeVisible()
  await expect(cards).toHaveCount(1)

  const after = await sceneNow()
  expect(after.revision).toBe(before.revision + 1)
  expect(after.content_text).toBe(`Mara Vance climbed the lighthouse stairs before dawn, revised. ${S2}\n\n\n\n${P2}`)
  // Formatting elsewhere in the scene is kept.
  const nodes = (after.content as typeof content).content
  expect(nodes[0].content![1]).toEqual({ type: 'text', text: S2, marks: [{ type: 'italic' }] })
  expect(nodes[1]).toEqual({ type: 'horizontalRule' })
  expect(nodes[2]).toEqual(content.content[2])
  // The original is preserved as a named version.
  const versions = (await db.from('scene_versions').select('label, content_text').eq('scene_id', ids.scene).eq('kind', 'checkpoint')).data!
  expect(versions.find((v) => v.label === 'Before editorial revision')?.content_text).toBe(contentText)

  // The note without a revision can be accepted, dismissed or kept; nothing touches the text.
  await cards.first().getByRole('button', { name: 'Dismiss' }).click()
  await expect(cards).toHaveCount(0)
  await page.getByRole('tab', { name: /^Accepted/ }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Revision applied')

  // Copyediting: edit a revision before applying, and reject another.
  await page.getByRole('tab', { name: 'Copyediting' }).click()
  await page.getByRole('tab', { name: /^Open/ }).click()
  await page.getByLabel('The whole book').check()
  await page.getByRole('button', { name: 'Start review' }).click()
  await expect(page.getByTestId('review-status')).toHaveText('Complete', { timeout: 30_000 })
  const harbor = cards.filter({ hasText: 'The Harbor' }).filter({ has: page.getByTestId('revision') })
  await harbor.getByRole('button', { name: 'Edit' }).click()
  await harbor.getByLabel('Your version').fill('Boats knocked against the harbor wall all night.')
  await harbor.getByRole('button', { name: 'Apply my version' }).click()
  await expect(page.getByText('Revision applied.')).toBeVisible()
  const harborText = (
    await db
      .from('scenes')
      .select('content_text')
      .eq('chapter_id', (await db.from('chapters').select('id').eq('title', 'The Harbor').single()).data!.id)
      .single()
  ).data!
  expect(harborText.content_text).toBe('Boats knocked against the harbor wall all night.')
  const stairs = cards.filter({ hasText: 'The Stairs' }).filter({ has: page.getByTestId('revision') })
  const revBefore = (await sceneNow()).revision
  await stairs.getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByText('Revision rejected.')).toBeVisible()
  expect((await sceneNow()).revision).toBe(revBefore)
  const statuses = (await db.from('revision_proposals').select('status').eq('book_id', ids.book)).data!.map((r) => r.status).sort()
  expect(statuses).toEqual(['accepted', 'edited', 'rejected'])
})

test('exports: each format keeps chapter order and formatting; history lets you download again', async ({ page }) => {
  await signIn(page)
  await page.goto('/exports')
  await expect(page.getByRole('heading', { name: 'Exports', level: 1 })).toBeVisible()
  await expectAccessible(page)

  for (const [label, ext] of [
    ['Word (DOCX)', 'docx'],
    ['Markdown', 'md'],
    ['EPUB e-book', 'epub'],
    ['PDF', 'pdf'],
    ['Plain text (TXT)', 'txt'],
  ] as const) {
    await page.getByLabel('Format').selectOption({ label })
    await startJob(page, 'Create export')
    await expect(page.getByTestId('export-row').first()).toContainText(label)
    await expect(page.getByTestId('export-status').first()).toHaveText('Ready', { timeout: 30_000 })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-row').first().getByRole('button', { name: 'Download' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`salt-letters.${ext}`)
  }
  const rows = (await db.from('exports').select('format, storage_path').eq('export_type', 'manuscript').order('created_at')).data!
  const file = async (format: string) => (await db.storage.from('exports').download(rows.find((r) => r.format === format)!.storage_path!)).data!
  const md = await (await file('md')).text()
  expect(md.indexOf('## The Stairs')).toBeLessThan(md.indexOf('## The Harbor'))
  expect(md).toContain('*The sea was quiet.*')
  expect(md).toContain('Eli waited **below** with the bread.')
  expect(md).toContain('* * *')
  const docx = await JSZip.loadAsync(await (await file('docx')).arrayBuffer())
  expect(await docx.file('word/document.xml')!.async('string')).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">below</w:t>')

  // Selected chapters, Character Bible and outline.
  await page.getByLabel('What to export').selectOption({ label: 'Selected chapters' })
  await page.getByRole('checkbox', { name: '2. The Harbor' }).check()
  await page.getByLabel('Format').selectOption({ label: 'Markdown' })
  await startJob(page, 'Create export')
  await expect(page.getByTestId('export-status').first()).toHaveText('Ready', { timeout: 30_000 })
  await page.getByLabel('What to export').selectOption({ label: 'Character Bible' })
  await page.getByLabel('Format').selectOption({ label: 'Markdown' })
  await startJob(page, 'Create export')
  await expect(page.getByTestId('export-status').first()).toHaveText('Ready', { timeout: 30_000 })
  const latest = async (type: string) => {
    const r = (await db.from('exports').select('storage_path').eq('export_type', type).order('created_at', { ascending: false }).limit(1).single())
      .data!
    return (await db.storage.from('exports').download(r.storage_path!)).data!.text()
  }
  const sel = await latest('chapters')
  expect(sel).toContain('## The Harbor')
  expect(sel).not.toContain('The Stairs')
  const bible = await latest('character_bible')
  expect(bible).toContain('## Mara Vance')
  expect(bible).toContain('**Occupation:** lighthouse keeper')
  expect(bible).toContain('**Trait:** stubborn')

  // A book with nothing to export fails with a plain reason instead of an empty file.
  await page.getByLabel('What to export').selectOption({ label: 'Story timeline' })
  await startJob(page, 'Create export')
  await expect(page.getByTestId('export-status').first()).toHaveText('Failed', { timeout: 30_000 })
  await expect(page.getByTestId('export-row').first()).toContainText('This book has no timeline events yet.')

  // Removing from history deletes the stored file only.
  const count = await page.getByTestId('export-row').count()
  await page
    .getByTestId('export-row')
    .first()
    .getByRole('button', { name: /Remove .* from history/ })
    .click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByTestId('export-row')).toHaveCount(count - 1)
  expect((await db.from('books').select('id').eq('id', ids.book)).data).toHaveLength(1)
})

test('backup and restore: a full copy comes back with its structure, versions and files', async ({ page }) => {
  // A stored manuscript file and cover, so the backup carries linked assets.
  await db.rpc('create_scene_checkpoint', { p_scene_id: ids.scene, p_label: 'Backup test' })
  const mPath = `${userId}/${ids.book}/${crypto.randomUUID()}-salt.txt`
  await db.storage.from('manuscripts').upload(mPath, new Blob(['Original upload'], { type: 'text/plain' }), { contentType: 'text/plain' })
  const mf = (
    await db
      .from('manuscript_files')
      .insert({ book_id: ids.book, storage_path: mPath, original_name: 'salt.txt', file_ext: 'txt', mime_type: 'text/plain', size_bytes: 15 })
      .select('id')
      .single()
  ).data!
  await db.from('books').update({ original_manuscript_file_id: mf.id }).eq('id', ids.book)

  await signIn(page)
  await page.goto('/exports')
  await page.getByLabel('What to export').selectOption({ label: 'Complete project backup' })
  await startJob(page, 'Create backup')
  await expect(page.getByTestId('export-status').first()).toHaveText('Ready', { timeout: 60_000 })
  const row = (await db.from('exports').select('storage_path, result').eq('export_type', 'backup').single()).data!
  const zipBytes = Buffer.from(await (await db.storage.from('exports').download(row.storage_path!)).data!.arrayBuffer())
  const zip = await JSZip.loadAsync(zipBytes)
  const json = JSON.parse(await zip.file('backup.json')!.async('string'))
  expect(json.format).toBe('author-studio-backup')
  expect(json.tables.scenes.length).toBe(2)
  expect(json.tables.scene_versions.length).toBeGreaterThan(0)
  expect(zip.file(`files/manuscripts/${mPath}`)).toBeTruthy()

  await page.getByLabel('Backup file').setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: zipBytes })
  await startJob(page, 'Restore backup')
  await expect(page.getByTestId('export-status').first()).toHaveText('Restored', { timeout: 60_000 })
  await expect(page.getByTestId('restore-summary')).toContainText('Restored 1 book, 2 chapters, 2 scenes, 1 character and 1 file.')

  const books = (await db.from('books').select('id, title, original_manuscript_file_id').order('created_at')).data!
  expect(books.map((b) => b.title)).toEqual(['Salt Letters', 'Salt Letters (restored)'])
  const copy = books[1]
  expect(copy.id).not.toBe(ids.book)
  const chapters = (await db.from('chapters').select('title, position, scenes(content_text, content)').eq('book_id', copy.id).order('position')).data!
  expect(chapters.map((c) => c.title)).toEqual(['The Stairs', 'The Harbor'])
  const original = await sceneNow()
  expect(chapters[0].scenes[0].content_text).toBe(original.content_text)
  expect(chapters[0].scenes[0].content).toEqual(original.content)
  // Linked records point at the copies, and files were restored under the new ids.
  const file = (await db.from('manuscript_files').select('id, storage_path').eq('id', copy.original_manuscript_file_id!).single()).data!
  expect(file.storage_path.startsWith(`${userId}/${copy.id}/`)).toBe(true)
  expect(await (await db.storage.from('manuscripts').download(file.storage_path)).data!.text()).toBe('Original upload')
  const appearances = (await db.from('character_appearances').select('character_id').eq('book_id', copy.id)).data!
  expect(appearances).toHaveLength(1)
  expect(appearances[0].character_id).not.toBe(ids.mara)
  // The original is untouched, and the uploaded backup is not kept after restoring.
  expect((await db.from('chapters').select('id').eq('book_id', ids.book)).data).toHaveLength(2)
  expect((await db.storage.from('exports').list(`${userId}/imports`)).data ?? []).toHaveLength(0)

  // A file that is not a backup is refused and changes nothing.
  await page
    .getByLabel('Backup file')
    .setInputFiles({
      name: 'notes.zip',
      mimeType: 'application/zip',
      buffer: await new JSZip().file('a.txt', 'hi').generateAsync({ type: 'nodebuffer' }),
    })
  await startJob(page, 'Restore backup')
  await expect(page.getByTestId('export-status').first()).toHaveText('Failed', { timeout: 30_000 })
  await expect(page.getByTestId('export-row').first()).toContainText('not an Author Studio backup')
  expect((await db.from('books').select('id')).data).toHaveLength(2)
})

test('account deletion needs typed confirmation, removes the account and its files, and signs out', async ({ page }) => {
  const e = `phase5-del-${run}@example.test`
  const p = `Phase5-del-${run}-pw!`
  const { data } = await admin.auth.admin.createUser({ email: e, password: p, email_confirm: true })
  const id = data.user!.id
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, opts)
  await c.auth.signInWithPassword({ email: e, password: p })
  const book = (await c.from('books').insert({ title: 'Goodbye' }).select('id').single()).data!
  await c.storage.from('manuscripts').upload(`${id}/${book.id}/a.txt`, new Blob(['x'], { type: 'text/plain' }), { contentType: 'text/plain' })

  await signIn(page, e, p)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  const confirm = page.getByRole('button', { name: 'Delete account permanently' })
  await expect(confirm).toBeDisabled()
  await page.getByLabel(/Type DELETE MY ACCOUNT to confirm/).fill('DELETE MY ACCOUNT')
  await confirm.click()
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
  const gone = await admin.auth.admin.getUserById(id)
  expect(gone.data.user ?? null).toBeNull()
  expect((await admin.from('books').select('id').eq('owner_id', id)).data).toEqual([])
  expect((await admin.storage.from('manuscripts').list(`${id}/${book.id}`)).data ?? []).toEqual([])
})
