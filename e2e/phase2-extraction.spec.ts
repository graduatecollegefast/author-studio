import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { makeBlankPdf, makeConvertedDocx, makeDocx, makeEpub } from '../tests/functions/fixtures'

// Phase 2 (first slice): upload a finished manuscript, read its text, preview
// detected chapters, import them as editable chapters, and keep searchable chunks.

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const run = Date.now().toString(36)
const email = `extract-${run}@example.test`
const password = `Extract-${run}-pw!`
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

async function newBook(page: Page, title: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/library?new=1')
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Create book' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  return page.url()
}

test('upload a Word manuscript, read it, and import chapters', async ({ page }) => {
  const bookUrl = await newBook(page, 'Velvet Ledger')
  const paragraph = 'The ledger was bound in green velvet, worn at the corners where her mother had held it for thirty years.'
  const docx = await makeDocx([
    { style: 'Title', runs: [{ text: 'Velvet Ledger' }] },
    { style: 'Heading1', runs: [{ text: 'Chapter 1: Accounts' }] },
    { runs: [{ text: paragraph }] },
    { runs: [{ text: 'She opened it ' }, { text: 'slowly', i: true }, { text: '.' }] },
    { runs: [{ text: '* * *' }] },
    { runs: [{ text: 'At the bank, nobody remembered the Vances.' }] },
    { style: 'Heading1', runs: [{ text: 'Chapter 2: Debts' }] },
    { runs: [{ text: 'Her mother kept every receipt.' }] },
    { style: 'Heading1', runs: [{ text: 'Chapter 3: Interest' }] },
    { runs: [{ text: 'The interest had been compounding for decades.' }] },
  ])

  await page.getByRole('tab', { name: 'Manuscript files' }).click()
  await page.getByTestId('manuscript-input').setInputFiles({
    name: 'velvet-ledger.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(docx),
  })
  const row = page.getByRole('row', { name: /velvet-ledger\.docx/ })
  await expect(row.getByText('Validated')).toBeVisible()
  await expect(row.getByTestId('extraction-status')).toHaveText('Completed', { timeout: 30_000 })

  // Searchable chunks with source offsets exist for later analysis.
  const { data: file } = await admin.from('manuscript_files').select('id').eq('owner_id', userId).eq('original_name', 'velvet-ledger.docx').single()
  const { data: chunks } = await admin.from('document_chunks').select('chunk_index, chapter_label, char_start, char_end, content').eq('manuscript_file_id', file!.id).order('chunk_index')
  expect(chunks!.length).toBeGreaterThan(0)
  expect(chunks![0].chapter_label).toBe('Chapter 1: Accounts')
  expect(chunks![0].content).toContain(paragraph)

  // Preview detected chapters, skip one, import the rest.
  await row.getByRole('button', { name: 'Preview and import' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import into chapters' })
  const list = dialog.getByTestId('import-chapters')
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await expect(list).toContainText('Chapter 1: Accounts')
  await expect(list).toContainText('2 scenes')
  await list.getByRole('checkbox').nth(2).uncheck()
  await dialog.getByRole('button', { name: 'Import 2 chapters' }).click()

  await expect(page).toHaveURL(/tab=chapters/)
  await expect(page.getByRole('link', { name: 'Chapter 1: Accounts' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Chapter 2: Debts' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Chapter 3: Interest' })).toHaveCount(0)

  // The imported text is editable in the studio, with italics kept and scenes split.
  await page.getByRole('link', { name: 'Chapter 1: Accounts' }).click()
  const editor = page.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await expect(editor).toContainText(paragraph)
  await expect(editor.locator('em')).toHaveText('slowly')
  await expect(page.getByRole('navigation', { name: 'Chapters and scenes' }).getByRole('button', { name: /^Scene 2/ })).toBeVisible()

  // Importing is not counted as words written today.
  const { data: stats } = await admin.from('writing_daily_stats').select('words_added').eq('owner_id', userId)
  expect((stats ?? []).reduce((n, s) => n + s.words_added, 0)).toBe(0)

  // The file shows it was imported.
  await page.goto(`${bookUrl}?tab=files`)
  await expect(page.getByRole('row', { name: /velvet-ledger\.docx/ }).getByText(/Imported/)).toBeVisible()
})

test('EPUB extraction and scanned PDF detection', async ({ page }) => {
  await newBook(page, 'Harbor Lights')
  await page.getByRole('tab', { name: 'Manuscript files' }).click()

  const epub = await makeEpub('Harbor Lights', [
    { heading: 'Prologue', paragraphs: ['Rain on the pier, again.'] },
    { heading: 'Chapter One', paragraphs: ['Morning came grey over the water.'] },
  ])
  await page.getByTestId('manuscript-input').setInputFiles({ name: 'harbor.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(epub) })
  await expect(page.getByRole('row', { name: /harbor\.epub/ }).getByTestId('extraction-status')).toHaveText('Completed', { timeout: 30_000 })

  const scanned = await makeBlankPdf(4)
  await page.getByTestId('manuscript-input').setInputFiles({ name: 'scanned.pdf', mimeType: 'application/pdf', buffer: Buffer.from(scanned) })
  const pdfRow = page.getByRole('row', { name: /scanned\.pdf/ })
  await expect(pdfRow.getByTestId('extraction-status')).toHaveText('Needs OCR', { timeout: 30_000 })
  await expect(pdfRow).toContainText('needs OCR')
  await expect(pdfRow.getByRole('button', { name: 'Preview and import' })).toHaveCount(0)

  await page.getByRole('row', { name: /harbor\.epub/ }).getByRole('button', { name: 'Preview and import' }).click()
  const list = page.getByRole('dialog').getByTestId('import-chapters')
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list).toContainText('Prologue')

  // The import dialog and the file list (including the OCR warning) meet WCAG AA.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
})

test('a print-layout Word file imports clean, and re-importing replaces the old chapters', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/library?new=1')
  const d = page.getByRole('dialog')
  await d.getByLabel('Title', { exact: true }).fill('Soror Love')
  await d.getByLabel('Pen name').fill('Shaun J. Phree')
  await d.getByRole('button', { name: 'Create book' }).click()
  await expect(page.getByRole('heading', { name: 'Soror Love' })).toBeVisible()
  const bookUrl = page.url()

  await page.getByRole('tab', { name: 'Manuscript files' }).click()
  await page.getByTestId('manuscript-input').setInputFiles({
    name: 'soror-love.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(await makeConvertedDocx()),
  })
  const row = page.getByRole('row', { name: /soror-love\.docx/ })
  await expect(row.getByTestId('extraction-status')).toHaveText('Completed', { timeout: 30_000 })
  await row.getByRole('button', { name: 'Preview and import' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import into chapters' })
  await expect(dialog.getByTestId('cleanup-summary')).toContainText('removed 7 running headers and 1 page numbers')
  await expect(dialog.getByTestId('import-chapters')).not.toContainText('Classified People')
  await dialog.getByRole('button', { name: 'Import 5 chapters' }).click()
  await expect(page.getByRole('link', { name: 'Chapter 5', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Chapter 1', exact: true }).click()
  const editor = page.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await expect(editor).toContainText('People were trying to find their way to their rooms.')
  await expect(editor).toContainText('she continued to swipe through her phone. Lauren moved swiftly through the room.')
  await expect(editor).not.toContainText('SHAUN J. PHREE')
  await expect(editor).not.toContainText('SOROR LOVE')

  // Edit chapter 2 so it must survive a re-import.
  await page.goto(`${bookUrl}?tab=chapters`)
  await page.getByRole('link', { name: 'Chapter 2', exact: true }).click()
  const ed2 = page.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await ed2.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' My own new sentence.')
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })

  // Read again and re-import with replace.
  await page.goto(`${bookUrl}?tab=files`)
  const row2 = page.getByRole('row', { name: /soror-love\.docx/ })
  await row2.getByRole('button', { name: 'Import again' }).click()
  const dialog2 = page.getByRole('dialog', { name: 'Import into chapters' })
  await expect(dialog2.getByText('Replace the 5 chapters imported from this file earlier')).toBeVisible()
  await expect(dialog2.getByText(/1 of them has been edited since, so it stays/)).toBeVisible()
  await dialog2.getByRole('button', { name: 'Import 5 chapters' }).click()

  const links = page.getByRole('list').getByRole('link', { name: /^Chapter \d$/ })
  await expect(links).toHaveText(['Chapter 2', 'Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5'])
  await page.getByRole('link', { name: 'Chapter 2', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: /Manuscript: Scene 1/ })).toContainText('My own new sentence.')
})
