import { useQuery } from '@tanstack/react-query'
import { getBook, listBooks } from '@/services/books'
import { listManuscripts, listRecentUploads } from '@/services/manuscripts'
import { lastEditedScene, listChapters, listSceneMeta } from '@/services/chapters'
import { getDashboardStats } from '@/services/dashboard'

export const qk = {
  books: ['books'] as const,
  book: (id: string) => ['book', id] as const,
  manuscripts: (bookId: string) => ['manuscripts', bookId] as const,
  recentUploads: ['recent-uploads'] as const,
  chapters: (bookId: string) => ['chapters', bookId] as const,
  scenes: (bookId: string) => ['scenes', bookId] as const,
  scene: (id: string) => ['scene', id] as const,
  versions: (sceneId: string) => ['versions', sceneId] as const,
  dashboard: ['dashboard'] as const,
  lastEdited: ['last-edited'] as const,
}

export const useBooks = () => useQuery({ queryKey: qk.books, queryFn: listBooks })
export const useBook = (id: string) => useQuery({ queryKey: qk.book(id), queryFn: () => getBook(id) })
export const useManuscripts = (bookId: string) =>
  useQuery({ queryKey: qk.manuscripts(bookId), queryFn: () => listManuscripts(bookId) })
export const useRecentUploads = () => useQuery({ queryKey: qk.recentUploads, queryFn: () => listRecentUploads(5) })
export const useChapters = (bookId: string) => useQuery({ queryKey: qk.chapters(bookId), queryFn: () => listChapters(bookId) })
export const useSceneMeta = (bookId: string) => useQuery({ queryKey: qk.scenes(bookId), queryFn: () => listSceneMeta(bookId) })
export const useDashboardStats = () => useQuery({ queryKey: qk.dashboard, queryFn: getDashboardStats })
export const useLastEdited = () => useQuery({ queryKey: qk.lastEdited, queryFn: lastEditedScene })
