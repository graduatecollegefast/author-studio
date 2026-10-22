import * as React from 'react'
import { AutosaveController, type AutosaveState } from '@/lib/autosave'
import { saveScene, type ScenePayload } from '@/services/chapters'

const DRAFT_PREFIX = 'author-studio:draft:'

export interface RecoveredDraft extends ScenePayload {
  baseRevision: number
  savedAt: string
}

/**
 * Crash-recovery buffer. Supabase is the source of truth; this only holds edits
 * that have not reached the server yet, so they can be offered back after a
 * crash, closed tab, or lost connection.
 */
export const recoveryBuffer = {
  write(sceneId: string, draft: RecoveredDraft) {
    try {
      localStorage.setItem(DRAFT_PREFIX + sceneId, JSON.stringify(draft))
    } catch {
      // storage full or unavailable: autosave still works
    }
  },
  read(sceneId: string): RecoveredDraft | null {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + sceneId)
      return raw ? (JSON.parse(raw) as RecoveredDraft) : null
    } catch {
      return null
    }
  },
  clear(sceneId: string) {
    try {
      localStorage.removeItem(DRAFT_PREFIX + sceneId)
    } catch {
      // ignore
    }
  },
}

export function useSceneAutosave(sceneId: string, initialRevision: number) {
  const [state, setState] = React.useState<AutosaveState>({
    status: 'idle',
    revision: initialRevision,
    lastSavedAt: null,
    error: null,
    retryInMs: null,
  })

  const controllerRef = React.useRef<AutosaveController<ScenePayload> | null>(null)
  if (controllerRef.current === null) {
    controllerRef.current = new AutosaveController<ScenePayload>({
      revision: initialRevision,
      save: (payload, rev) => saveScene(sceneId, payload, rev),
      onChange: (s) => {
        setState(s)
        if (s.status === 'saved') recoveryBuffer.clear(sceneId)
      },
    })
  }
  const controller = controllerRef.current

  // Warn before closing the tab with unsaved work, and try to flush it.
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsavedChanges) {
        void controller.flush()
        e.preventDefault()
        e.returnValue = ''
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void controller.flush()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibility)
      // Leaving the scene: save whatever is pending. (Not disposed, so React
      // StrictMode's mount/unmount/mount cycle keeps a working controller.)
      void controller.flush()
    }
  }, [controller])

  const update = React.useCallback(
    (payload: ScenePayload) => {
      recoveryBuffer.write(sceneId, { ...payload, baseRevision: controller.state.revision, savedAt: new Date().toISOString() })
      controller.update(payload)
    },
    [controller, sceneId],
  )

  return { state, controller, update }
}
