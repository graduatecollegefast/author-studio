import { z } from 'zod'
import { BOOK_TYPES, CONTENT_RATINGS, PUBLICATION_STATUSES, WRITING_STATUSES } from '@/types/db'

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((v) => (v === '' ? null : v))
    .nullable()

const listFromText = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50),
  )

export const bookFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  subtitle: optionalText(300),
  pen_name: optionalText(200),
  description: optionalText(5000),
  synopsis: optionalText(20000),
  genre: optionalText(120),
  subgenre: optionalText(120),
  tropes: listFromText,
  themes: listFromText,
  book_type: z.enum(BOOK_TYPES),
  content_rating: z.enum(CONTENT_RATINGS),
  publication_status: z.enum(PUBLICATION_STATUSES),
  writing_status: z.enum(WRITING_STATUSES),
  target_word_count: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null
      const n = Number(v.replace(/,/g, ''))
      if (!Number.isInteger(n) || n < 0 || n > 5_000_000) {
        ctx.addIssue({ code: 'custom', message: 'Enter a whole number' })
        return z.NEVER
      }
      return n
    }),
  publication_date: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD')
    .transform((v) => (v === '' ? null : v)),
  author_notes: optionalText(20000),
})

export type BookFormInput = z.input<typeof bookFormSchema>
export type BookFormValues = z.output<typeof bookFormSchema>

export const emailSchema = z.string().trim().pipe(z.email('Enter a valid email address'))
export const passwordSchema = z.string().min(8, 'Use at least 8 characters').max(128)

export const titleSchema = z.string().trim().min(1, 'A title is required').max(200)
