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
  assert.deepEqual(ok.data, { imported: 1, replaced: 0, kept: 0 })
  const { data: scenes } = await users.a.client.from('scenes').select('content_text, word_count').eq('book_id', book.data.id)
  assert.deepEqual(scenes, [{ content_text: 'Hello there', word_count: 2 }])
  const { data: f } = await users.a.client.from('manuscript_files').select('imported_at').eq('id', fileId).single()
  assert.ok(f.imported_at)

  // Re-import with replace: an untouched chapter is replaced, an edited one is kept, nothing is duplicated.
  const two = [
    { title: 'One', scenes: [{ title: 'S', content: doc('First'), text: 'First' }] },
    { title: 'Two', scenes: [{ title: 'S', content: doc('Second'), text: 'Second' }] },
  ]
  await users.a.client.rpc('import_manuscript', { p_file_id: fileId, p_chapters: two, p_replace: true })
  const { data: afterFirst } = await users.a.client.from('chapters').select('id, title, position').eq('book_id', book.data.id).order('position')
  assert.deepEqual(afterFirst.map((c) => c.title), ['One', 'Two'])
  const { data: s2 } = await users.a.client.from('scenes').select('id, revision').eq('chapter_id', afterFirst[1].id).single()
  await users.a.client.rpc('save_scene', { p_scene_id: s2.id, p_content: doc('Second, revised by hand'), p_content_text: 'Second, revised by hand', p_expected_revision: s2.revision })
  const again = await users.a.client.rpc('import_manuscript', { p_file_id: fileId, p_chapters: two, p_replace: true })
  assert.deepEqual(again.data, { imported: 2, replaced: 1, kept: 1 })
  const { data: final } = await users.a.client.from('chapters').select('title, position').eq('book_id', book.data.id).order('position')
  assert.deepEqual(final, [
    { title: 'Two', position: 0 },
    { title: 'One', position: 1 },
    { title: 'Two', position: 2 },
  ])
  await users.a.client.from('books').delete().eq('id', book.data.id)
})

