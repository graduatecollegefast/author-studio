import { useQuery } from '@tanstack/react-query'
import { getCoverUrl } from '@/services/books'
import { cn } from '@/lib/utils'
import type { Book } from '@/types/db'

/** Private cover image loaded through a short-lived signed URL, with a typographic fallback. */
export function BookCover({
  book,
  className,
  compact,
}: {
  book: Pick<Book, 'title' | 'pen_name' | 'cover_path'>
  className?: string
  /** Small thumbnails show a monogram instead of the full title. */
  compact?: boolean
}) {
  const { data: url } = useQuery({
    queryKey: ['cover-url', book.cover_path],
    queryFn: () => getCoverUrl(book.cover_path!),
    enabled: Boolean(book.cover_path),
    staleTime: 50 * 60 * 1000,
  })

  if (book.cover_path && url) {
    return <img src={url} alt={`Cover of ${book.title}`} className={cn('aspect-[2/3] w-full rounded-md object-cover', className)} />
  }
  return (
    <div
      className={cn(
        'flex aspect-[2/3] w-full flex-col justify-between rounded-md border border-line bg-gradient-to-br from-plum-soft via-panel-2 to-amber-soft',
        compact ? 'p-2' : 'p-3',
        className,
      )}
      aria-hidden
    >
      <div className={cn('h-px bg-amber', compact ? 'w-4' : 'w-8')} />
      {compact ? (
        <div className="font-serif text-2xl font-semibold leading-none text-fg">{book.title.trim().charAt(0).toUpperCase()}</div>
      ) : (
      <div>
        <div className="line-clamp-4 font-serif text-base font-semibold leading-tight text-fg">{book.title}</div>
        {book.pen_name && <div className="mt-1 truncate text-[10px] uppercase tracking-widest text-fg-muted">{book.pen_name}</div>}
      </div>
      )}
    </div>
  )
}
