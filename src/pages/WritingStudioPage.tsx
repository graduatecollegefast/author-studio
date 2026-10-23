import * as React from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Expand, PanelLeft, PanelRight, Shrink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback'
import { Outline } from '@/components/editor/Outline'
import { SceneEditor, type SceneEditorHandle } from '@/components/editor/SceneEditor'
import { StudioSidePanel } from '@/components/editor/StudioSidePanel'
import { ModeSwitcher, TypographyMenu, WordProgress } from '@/components/editor/StudioControls'
import { qk, useBook, useChapters, useDailyStats, useSceneMeta } from '@/hooks/queries'
import { createChapter, getScene } from '@/services/chapters'
import { markOpened } from '@/services/books'
import { localDateString, netWords } from '@/services/progress'
import { PAGE_WIDTHS, usePreferences } from '@/contexts/PreferencesContext'
import { modeStyle } from '@/styles/applyTheme'
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

/** Words at the start of this browser session for a book, so the session counter survives reloads. */
function sessionBaseline(bookId: string, current: number): number {
  const key = `author-studio:session:${bookId}`
  try {
    const raw = sessionStorage.getItem(key)
    if (raw !== null) return Number(raw)
    sessionStorage.setItem(key, String(current))
  } catch {
    // ignore
  }
  return current
}

export function WritingStudioPage() {
  const { bookId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const { prefs } = usePreferences()
  const daily = useDailyStats()
  const baseline = React.useRef<number | null>(null)
  const book = useBook(bookId)
  const chapters = useChapters(bookId)
  const scenes = useSceneMeta(bookId)
  const editorRef = React.useRef<SceneEditorHandle>(null)
  const [panels, setPanelsState] = React.useState(readPanels)
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
    qc.invalidateQueries({ queryKey: qk.daily })
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
  const unsavedDelta = sceneWords - savedSceneWords
  const chapterWords = (activeChapter?.word_count ?? 0) + unsavedDelta
  const bookWords = book.data.word_count + unsavedDelta
  const target = book.data.target_word_count
  if (baseline.current === null) baseline.current = sessionBaseline(bookId, book.data.word_count)
  const sessionWords = bookWords - baseline.current
  const todayStat = daily.data?.find((d) => d.day === localDateString())
  const todayWords = Math.max(0, netWords(todayStat) + unsavedDelta)

  const mode = prefs.writingMode
  const focus = mode === 'focus'
  const showLeft = panels.left && !focus
  const showRight = panels.right && !focus
  const typography = { size: prefs.manuscriptSize, leading: prefs.lineSpacing, width: PAGE_WIDTHS[prefs.pageWidth] }
  const barButton = 'grid size-9 place-items-center rounded-md text-m-bar-muted hover:text-m-bar-fg [&_svg]:size-4'

  return (
    <div className="flex h-dvh flex-col bg-m-surround text-fg" style={modeStyle(mode)} data-mode={mode}>
      <header className={cn('flex h-12 shrink-0 items-center gap-1 px-2 sm:px-3', focus ? 'bg-m-surround' : 'border-b border-m-bar-line bg-m-bar')}>
        <Link to={`/books/${bookId}`} aria-label="Back to book" className={barButton}>
          <ArrowLeft />
        </Link>
        {!focus && (
          <button
            type="button"
            aria-label={panels.left ? 'Hide outline' : 'Show outline'}
            aria-pressed={panels.left}
            onClick={() => setPanels({ ...panels, left: !panels.left })}
            className={cn(barButton, 'hidden md:grid')}
          >
            <PanelLeft />
          </button>
        )}
        <div className="min-w-0 flex-1 truncate px-1 text-sm">
          {!focus && (
            <>
              <span className="font-serif font-semibold text-m-bar-fg">{book.data.title}</span>
              {activeChapter && (
                <span className="text-m-bar-muted">
                  {' '}
                  · {/^chapter\b/i.test(activeChapter.title) ? activeChapter.title : `Chapter ${activeChapterIndex + 1}: ${activeChapter.title}`} ·{' '}
                  {activeMeta?.title}
                </span>
              )}
            </>
          )}
        </div>
        <ModeSwitcher compact />
        <TypographyMenu />
        <button type="button" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => void toggleFullscreen()} className={barButton}>
          {fullscreen ? <Shrink /> : <Expand />}
        </button>
        {!focus && (
          <button
            type="button"
            aria-label={panels.right ? 'Hide side panel' : 'Show side panel'}
            aria-pressed={panels.right}
            onClick={() => setPanels({ ...panels, right: !panels.right })}
            className={barButton}
          >
            <PanelRight />
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {showLeft && (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-m-bar-line bg-ink-2 p-4 md:block">
            <Outline bookId={bookId} chapters={chapterList} scenes={sceneList} activeSceneId={activeSceneId} onSelect={selectScene} />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {!focus && sceneList.length > 0 && (
            <div className="border-b border-m-bar-line bg-m-bar p-2 md:hidden">
              <label htmlFor="mobile-scene" className="sr-only">
                Scene
              </label>
              <select
                id="mobile-scene"
                className="h-10 w-full rounded-lg border border-control bg-panel px-3 text-sm text-fg"
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
              minimal={focus}
              typography={typography}
              onWordsChange={setLiveWords}
              onSaved={onSaved}
            />
          )}

          {activeSceneId && (
            <footer
              className={cn(
                'sticky bottom-0 flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-xs text-m-bar-muted',
                focus ? 'bg-m-surround' : 'border-t border-m-bar-line bg-m-bar',
              )}
            >
              <WordProgress sessionWords={sessionWords} todayWords={todayWords} goal={prefs.dailyWordGoal} />
              {!focus && (
                <>
                  <span>
                    Scene <strong className="text-m-bar-fg" data-testid="scene-words">{formatNumber(sceneWords)}</strong>
                  </span>
                  <span>
                    Chapter <strong className="text-m-bar-fg">{formatNumber(chapterWords)}</strong>
                  </span>
                  <span>
                    Book <strong className="text-m-bar-fg">{formatNumber(bookWords)}</strong>
                    {target ? ` / ${formatNumber(target)}` : ''}
                  </span>
                  <span className="ml-auto hidden xl:inline">Ctrl+S saves now · Ctrl+B bold · Ctrl+I italic</span>
                </>
              )}
            </footer>
          )}
        </div>

        {showRight && activeSceneId && activeMeta && (
          <aside
            aria-label="Side panel"
            className="w-96 max-w-full shrink-0 overflow-y-auto border-l border-m-bar-line bg-ink-2 p-4 max-lg:fixed max-lg:inset-y-12 max-lg:right-0 max-lg:z-30 max-lg:shadow-2xl"
          >
            <StudioSidePanel
              book={book.data}
              sceneId={activeSceneId}
              chapterId={activeMeta.chapter_id}
              sceneText={scene.data?.content_text ?? ''}
              editorRef={editorRef}
              onOpenScene={selectScene}
            />
          </aside>
        )}
      </div>
    </div>
  )
}