test('discoveries: saved with evidence, deduplicated, private, and filed into the Story Bible on approval', async () => {
  const a = users.a.client
  const book = await a.from('books').insert({ title: 'Salt Letters' }).select('id').single()
  const fileId = crypto.randomUUID()
  await a.from('manuscript_files').insert({
    id: fileId, book_id: book.data.id, storage_path: `${users.a.id}/${book.data.id}/${fileId}-x.txt`,
    original_name: 'x.txt', file_ext: 'txt', mime_type: 'text/plain', size_bytes: 10, upload_status: 'validated',
  })
  const text = 'Mara Vance worked as a lighthouse keeper. Mara and Eli were sisters. They met at the Harbor Diner.'
  const chunk = await a.from('document_chunks').insert({
    manuscript_file_id: fileId, book_id: book.data.id, chunk_index: 0, chapter_label: 'Chapter 1', content: text, char_start: 0, char_end: text.length,
  }).select('id').single()
  const task = await a.from('ai_tasks').insert({ task_type: 'book_analysis', idempotency_key: `analyze:${fileId}` }).select('id').single()
  const f = (o) => ({ statement_type: 'narrator', confidence: 0.9, char_start: 0, char_end: 10, payload: {}, ...o })
  const facts = [
    f({ category: 'character', entity_type: 'character', entity_label: 'Mara Vance', attribute: 'occupation', value: 'lighthouse keeper', excerpt: 'Mara Vance worked as a lighthouse keeper.' }),
    f({ category: 'character', entity_type: 'character', entity_label: 'Mara Vance', attribute: 'occupation', value: 'Lighthouse Keeper', excerpt: 'again' }),
    f({ category: 'character', entity_type: 'character', entity_label: 'Mara Vance', attribute: 'appearance.hair', value: 'salt gray', excerpt: 'x' }),
    f({ category: 'relationship', entity_type: 'relationship', entity_label: 'Mara', attribute: 'sisters', value: 'Mara and Eli are sisters', excerpt: 'Mara and Eli were sisters.', payload: { related_name: 'Eli', relationship_category: 'family' } }),
    f({ category: 'world', entity_type: 'world_element', entity_label: 'Harbor Diner', attribute: 'description', value: 'Where they met', excerpt: 'They met at the Harbor Diner.', payload: { world_category: 'business' } }),
    f({ category: 'timeline', entity_type: 'story_event', entity_label: 'The meeting', attribute: 'event', value: 'They meet', statement_type: 'rumor', confidence: 0.5, excerpt: 'They met', payload: { characters: ['Mara Vance'] } }),
  ]
  const stolen = await users.b.client.rpc('save_chunk_discoveries', { p_chunk_id: chunk.data.id, p_task_id: task.data.id, p_summary: 's', p_facts: facts })
  assert.match(stolen.error?.message ?? '', /CHUNK_NOT_FOUND/)
  const saved = await a.rpc('save_chunk_discoveries', { p_chunk_id: chunk.data.id, p_task_id: task.data.id, p_summary: 'Mara keeps the light.', p_facts: facts })
  assert.equal(saved.error, null)
  assert.equal(saved.data, 5, 'the repeated occupation becomes a second source, not a second fact')
  const { data: c } = await a.from('document_chunks').select('analysis_status, summary').eq('id', chunk.data.id).single()
  assert.deepEqual(c, { analysis_status: 'completed', summary: 'Mara keeps the light.' })
  const { data: proposed } = await a.from('canon_facts').select('id, entity_type, attribute, status, fact_sources(id)').eq('book_id', book.data.id).order('created_at')
  assert.equal(proposed.length, 5)
  assert.equal(proposed[0].fact_sources.length, 2)
  assert.ok(proposed.every((p) => p.status === 'proposed'))
  assert.deepEqual((await users.b.client.from('canon_facts').select('id').eq('book_id', book.data.id)).data, [])

  // Another author cannot approve them.
  const hijack = await users.b.client.rpc('review_discoveries', { p_fact_ids: proposed.map((p) => p.id), p_action: 'approve' })
  assert.deepEqual(hijack.data, { updated: 0 })

  const approved = await a.rpc('review_discoveries', { p_fact_ids: proposed.map((p) => p.id), p_action: 'approve' })
  assert.deepEqual(approved.data, { updated: 5 })
  const { data: chars } = await a.from('characters').select('id, full_name, occupation, appearance').order('full_name')
  assert.deepEqual(chars.map((x) => x.full_name), ['Eli', 'Mara Vance'], 'a first name joins the matching full name')
  const mara = chars.find((x) => x.full_name === 'Mara Vance')
  assert.equal(mara.occupation, 'lighthouse keeper')
  assert.deepEqual(mara.appearance, { hair: 'salt gray' })
  const { data: states } = await a.from('character_states').select('attribute, value, book_id').eq('character_id', mara.id).order('attribute')
  assert.deepEqual(states.map((s) => s.attribute), ['appearance.hair', 'occupation'])
  assert.equal(states[0].book_id, book.data.id)
  const { data: rel } = await a.from('relationships').select('category, custom_label').single()
  assert.deepEqual(rel, { category: 'family', custom_label: 'sisters' })
  const { data: we } = await a.from('world_elements').select('name, category, description, world_element_links(book_id)').single()
  assert.deepEqual(we, { name: 'Harbor Diner', category: 'business', description: 'Where they met', world_element_links: [{ book_id: book.data.id }] })
  const { data: ev } = await a.from('story_events').select('title, reliability, story_event_characters(character_id)').single()
  assert.equal(ev.reliability, 'uncertain')
  assert.deepEqual(ev.story_event_characters, [{ character_id: mara.id }])
  const { data: after } = await a.from('canon_facts').select('status, entity_id').eq('book_id', book.data.id)
  assert.ok(after.every((x) => x.status === 'approved' && x.entity_id))

  // A later book changes the occupation: the profile keeps the first value, history keeps both.
  const book2 = await a.from('books').insert({ title: 'Salt Letters 2' }).select('id').single()
  const later = await a.from('canon_facts').insert({ book_id: book2.data.id, entity_type: 'character', entity_label: 'Mara Vance', attribute: 'occupation', value: 'harbor master', category: 'character' }).select('id').single()
  await a.rpc('review_discoveries', { p_fact_ids: [later.data.id], p_action: 'approve' })
  const { data: mara2 } = await a.from('characters').select('occupation').eq('id', mara.id).single()
  assert.equal(mara2.occupation, 'lighthouse keeper')
  const { data: hist } = await a.from('character_states').select('value').eq('character_id', mara.id).eq('attribute', 'occupation').order('created_at')
  assert.deepEqual(hist.map((h) => h.value), ['lighthouse keeper', 'harbor master'])

  // A fuller name later upgrades a character known only by a first name.
  const e2 = await a.from('canon_facts').insert({ book_id: book.data.id, entity_type: 'character', entity_label: 'Eli Vance', attribute: 'age', value: '30', category: 'character' }).select('id').single()
  await a.rpc('review_discoveries', { p_fact_ids: [e2.data.id], p_action: 'approve' })
  const { data: eli } = await a.from('characters').select('full_name, nicknames').eq('id', chars.find((x) => x.full_name === 'Eli').id).single()
  assert.deepEqual(eli, { full_name: 'Eli Vance', nicknames: ['Eli'] })

  // Rejecting only changes status.
  const nope = await a.from('canon_facts').insert({ book_id: book.data.id, entity_type: 'character', entity_label: 'Ghost', attribute: 'age', value: '900', category: 'character' }).select('id').single()
  await a.rpc('review_discoveries', { p_fact_ids: [nope.data.id], p_action: 'reject' })
  assert.equal((await a.from('characters').select('id').eq('full_name', 'Ghost')).data.length, 0)

  // Usage is append-only for authors, and AI settings are private.
  const use = await a.from('ai_usage').insert({ provider: 'mock', model: 'mock-small', input_tokens: 1, output_tokens: 1, cost_usd: 0.01 }).select('id').single()
  const tamper = await a.from('ai_usage').delete().eq('id', use.data.id).select()
  assert.ok(tamper.error || (tamper.data ?? []).length === 0)
  await a.from('ai_settings').upsert({ daily_limit_usd: 3 }, { onConflict: 'owner_id' })
  assert.deepEqual((await users.b.client.from('ai_settings').select('*')).data, [])
  assert.equal(Number((await a.from('ai_settings').select('daily_limit_usd').single()).data.daily_limit_usd), 3)

  await a.from('books').delete().in('id', [book.data.id, book2.data.id])
  await a.from('characters').delete().in('full_name', ['Eli Vance', 'Mara Vance'])
})

