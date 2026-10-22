import { bookFormSchema, emailSchema } from './schemas'

const base = {
  title: '  The Lantern House ',
  subtitle: '',
  pen_name: 'R. Vale',
  description: '',
  synopsis: '',
  genre: 'Romance',
  subgenre: '',
  tropes: 'second chance,  slow burn , ',
  themes: '',
  book_type: 'work_in_progress',
  content_rating: 'mature',
  publication_status: 'unpublished',
  writing_status: 'drafting',
  target_word_count: '90,000',
  publication_date: '',
  author_notes: '',
} as const

describe('bookFormSchema', () => {
  it('normalizes input for the database', () => {
    const v = bookFormSchema.parse(base)
    expect(v.title).toBe('The Lantern House')
    expect(v.subtitle).toBeNull()
    expect(v.tropes).toEqual(['second chance', 'slow burn'])
    expect(v.themes).toEqual([])
    expect(v.target_word_count).toBe(90000)
    expect(v.publication_date).toBeNull()
  })

  it('rejects missing titles, bad numbers, and unknown enums', () => {
    expect(bookFormSchema.safeParse({ ...base, title: '   ' }).success).toBe(false)
    expect(bookFormSchema.safeParse({ ...base, target_word_count: '12.5' }).success).toBe(false)
    expect(bookFormSchema.safeParse({ ...base, book_type: 'screenplay' }).success).toBe(false)
    expect(bookFormSchema.safeParse({ ...base, publication_date: '10/22/2026' }).success).toBe(false)
  })

  it('validates email', () => {
    expect(emailSchema.safeParse(' writer@example.com ').success).toBe(true)
    expect(emailSchema.safeParse('nope').success).toBe(false)
  })
})
