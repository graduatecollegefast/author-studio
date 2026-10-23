import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Books whose canon may inform work on this book: itself, every book in the same series,
 * every book in the same universes (directly or through a series), and the books of any
 * universe the author deliberately connected as a crossover. Nothing else, so details from
 * unrelated universes never leak into new writing.
 */
export async function relatedBooks(db: SupabaseClient, bookId: string): Promise<string[]> {
  const ids = new Set([bookId])
  const [{ data: sb }, { data: bu }, { data: cross }] = await Promise.all([
    db.from('series_books').select('series_id').eq('book_id', bookId),
    db.from('book_universes').select('universe_id').eq('book_id', bookId),
    db.from('book_crossovers').select('universe_id').eq('book_id', bookId),
  ])
  const seriesIds = (sb ?? []).map((r) => r.series_id as string)
  const universeIds = new Set([...(bu ?? []), ...(cross ?? [])].map((r) => r.universe_id as string))
  if (seriesIds.length) {
    const { data: s } = await db.from('series').select('universe_id').in('id', seriesIds)
    for (const r of s ?? []) if (r.universe_id) universeIds.add(r.universe_id as string)
  }
  if (universeIds.size) {
    const u = [...universeIds]
    const [{ data: us }, { data: ub }] = await Promise.all([
      db.from('series').select('id').in('universe_id', u),
      db.from('book_universes').select('book_id').in('universe_id', u),
    ])
    for (const r of us ?? []) seriesIds.push(r.id as string)
    for (const r of ub ?? []) ids.add(r.book_id as string)
  }
  if (seriesIds.length) {
    const { data: books } = await db.from('series_books').select('book_id').in('series_id', [...new Set(seriesIds)])
    for (const r of books ?? []) ids.add(r.book_id as string)
  }
  return [...ids]
}
