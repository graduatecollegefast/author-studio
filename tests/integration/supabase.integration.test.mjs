// Integration tests against a running Supabase (local stack or a disposable project).
// Never point this at production: it creates and deletes test users.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:db
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anonKey || !serviceKey) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, opts)
const run = Date.now().toString(36)
const users = {}

async function makeUser(name) {
  const email = `rls-${name}-${run}@example.test`
  const password = `pw-${run}-${name}-Secret!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const client = createClient(url, anonKey, opts)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, client }
}

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] })

before(async () => {
  users.a = await makeUser('a')
  users.b = await makeUser('b')
})

after(async () => {
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id)
})

test('profile row is created for each new user', async () => {
  const { data, error } = await users.a.client.from('profiles').select('id').eq('id', users.a.id).single()
  assert.equal(error, null)
  assert.equal(data.id, users.a.id)
})

test('anonymous requests cannot read author data', async () => {
  const anon = createClient(url, anonKey, opts)
  const { data, error } = await anon.from('books').select('id')
  assert.ok(error || (data ?? []).length === 0, 'anon must not see books')
})

let bookA
test('an author can create and update a book; owner comes from the session', async () => {
  const { data, error } = await users.a.client.from('books').insert({ title: 'The Glass Orchard' }).select('*').single()
  assert.equal(error, null)
  assert.equal(data.owner_id, users.a.id)
  bookA = data
  const upd = await users.a.client.from('books').update({ genre: 'Romance', target_word_count: 80000 }).eq('id', bookA.id).select('*').single()
  assert.equal(upd.error, null)
  assert.equal(upd.data.genre, 'Romance')
})

test('a different author cannot read, change, or delete that book', async () => {
  const read = await users.b.client.from('books').select('*').eq('id', bookA.id)
  assert.deepEqual(read.data, [])
  const upd = await users.b.client.from('books').update({ title: 'Hacked' }).eq('id', bookA.id).select()
  assert.deepEqual(upd.data ?? [], [])
  const del = await users.b.client.from('books').delete().eq('id', bookA.id).select()
  assert.deepEqual(del.data ?? [], [])
  const still = await users.a.client.from('books').select('title').eq('id', bookA.id).single()
  assert.equal(still.data.title, 'The Glass Orchard')
})

test('cannot insert rows owned by someone else or attached to their book', async () => {
  const spoof = await users.b.client.from('books').insert({ title: 'Spoof', owner_id: users.a.id })
  assert.ok(spoof.error, 'owner_id spoofing must fail')
  const chapter = await users.b.client.from('chapters').insert({ book_id: bookA.id, title: 'Intruder' })
  assert.ok(chapter.error, 'attaching to another author book must fail')
  const rpc = await users.b.client.rpc('create_chapter', { p_book_id: bookA.id })
  assert.ok(rpc.error, 'create_chapter on another author book must fail')
})

test('owner_id cannot be changed after insert', async () => {
  const { error } = await users.a.client.from('books').update({ owner_id: users.b.id }).eq('id', bookA.id)
  assert.ok(error)
})

let chapterId, sceneId
test('create_chapter adds a chapter with its first scene', async () => {
  const { data, error } = await users.a.client.rpc('create_chapter', { p_book_id: bookA.id, p_title: null })
  assert.equal(error, null)
  chapterId = data
  const { data: scenes } = await users.a.client.from('scenes').select('*').eq('chapter_id', chapterId)
  assert.equal(scenes.length, 1)
  assert.equal(scenes[0].revision, 1)
  sceneId = scenes[0].id
  const { data: ch } = await users.a.client.from('chapters').select('title, position').eq('id', chapterId).single()
  assert.equal(ch.title, 'Chapter 1')
  assert.equal(ch.position, 0)
})

test('save_scene saves, counts words, rolls up totals, and bumps the revision', async () => {
  const { data, error } = await users.a.client.rpc('save_scene', {
    p_scene_id: sceneId,
    p_content: doc('She opened the door slowly.'),
    p_content_text: 'She opened the door slowly.',
    p_expected_revision: 1,
  })
  assert.equal(error, null)
  assert.equal(data[0].revision, 2)
  assert.equal(data[0].word_count, 5)
  const { data: ch } = await users.a.client.from('chapters').select('word_count').eq('id', chapterId).single()
  assert.equal(ch.word_count, 5)
  const { data: bk } = await users.a.client.from('books').select('word_count').eq('id', bookA.id).single()
  assert.equal(bk.word_count, 5)
})

test('save_scene rejects stale revisions instead of overwriting', async () => {
  const { error } = await users.a.client.rpc('save_scene', {
    p_scene_id: sceneId,
    p_content: doc('stale'),
    p_content_text: 'stale',
    p_expected_revision: 1,
  })
  assert.ok(error)
  assert.match(error.message, /REVISION_CONFLICT/)
  const { data } = await users.a.client.from('scenes').select('content_text, revision').eq('id', sceneId).single()
  assert.equal(data.content_text, 'She opened the door slowly.')
  assert.equal(data.revision, 2)
})

test('another author cannot save into the scene', async () => {
  const { error } = await users.b.client.rpc('save_scene', {
    p_scene_id: sceneId,
    p_content: doc('x'),
    p_content_text: 'x',
    p_expected_revision: 2,
  })
  assert.ok(error)
  assert.match(error.message, /SCENE_NOT_FOUND/)
})

test('overwriting text keeps a recoverable automatic snapshot', async () => {
  const { error } = await users.a.client.rpc('save_scene', {
    p_scene_id: sceneId,
    p_content: doc('Rewritten opening line here.'),
    p_content_text: 'Rewritten opening line here.',
    p_expected_revision: 2,
  })
  assert.equal(error, null)
  const { data: versions } = await users.a.client.from('scene_versions').select('*').eq('scene_id', sceneId)
  assert.equal(versions.length, 1)
  assert.equal(versions[0].kind, 'autosnapshot')
  assert.equal(versions[0].content_text, 'She opened the door slowly.')
  // Snapshots are throttled: an immediate second save does not add another.
  await users.a.client.rpc('save_scene', { p_scene_id: sceneId, p_content: doc('Third.'), p_content_text: 'Third.', p_expected_revision: 3 })
  const { data: again } = await users.a.client.from('scene_versions').select('id').eq('scene_id', sceneId)
  assert.equal(again.length, 1)
})

test('checkpoints and restore keep the replaced text', async () => {
  const cp = await users.a.client.rpc('create_scene_checkpoint', { p_scene_id: sceneId, p_label: 'Before edits' })
  assert.equal(cp.error, null)
  const { data: snap } = await users.a.client.from('scene_versions').select('*').eq('kind', 'autosnapshot').eq('scene_id', sceneId).single()
  const { data, error } = await users.a.client.rpc('restore_scene_version', { p_version_id: snap.id, p_expected_revision: 4 })
  assert.equal(error, null)
  assert.equal(data[0].revision, 5)
  const { data: scene } = await users.a.client.from('scenes').select('content_text').eq('id', sceneId).single()
  assert.equal(scene.content_text, 'She opened the door slowly.')
  const { data: kinds } = await users.a.client.from('scene_versions').select('kind, label, content_text').eq('scene_id', sceneId)
  assert.ok(kinds.some((v) => v.kind === 'checkpoint' && v.label === 'Before edits' && v.content_text === 'Third.'))
  assert.ok(kinds.some((v) => v.kind === 'pre_restore' && v.content_text === 'Third.'))
  const other = await users.b.client.from('scene_versions').select('id').eq('scene_id', sceneId)
  assert.deepEqual(other.data, [])
})

test('scenes can be added and reordered; the last scene cannot be deleted', async () => {
  const s2 = await users.a.client.from('scenes').insert({ book_id: bookA.id, chapter_id: chapterId, title: 'Scene 2', position: 1 }).select('id').single()
  assert.equal(s2.error, null)
  const re = await users.a.client.rpc('reorder_scenes', { p_chapter_id: chapterId, p_ids: [s2.data.id, sceneId] })
  assert.equal(re.error, null)
  const { data: ordered } = await users.a.client.from('scenes').select('id').eq('chapter_id', chapterId).order('position')
  assert.deepEqual(ordered.map((r) => r.id), [s2.data.id, sceneId])
  const bad = await users.a.client.rpc('reorder_scenes', { p_chapter_id: chapterId, p_ids: [sceneId] })
  assert.match(bad.error?.message ?? '', /REORDER_MISMATCH/)
  assert.equal((await users.a.client.from('scenes').delete().eq('id', s2.data.id)).error, null)
  const last = await users.a.client.from('scenes').delete().eq('id', sceneId)
  assert.match(last.error?.message ?? '', /LAST_SCENE/)
})

test('daily word totals follow edits in the author time zone and ignore direct inserts', async () => {
  await users.a.client.from('profiles').update({ preferences: { timezone: 'Pacific/Kiritimati' } }).eq('id', users.a.id)
  const { data: today } = await users.a.client.rpc('author_today', { p_owner: users.a.id })
  const book = await users.a.client.from('books').insert({ title: 'Stats Book' }).select('id').single()
  const chapter = await users.a.client.rpc('create_chapter', { p_book_id: book.data.id })
  const { data: sc } = await users.a.client.from('scenes').select('id, revision').eq('chapter_id', chapter.data).single()
  const before = (await users.a.client.from('writing_daily_stats').select('*').eq('day', today).maybeSingle()).data
  const base = { added: before?.words_added ?? 0, removed: before?.words_removed ?? 0 }
  await users.a.client.rpc('save_scene', { p_scene_id: sc.id, p_content: doc('one two three four five'), p_content_text: 'one two three four five', p_expected_revision: sc.revision })
  await users.a.client.rpc('save_scene', { p_scene_id: sc.id, p_content: doc('one two three'), p_content_text: 'one two three', p_expected_revision: sc.revision + 1 })
  // A directly inserted scene (as an import does) is not counted as writing.
  await users.a.client.from('scenes').insert({ book_id: book.data.id, chapter_id: chapter.data, title: 'Imported', position: 1, content: doc('a b c d e f g'), content_text: 'a b c d e f g', word_count: 7 })
  const { data: stat } = await users.a.client.from('writing_daily_stats').select('*').eq('day', today).single()
  assert.equal(stat.words_added - base.added, 5)
  assert.equal(stat.words_removed - base.removed, 2)
  const kiritimatiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date())
  assert.equal(today, kiritimatiToday)
  const other = await users.b.client.from('writing_daily_stats').select('*')
  assert.deepEqual(other.data, [])
  await users.a.client.from('books').delete().eq('id', book.data.id)
})

test('a scene cannot point at a chapter from another book', async () => {
  const other = await users.a.client.from('books').insert({ title: 'Second Book' }).select('id').single()
  const { error } = await users.a.client.from('scenes').insert({ book_id: other.data.id, chapter_id: chapterId, title: 'Wrong' })
  assert.ok(error)
  await users.a.client.from('books').delete().eq('id', other.data.id)
})

test('private storage: authors only reach their own folder', async () => {
  const pathA = `${users.a.id}/${bookA.id}/test-manuscript.txt`
  const up = await users.a.client.storage.from('manuscripts').upload(pathA, new Blob(['Chapter One'], { type: 'text/plain' }), { contentType: 'text/plain' })
  assert.equal(up.error, null)
  const intoB = await users.a.client.storage.from('manuscripts').upload(`${users.b.id}/x.txt`, new Blob(['x'], { type: 'text/plain' }), { contentType: 'text/plain' })
  assert.ok(intoB.error, 'writing into another author folder must fail')
  const steal = await users.b.client.storage.from('manuscripts').download(pathA)
  assert.ok(steal.error, 'another author must not download the file')
  const own = await users.a.client.storage.from('manuscripts').download(pathA)
  assert.equal(own.error, null)
  assert.equal(await own.data.text(), 'Chapter One')
  const anon = createClient(url, anonKey, opts)
  assert.ok((await anon.storage.from('manuscripts').download(pathA)).error, 'anonymous download must fail')
  const badType = await users.a.client.storage.from('manuscripts').upload(`${users.a.id}/${bookA.id}/pic.png`, new Blob(['png'], { type: 'image/png' }), { contentType: 'image/png' })
  assert.ok(badType.error, 'bucket must reject disallowed MIME types')
})

test('file records must point inside the owner folder', async () => {
  const { error } = await users.a.client.from('manuscript_files').insert({
    book_id: bookA.id,
    storage_path: `${users.b.id}/${bookA.id}/x.txt`,
    original_name: 'x.txt',
    file_ext: 'txt',
    mime_type: 'text/plain',
    size_bytes: 1,
  })
  assert.ok(error)
})

test('extractions and imports are private to their author', async () => {
  const book = await users.a.client.from('books').insert({ title: 'Import Book' }).select('id').single()
  const fileId = crypto.randomUUID()
  await users.a.client.from('manuscript_files').insert({
    id: fileId, book_id: book.data.id, storage_path: `${users.a.id}/${book.data.id}/${fileId}-x.txt`,
    original_name: 'x.txt', file_ext: 'txt', mime_type: 'text/plain', size_bytes: 10, upload_status: 'validated',
  })
  const ex = await users.a.client.from('manuscript_extractions').insert({
    manuscript_file_id: fileId, book_id: book.data.id, format: 'txt', word_count: 2, chapter_count: 1, structure: [],
  })
  assert.equal(ex.error, null)
  assert.deepEqual((await users.b.client.from('manuscript_extractions').select('*')).data, [])
  const chapters = [{ title: 'One', scenes: [{ title: 'S', content: doc('Hello there'), text: 'Hello there' }] }]
  const stolen = await users.b.client.rpc('import_manuscript', { p_file_id: fileId, p_chapters: chapters })
  assert.match(stolen.error?.message ?? '', /FILE_NOT_FOUND/)
  const bad = await users.a.client.rpc('import_manuscript', { p_file_id: fileId, p_chapters: [{ title: 'x', scenes: [{ content: { type: 'html' }, text: '' }] }] })
  assert.match(bad.error?.message ?? '', /INVALID_CONTENT/)
  const ok = await users.a.client.rpc('import_manuscript', { p_file_id: fileId, p_chapters: chapters })
  assert.equal(ok.data, 1)
  const { data: scenes } = await users.a.client.from('scenes').select('content_text, word_count').eq('book_id', book.data.id)
  assert.deepEqual(scenes, [{ content_text: 'Hello there', word_count: 2 }])
  const { data: f } = await users.a.client.from('manuscript_files').select('imported_at').eq('id', fileId).single()
  assert.ok(f.imported_at)
  await users.a.client.from('books').delete().eq('id', book.data.id)
})

test('deleting a book removes its chapters, scenes, and versions', async () => {
  const { error } = await users.a.client.from('books').delete().eq('id', bookA.id)
  assert.equal(error, null)
  const { count: sceneCount } = await admin.from('scenes').select('id', { count: 'exact', head: true }).eq('book_id', bookA.id)
  const { count: versionCount } = await admin.from('scene_versions').select('id', { count: 'exact', head: true }).eq('scene_id', sceneId)
  assert.equal(sceneCount, 0)
  assert.equal(versionCount, 0)
})