test('series, universes, relationships, timelines and findings are private and linked safely', async () => {
  const a = users.a.client
  const b = users.b.client
  const b1 = (await a.from('books').insert({ title: 'Tide One' }).select('id').single()).data.id
  const b2 = (await a.from('books').insert({ title: 'Tide Two' }).select('id').single()).data.id
  const uni = (await a.from('universes').insert({ name: 'Harborverse' }).select('id').single()).data.id
  const ser = (await a.from('series').insert({ name: 'Tides', universe_id: uni, planned_book_count: 3 }).select('id').single()).data.id
  assert.equal((await a.from('series_books').insert([{ series_id: ser, book_id: b1, reading_order: 1 }, { series_id: ser, book_id: b2, reading_order: 2 }])).error, null)

  // A book can be in more than one series.
  const ser2 = (await a.from('series').insert({ name: 'Collected' }).select('id').single()).data.id
  assert.equal((await a.from('series_books').insert({ series_id: ser2, book_id: b1 })).error, null)

  // Ordering all three ways in one call.
  const ord = await a.rpc('set_series_order', { p_series_id: ser, p_rows: [
    { book_id: b1, reading_order: 2, chronological_order: 1, publication_order: 2 },
    { book_id: b2, reading_order: 1, chronological_order: 2, publication_order: 1 },
  ] })
  assert.equal(ord.data, 2)
  const { data: rows } = await a.from('series_books').select('book_id, reading_order, chronological_order').eq('series_id', ser).order('reading_order')
  assert.deepEqual(rows.map((r) => r.book_id), [b2, b1])
  const theirs = await b.rpc('set_series_order', { p_series_id: ser, p_rows: [] })
  assert.match(theirs.error?.message ?? '', /SERIES_NOT_FOUND/)

  // Another author cannot attach their book to this series, or see it.
  const bBook = (await b.from('books').insert({ title: 'Intruder' }).select('id').single()).data.id
  assert.ok((await b.from('series_books').insert({ series_id: ser, book_id: bBook })).error)
  assert.deepEqual((await b.from('series').select('id')).data, [])

  // Relationships with books and events; group relationships with roles.
  const [c1, c2, c3] = (await a.from('characters').insert([{ full_name: 'Ana Reed' }, { full_name: 'Bo Reed' }, { full_name: 'Cy Lake' }]).select('id').order('full_name')).data.map((r) => r.id)
  const rel = (await a.from('relationships').insert({ character_a_id: c1, character_b_id: c2, category: 'married', current_status: 'separated', past_status: 'married', important_changes: 'Separated in book two' }).select('id').single()).data.id
  const ev = (await a.from('story_events').insert({ book_id: b2, title: 'The separation', date_precision: 'approximate', approximate_label: 'Spring', end_label: 'Summer', reveal_order: 3 }).select('id').single()).data.id
  assert.equal((await a.from('relationship_books').insert({ relationship_id: rel, book_id: b2 })).error, null)
  assert.equal((await a.from('relationship_events').insert({ relationship_id: rel, event_id: ev })).error, null)
  assert.ok((await b.from('relationship_events').insert({ relationship_id: rel, event_id: ev })).error, 'cannot link into another author’s relationship')
  assert.deepEqual((await b.from('relationship_books').select('*')).data, [])
  const grp = (await a.from('relationship_groups').insert({ name: 'The triad', structure_type: 'triad' }).select('id').single()).data.id
  assert.equal((await a.from('relationship_group_members').insert([c1, c2, c3].map((c, i) => ({ group_id: grp, character_id: c, member_role: i === 0 ? 'anchor' : null })))).error, null)
  assert.equal((await a.from('relationships').insert({ character_a_id: c1, group_id: grp, category: 'romantic' })).error, null)

  // Event dates must be in order.
  const bad = await a.from('story_events').insert({ title: 'Backwards', date_precision: 'exact', date_start: '2020-02-02', date_end: '2020-01-01' })
  assert.ok(bad.error)

  // Plot threads by kind; findings record the author decision only.
  assert.equal((await a.from('plot_threads').insert({ series_id: ser, title: 'Who lit the lamp?', kind: 'mystery' })).error, null)
  assert.ok((await a.from('plot_threads').insert({ series_id: ser, title: 'x', kind: 'nonsense' })).error)
  const fid = (await a.from('editorial_findings').insert({ book_id: b2, review_type: 'continuity', category: 'occupation', severity: 'warning', description: 'Job differs', canon_fact_ids: [], conflicting_evidence: 'x' }).select('id').single()).data.id
  assert.equal((await a.from('editorial_findings').update({ status: 'intentional', reviewed_at: new Date().toISOString() }).eq('id', fid)).error, null)
  assert.deepEqual((await b.from('editorial_findings').update({ status: 'dismissed' }).eq('id', fid).select()).data ?? [], [])

  // Deleting a series keeps its books; deleting a universe unlinks its series.
  await a.from('series').delete().eq('id', ser2)
  assert.equal((await a.from('books').select('id').eq('id', b1)).data.length, 1)
  await a.from('universes').delete().eq('id', uni)
  assert.equal((await a.from('series').select('universe_id').eq('id', ser).single()).data.universe_id, null)

  await a.from('books').delete().in('id', [b1, b2])
  await b.from('books').delete().eq('id', bBook)
  await a.from('characters').delete().in('id', [c1, c2, c3])
  await a.from('series').delete().eq('id', ser)
})

test('deleting a book removes its chapters, scenes, and versions', async () => {
  const { error } = await users.a.client.from('books').delete().eq('id', bookA.id)
  assert.equal(error, null)
  const { count: sceneCount } = await admin.from('scenes').select('id', { count: 'exact', head: true }).eq('book_id', bookA.id)
  const { count: versionCount } = await admin.from('scene_versions').select('id', { count: 'exact', head: true }).eq('scene_id', sceneId)
  assert.equal(sceneCount, 0)
  assert.equal(versionCount, 0)
})
