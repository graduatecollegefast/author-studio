import * as React from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Expand, Focus, History, Moon, PanelLeft, PanelRight, Shrink, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback'
import { Outline } from '@/components/editor/Outline'
import { SceneEditor, type SceneEditorHandle } from '@/components/editor/SceneEditor'
import { VersionHistory } from '@/components/editor/VersionHistory'
import { qk, useBook, useChapters, useSceneMeta } from '@/hooks/queries'
import { createChapter, getScene } from '@/services/chapters'
import { markOpened } from '@/services/books'
import { usePreferences } from '@/contexts/PreferencesContext'
import { cn, formatNumber } from '@/lib/utils'

const PANEL_KEY = 'author-studio:studio-panels'

function readPanels(): { left: boolean; right: boolean } {
  try {
    const raw = localStorage.getItem(PANEL_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return { left: true, right: false }
}

export function WritingStudioPage() {
  const { bookId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const { prefs, setPrefs } = usePreferences()
  const book = useBook(bookId)
  const chapters = useChapters(bookId)
  const scenes = useSceneMeta(bookId)
  const editorRef = React.useRef<SceneEditorHandle>(null)
  const [panels, setPanelsState] = React.useState(readPanels)
  const [focus, setFocus] = React.useState(false)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [liveWords, setLiveWords] = React.useState<number | null>(null)
  const [creatingFirst, setCreatingFirst] = React.useState(false)

  const setPanels = (next: { left: boolean; right: boolean }) => {
    setPanelsState(next)
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  React.useEffect(() => {
    if (bookId) void markOpened(bookId).catch(() => undefined)
  }, [bookId])

  React.useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Resolve which scene to open: ?scene=, else first scene of ?chapter=, else most recently edited, else first.
  const sceneList = scenes.data ?? []
  const chapterList = chapters.data ?? []
  const requestedScene = params.get('scene')
  const requestedChapter = params.get('chapter')
  const activeSceneId = React.useMemo(() => {
    if (!sceneList.length) return null
    if (requestedScene && sceneList.some((s) => s.id === requestedScene)) return requestedScene
    const orderOf = (chapterId: string) => chapterList.find((c) => c.id === chapterId)?.position ?? 0
    const ordered = [...sceneList].sort((a, b) => orderOf(a.chapter_id) - orderOf(b.chapter_id) || a.position - b.position)
    if (requestedChapter) {
      const first = ordered.find((s) => s.chapter_id === requestedChapter)
      if (first) return first.id
    }
    const recent = [...sceneList].filter((s) => s.last_edited_at).sort((a, b) => b.last_edited_at!.localeCompare(a.last_edited_at!))[0]
    return (recent ?? ordered[0]).id
  }, [sceneList, chapterList, requestedScene, requestedChapter])

  const scene = useQuery({
    queryKey: qk.scene(activeSceneId ?? 'none'),
    queryFn: () => getScene(activeSceneId!),
    enabled: Boolean(activeSceneId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const activeMeta = sceneList.find((s) => s.id === activeSceneId)
  const activeChapter = chapterList.find((c) => c.id === activeMeta?.chapter_id)
  const activeChapterIndex = chapterList.findIndex((c) => c.id === activeMeta?.chapter_id)

  const selectScene = React.useCallback(
    (id: string) => {
      setLiveWords(null)
      setParams({ scene: id }, { replace: false })
    },
    [setParams],
  )

  const onSaved = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: qk.scenes(bookId) })
    qc.invalidateQueries({ queryKey: qk.chapters(bookId) })
    qc.invalidateQueries({ queryKey: qk.book(bookId) })
    qc.invalidateQueries({ queryKey: qk.versions(activeSceneId ?? '') })
  }, [qc, bookId, activeSceneId])

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      // Fullscreen not available (for example inside an embedded preview)
    }
  }

  if (book.isLoading || chapters.isLoading || scenes.isLoading) return <PageLoader label="Opening Writing Studio" />
  const loadError = book.error ?? chapters.error ?? scenes.error
  if (loadError || !book.data)
    return (
      <div className="p-8">
        <ErrorState error={loadError ?? new Error('Book not found')} />
      </div>
    )

  // Word counts: the active scene is counted live; everything else from the last save.
  const savedSceneWords = activeMeta?.word_count ?? 0
  const sceneWords = liveWords ?? savedSceneWords
  const chapterWords = (activeChapter?.word_count ?? 0) - savedSceneWords + sceneWords
  const bookWords = book.data.word_count - savedSceneWords + sceneWords
  const target = book.data.target_word_count

  const showLeft = panels.left && !focus
  const showRight = panels.right && !focus

  return (
    <div className="flex h-dvh flex-col bg-ink">
      {/* Top bar */}
      <header className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-line bg-ink-2 px-3', focus && 'opacity-40 transition-opacity hover:opacity-100')}>
        <Button asChild variant="ghost" size="sm">
          <Link to={`/books/${bookId}`} aria-label="Back to book">
            <ArrowLeft />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={panels.left ? 'Hide outline' : 'Show outline'}
          aria-pressed={panels.left}
          onClick={() => setPanels({ ...panels, left: !panels.left })}
          className="hidden md:inline-flex"
        >
          <PanelLeft />
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm">
          <span className="font-serif font-semibold text-fg">{book.data.title}</span>
          {activeChapter && (
            <span className="text-fg-muted">
              {' '}
              · {/^chapter\b/i.test(activeChapter.title) ? activeChapter.title : `Chapter ${activeChapterIndex + 1}: ${activeChapter.title}`} ·{' '}
              {activeMeta?.title}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" aria-label="Toggle dark writing surface" aria-pressed={prefs.paperDark} onClick={() => setPrefs({ paperDark: !prefs.paperDark })}>
          {prefs.paperDark ? <Sun /> : <Moon />}
        </Button>
        <Button variant="ghost" size="icon" aria-label={focus ? 'Exit focus mode' : 'Focus mode'} aria-pressed={focus} onClick={() => setFocus(!focus)}>
          <Focus />
        </Button>
        <Button variant="ghost" size="icon" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Shrink /> : <Expand />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={panels.right ? 'Hide history panel' : 'Show history panel'}
          aria-pressed={panels.right}
          onClick={() => setPanels({ ...panels, right: !panels.right })}
        >
          {panels.right ? <PanelRight /> : <History />}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {showLeft && (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-line bg-ink-2 p-4 md:block">
            <Outline bookId={bookId} chapters={chapterList} scenes={sceneList} activeSceneId={activeSceneId} onSelect={selectScene} />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {/* Small screens: scene picker in place of the side panel */}
          {!focus && sceneList.length > 0 && (
            <div className="border-b border-line p-2 md:hidden">
              <label htmlFor="mobile-scene" className="sr-only">
                Scene
              </label>
              <select
                id="mobile-scene"
                className="h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
                value={activeSceneId ?? ''}
                onChange={(e) => selectScene(e.target.value)}
              >
                {chapterList.map((c, i) => (
                  <optgroup key={c.id} label={`${i + 1}. ${c.title}`}>
                    {sceneList
                      .filter((s) => s.chapter_id === c.id)
                      .sort((a, b) => a.position - b.position)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {!activeSceneId ? (
            <div className="p-8">
              <EmptyState
                title="No chapters yet"
                action={
                  <Button
                    disabled={creatingFirst}
                    onClick={async () => {
                      setCreatingFirst(true)
                      try {
                        await createChapter(bookId)
                        await Promise.all([
                          qc.refetchQueries({ queryKey: qk.chapters(bookId) }),
                          qc.refetchQueries({ queryKey: qk.scenes(bookId) }),
                        ])
                      } finally {
                        setCreatingFirst(false)
                      }
                    }}
                  >
                    Start Chapter 1
                  </Button>
                }
              >
                Create the first chapter to start writing.
              </EmptyState>
            </div>
          ) : scene.isLoading ? (
            <PageLoader label="Opening scene" />
          ) : scene.error || !scene.data ? (
            <div className="p-8">
              <ErrorState error={scene.error ?? new Error('Scene not found')} onRetry={() => void scene.refetch()} />
            </div>
          ) : (
            <SceneEditor
              key={scene.data.id}
              ref={editorRef}
              scene={scene.data}
              paperDark={prefs.paperDark}
              onWordsChange={setLiveWords}
              onSaved={onSaved}
            />
          )}

          {/* Status bar */}
          {activeSceneId && (
            <footer className={cn('sticky bottom-0 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-ink-2/95 px-4 py-2 text-xs text-fg-muted backdrop-blur', focus && 'opacity-40 hover:opacity-100')}>
              <span>
                Scene <strong className="text-fg" data-testid="scene-words">{formatNumber(sceneWords)}</strong> words
              </span>
              <span>
                Chapter <strong className="text-fg">{formatNumber(chapterWords)}</strong>
              </span>
              <span>
                Book <strong className="text-fg">{formatNumber(bookWords)}</strong>
                {target ? ` / ${formatNumber(target)} (${Math.min(100, Math.round((bookWords / target) * 100))}%)` : ''}
              </span>
              <span className="ml-auto hidden lg:inline">Ctrl+S saves now · Ctrl+B bold · Ctrl+I italic</span>
            </footer>
          )}
        </div>

        {showRight && activeSceneId && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-ink-2 p-4 max-lg:fixed max-lg:inset-y-12 max-lg:right-0 max-lg:z-30 max-lg:shadow-2xl">
            <VersionHistory sceneId={activeSceneId} editorRef={editorRef} />
          </aside>
        )}
      </div>
    </div>
  )
}
