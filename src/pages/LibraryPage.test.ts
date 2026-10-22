import { filterAndSortBooks } from './LibraryPage'
import type { Book } from '@/types/db'

const book = (over: Partial<Book>): Book =>
  ({
    id: Math.random().toString(),
    owner_id: 'u',
    title: 'Untitled',
    subtitle: null,
    pen_name: null,
    description: null,
    synopsis: null,
    genre: null,
    subgenre: null,
    tropes: [],
    themes: [],
    book_type: 'work_in_progress',
    content_rating: 'general',
    publication_status: 'unpublished',
    writing_status: 'drafting',
    cover_path: null,
    original_manuscript_file_id: null,
    current_manuscript_file_id: null,
    word_count: 0,
    target_word_count: null,
    publication_date: null,
    chronological_position: null,
    author_notes: null,
    archived_at: null,
    last_opened_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as Book

describe('filterAndSortBooks', () => {
  const books = [
    book({ title: 'Bitter Orchard', word_count: 50, tropes: ['enemies to lovers'], updated_at: '2026-03-01T00:00:00Z' }),
    book({ title: 'Ash Season', word_count: 900, writing_status: 'complete', updated_at: '2026-05-01T00:00:00Z' }),
    book({ title: 'Cold Harbor', archived_at: '2026-06-01T00:00:00Z' }),
  ]
  const opts = { query: '', status: '', type: '', archived: false, sort: 'updated' as const }

  it('hides archived books unless asked', () => {
    expect(filterAndSortBooks(books, opts).map((b) => b.title)).toEqual(['Ash Season', 'Bitter Orchard'])
    expect(filterAndSortBooks(books, { ...opts, archived: true }).map((b) => b.title)).toEqual(['Cold Harbor'])
  })
  it('searches tropes and filters by status', () => {
    expect(filterAndSortBooks(books, { ...opts, query: 'LOVERS' }).map((b) => b.title)).toEqual(['Bitter Orchard'])
    expect(filterAndSortBooks(books, { ...opts, status: 'complete' }).map((b) => b.title)).toEqual(['Ash Season'])
  })
  it('sorts by title and words', () => {
    expect(filterAndSortBooks(books, { ...opts, sort: 'title' }).map((b) => b.title)).toEqual(['Ash Season', 'Bitter Orchard'])
    expect(filterAndSortBooks(books, { ...opts, sort: 'words' })[0].title).toBe('Ash Season')
  })
})
