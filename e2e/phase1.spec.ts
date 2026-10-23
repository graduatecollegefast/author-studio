import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Phase 1 acceptance: log in, create a book, upload a manuscript, open a chapter,
// edit text, refresh the browser, and find the work saved correctly.

const url = process.env.SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const run = Date.now().toString(36)
const email = `e2e-${run}@example.test`
const password = `E2e-${run}-password!`
let userId = ''

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = data.user.id
})

test.afterAll(async () => {
  if (!userId) return
  // Clean up stored files, then the user (database rows cascade).
  const { data: folders } = await admin.storage.from('manuscripts').list(userId)
  for (const f of folders ?? []) {
    const { data: files } = await admin.storage.from('manuscripts').list(`${userId}/${f.name}`)
    if (files?.length) await admin.storage.from('manuscripts').remove(files.map((x) => `${userId}/${f.name}/${x.name}`))
  }
  await admin.auth.admin.deleteUser(userId)
})

async function signIn(page: Page) {
  await page.goto('/library')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/library/)
}

test('Phase 1 acceptance flow', async ({ page }) => {
  // Protected routes redirect to login, and bad credentials are refused.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('incorrect')

  await signIn(page)
  await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible()
  await expect(page.getByText('Your library is empty')).toBeVisible()

  // Create a book
  await page.getByRole('button', { name: 'New book' }).click()
  const dialog = page.getByRole('dialog', { name: 'New book' })
  await dialog.getByLabel('Title', { exact: true }).fill('The Salt Letters')
  await dialog.getByLabel('Pen name').fill('M. Rivers')
  await dialog.getByLabel('Target word count').fill('85000')
  await dialog.getByLabel('Content rating').selectOption('mature')
  await dialog.getByRole('button', { name: 'Create book' }).click()
  await expect(page).toHaveURL(/\/books\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: 'The Salt Letters' })).toBeVisible()
  const bookUrl = page.url()

  // Upload a manuscript (validated) and a mislabeled file (rejected by the server check)
  await page.getByRole('tab', { name: 'Manuscript files' }).click()
  await page.getByTestId('manuscript-input').setInputFiles({
    name: 'salt-letters-draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Chapter One\n\nThe letters arrived wet with sea salt.\n'),
  })
  const row = page.getByRole('row', { name: /salt-letters-draft\.txt/ })
  await expect(row).toBeVisible()
  await expect(row.getByText('Validated')).toBeVisible()
  await expect(row.getByText('Current')).toBeVisible()

  await page.getByTestId('manuscript-input').setInputFiles({
    name: 'not-really.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('This is plain text pretending to be a PDF.'),
  })
  const bad = page.getByRole('row', { name: /not-really\.pdf/ })
  await expect(bad.getByText('Rejected')).toBeVisible()
  await expect(bad.getByText('does not look like a PDF')).toBeVisible()

  // Unsupported types never upload
  await page.getByTestId('manuscript-input').setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') })
  await expect(page.getByText('Unsupported file type').first()).toBeVisible()

  // Add a chapter and open it
  await page.getByRole('tab', { name: 'Chapters' }).click()
  await page.getByRole('button', { name: 'Add chapter' }).click()
  await expect(page.getByRole('link', { name: 'Chapter 1' })).toBeVisible()
  await page.getByRole('link', { name: 'Write' }).click()
  await expect(page).toHaveURL(/\/write/)

  // Edit text and wait for autosave
  const editor = page.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await editor.click()
  await page.keyboard.type('Mara read the first letter twice before she let herself believe it.')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+i')
  await page.keyboard.type('Come home.')
  await page.keyboard.press('Control+i')
  const status = page.getByTestId('save-status')
  await expect(status).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })
  await expect(page.getByTestId('scene-words')).toHaveText('14')

  // Refresh the browser: the work is still there, formatting included
  await page.reload()
  const reloaded = page.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await expect(reloaded).toContainText('Mara read the first letter twice before she let herself believe it.')
  await expect(reloaded.locator('em')).toHaveText('Come home.')
  await expect(page.getByTestId('scene-words')).toHaveText('14')
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'idle')

  // Manual checkpoint appears in version history
  await page.getByRole('button', { name: 'Show side panel' }).click()
  await page.getByRole('tab', { name: 'History' }).click()
  await page.getByLabel('Manual checkpoint').fill('First pass')
  await page.getByRole('button', { name: 'Save checkpoint' }).click()
  await expect(page.getByTestId('version-list')).toContainText('First pass')

  // Keep writing, then restore the checkpoint: the newer text is kept as a version too
  await reloaded.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' She burned it anyway.')
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })
  await page.getByTestId('version-list').getByRole('listitem').filter({ hasText: 'First pass' }).getByRole('button', { name: 'Restore' }).click()
  await expect(reloaded).not.toContainText('She burned it anyway.')
  await expect(page.getByTestId('version-list')).toContainText('Before restoring')
  await page.reload()
  await expect(page.getByRole('textbox', { name: /Manuscript: Scene 1/ })).not.toContainText('She burned it anyway.')

  // Word count rolls up to the book and the dashboard
  await page.goto(bookUrl)
  await expect(page.getByText(/14\s+words\s+of 85,000/)).toBeVisible()
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page.getByRole('link', { name: 'Continue writing' })).toBeVisible()
  await expect(page.getByText('The Salt Letters').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /salt-letters-draft\.txt/ })).toBeVisible()

  // Session persists across reloads; signing out protects routes again
  await page.reload()
  await expect(page.getByRole('link', { name: 'Continue writing' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto(bookUrl)
  await expect(page).toHaveURL(/\/login/)
})

test('archive, restore, and permanent delete with confirmation', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'New book' }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Disposable Draft')
  await page.getByRole('button', { name: 'Create book' }).click()
  await expect(page.getByRole('heading', { name: 'Disposable Draft' })).toBeVisible()

  await page.getByRole('button', { name: 'More book actions' }).click()
  await page.getByRole('menuitem', { name: 'Archive book' }).click()
  await expect(page.getByText('Archived', { exact: true })).toBeVisible()
  await page.goto('/library')
  await expect(page.getByText('Disposable Draft')).toHaveCount(0)
  await page.getByRole('button', { name: /Archived \(1\)/ }).click()
  await page.getByRole('link', { name: /Disposable Draft/ }).click()
  await page.getByRole('button', { name: 'More book actions' }).click()
  await page.getByRole('menuitem', { name: 'Restore from archive' }).click()
  await expect(page.getByText('Archived', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'More book actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete permanently' }).click()
  const confirm = page.getByRole('button', { name: 'Delete book forever' })
  await expect(confirm).toBeDisabled()
  await page.getByLabel(/Type Disposable Draft to confirm/).fill('Disposable Draft')
  await confirm.click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByText('Disposable Draft')).toHaveCount(0)
})

