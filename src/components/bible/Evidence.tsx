import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/card'
import { STATEMENT_LABELS } from '@/services/ai'
import { bookTitles, type CanonFact } from '@/services/bible'
import { attributeLabel } from '@/components/analysis/DiscoveryReview'

export function useBookTitles() {
  return useQuery({ queryKey: ['book-titles'], queryFn: bookTitles, staleTime: 60_000 })
}

/** Approved canon for one entity, each with the quote and place it came from. */
export function CanonList({ facts, empty }: { facts: CanonFact[]; empty: string }) {
  const titles = useBookTitles()
  if (!facts.length) return <p className="text-sm text-fg-muted">{empty}</p>
  return (
    <ul className="divide-y divide-line" data-testid="canon-facts">
      {facts.map((f) => (
        <li key={f.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-fg">{attributeLabel(f.attribute)}</span>
            <span className="text-fg">{f.value}</span>
            {f.statement_type !== 'narrator' && f.statement_type !== 'author_confirmed' && (
              <Badge tone={f.statement_type.startsWith('ai_') ? 'ai' : 'alert'}>{STATEMENT_LABELS[f.statement_type] ?? f.statement_type}</Badge>
            )}
          </div>
          {f.fact_sources.slice(0, 2).map((s) => (
            <figure key={s.id} className="mt-1.5 border-l-2 border-control pl-3">
              {s.excerpt && <blockquote className="font-serif italic text-fg-muted">"{s.excerpt}"</blockquote>}
              <figcaption className="text-xs text-fg-faint">
                {s.book_id && titles.data?.get(s.book_id) ? (
                  <Link className="link" to={`/books/${s.book_id}`}>
                    {titles.data.get(s.book_id)}
                  </Link>
                ) : null}
                {s.location_label ? `${s.book_id ? ', ' : ''}${s.location_label}` : ''}
              </figcaption>
            </figure>
          ))}
        </li>
      ))}
    </ul>
  )
}
