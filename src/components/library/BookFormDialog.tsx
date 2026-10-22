import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { bookFormSchema, type BookFormInput } from '@/lib/schemas'
import { createBook, updateBook } from '@/services/books'
import { qk } from '@/hooks/queries'
import { labelize } from '@/lib/utils'
import { BOOK_TYPES, CONTENT_RATINGS, PUBLICATION_STATUSES, WRITING_STATUSES, type Book } from '@/types/db'

function toInput(book?: Book): BookFormInput {
  return {
    title: book?.title ?? '',
    subtitle: book?.subtitle ?? '',
    pen_name: book?.pen_name ?? '',
    description: book?.description ?? '',
    synopsis: book?.synopsis ?? '',
    genre: book?.genre ?? '',
    subgenre: book?.subgenre ?? '',
    tropes: (book?.tropes ?? []).join(', '),
    themes: (book?.themes ?? []).join(', '),
    book_type: book?.book_type ?? 'work_in_progress',
    content_rating: book?.content_rating ?? 'general',
    publication_status: book?.publication_status ?? 'unpublished',
    writing_status: book?.writing_status ?? 'drafting',
    target_word_count: book?.target_word_count != null ? String(book.target_word_count) : '',
    publication_date: book?.publication_date ?? '',
    author_notes: book?.author_notes ?? '',
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  book?: Book
  onSaved?: (book: Book) => void
  defaultBookType?: Book['book_type']
}

export function BookFormDialog({ open, onOpenChange, book, onSaved, defaultBookType }: Props) {
  const qc = useQueryClient()
  const [values, setValues] = React.useState<BookFormInput>(() => toInput(book))
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (open) {
      const initial = toInput(book)
      if (!book && defaultBookType) initial.book_type = defaultBookType
      setValues(initial)
      setErrors({})
    }
  }, [open, book, defaultBookType])

  const mutation = useMutation({
    mutationFn: async (input: BookFormInput) => {
      const parsed = bookFormSchema.parse(input)
      return book ? updateBook(book.id, parsed) : createBook(parsed)
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: qk.books })
      qc.invalidateQueries({ queryKey: qk.dashboard })
      qc.setQueryData(qk.book(saved.id), saved)
      toast.success(book ? 'Book details saved' : `"${saved.title}" created`)
      onOpenChange(false)
      onSaved?.(saved)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save the book'),
  })

  function set<K extends keyof BookFormInput>(key: K, value: BookFormInput[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = bookFormSchema.safeParse(values)
    if (!result.success) {
      const next: Record<string, string> = {}
      for (const issue of result.error.issues) next[String(issue.path[0])] = issue.message
      setErrors(next)
      return
    }
    setErrors({})
    mutation.mutate(values)
  }

  const text = (key: keyof BookFormInput) => ({
    id: `book-${key}`,
    value: String(values[key] ?? ''),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `book-${key}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(key, e.target.value as never),
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent title={book ? 'Edit book details' : 'New book'} className="max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="book-title" error={errors.title} className="sm:col-span-2">
              <Input {...text('title')} autoFocus required />
            </Field>
            <Field label="Subtitle" htmlFor="book-subtitle" error={errors.subtitle}>
              <Input {...text('subtitle')} />
            </Field>
            <Field label="Pen name" htmlFor="book-pen_name" error={errors.pen_name}>
              <Input {...text('pen_name')} />
            </Field>
            <Field label="Book type" htmlFor="book-book_type">
              <Select {...text('book_type')}>
                {BOOK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Writing status" htmlFor="book-writing_status">
              <Select {...text('writing_status')}>
                {WRITING_STATUSES.map((t) => (
                  <option key={t} value={t}>
                    {labelize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Publication status" htmlFor="book-publication_status">
              <Select {...text('publication_status')}>
                {PUBLICATION_STATUSES.map((t) => (
                  <option key={t} value={t}>
                    {labelize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Content rating" htmlFor="book-content_rating">
              <Select {...text('content_rating')}>
                {CONTENT_RATINGS.map((t) => (
                  <option key={t} value={t}>
                    {labelize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Genre" htmlFor="book-genre" error={errors.genre}>
              <Input {...text('genre')} />
            </Field>
            <Field label="Subgenre" htmlFor="book-subgenre" error={errors.subgenre}>
              <Input {...text('subgenre')} />
            </Field>
            <Field label="Tropes" htmlFor="book-tropes" hint="Separate with commas">
              <Input {...text('tropes')} />
            </Field>
            <Field label="Themes" htmlFor="book-themes" hint="Separate with commas">
              <Input {...text('themes')} />
            </Field>
            <Field label="Target word count" htmlFor="book-target_word_count" error={errors.target_word_count}>
              <Input {...text('target_word_count')} inputMode="numeric" />
            </Field>
            <Field label="Publication date" htmlFor="book-publication_date" error={errors.publication_date}>
              <Input {...text('publication_date')} type="date" />
            </Field>
            <Field label="Description" htmlFor="book-description" error={errors.description} className="sm:col-span-2">
              <Textarea {...text('description')} rows={3} />
            </Field>
            <Field label="Synopsis" htmlFor="book-synopsis" error={errors.synopsis} className="sm:col-span-2">
              <Textarea {...text('synopsis')} rows={4} />
            </Field>
            <Field label="Author notes" htmlFor="book-author_notes" error={errors.author_notes} className="sm:col-span-2">
              <Textarea {...text('author_notes')} rows={3} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : book ? 'Save changes' : 'Create book'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