test('autosave retries failed saves and recovers unsaved text after a crash', async ({ page, context }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'New book' }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Recovery Test')
  await page.getByRole('button', { name: 'Create book' }).click()
  await page.getByRole('button', { name: 'Add chapter' }).click()
  await page.getByRole('link', { name: 'Write' }).click()
  const editor = page.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await editor.click()
  await page.keyboard.type('Saved line.')
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })
  const writeUrl = page.url()

  // The server starts failing: the editor shows the error and keeps retrying.
  await context.route('**/rest/v1/rpc/save_scene', (route) => route.fulfill({ status: 503, body: '{"message":"Service unavailable"}' }))
  await page.keyboard.type(' Unsaved words survive.')
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'error', { timeout: 15_000 })
  await expect(page.getByRole('alert').filter({ hasText: 'Not saved' })).toBeVisible()

  // Leave while the server is still failing (any last-chance save on exit also fails).
  page.on('dialog', (d) => void d.accept())
  await page.goto('about:blank')
  await context.unroute('**/rest/v1/rpc/save_scene')

  // The server is back. Reopening shows the last saved text and offers the lost words back.
  const next = page
  await next.goto(writeUrl)
  const reopened = next.getByRole('textbox', { name: /Manuscript: Scene 1/ })
  await expect(reopened).toHaveText('Saved line.')
  await expect(next.getByText(/Unsaved changes from .* were found on this device/)).toBeVisible()
  await next.getByRole('button', { name: 'Restore them' }).click()
  await expect(reopened).toHaveText('Saved line. Unsaved words survive.')
  await expect(next.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })
  await next.reload()
  await expect(next.getByRole('textbox', { name: /Manuscript: Scene 1/ })).toHaveText('Saved line. Unsaved words survive.')
  await expect(next.getByText(/were found on this device/)).toHaveCount(0)
})
