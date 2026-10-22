import * as React from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Bold,
  CheckCircle2,
  CloudOff,
  Heading2,
  Italic,
  Loader2,
  Minus,
  Quote,
  Redo2,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatRelative } from '@/lib/utils'
import type { Scene, TiptapDoc } from '@/types/db'
import type { AutosaveState } from '@/lib/autosave'
import { createCheckpoint, getScene } from '@/services/chapters'
import { qk } from '@/hooks/queries'
import { recoveryBuffer, useSceneAutosave, type RecoveredDraft } from './useSceneAutosave'

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export interface SceneEditorHandle {
  flush: () => Promise<void>
  revision: () => number
  replaceContent: (content: TiptapDoc, revision: number) => void
}

interface Props {
  scene: Scene
  paperDark: boolean
  onWordsChange?: (words: number) => void
  onSaved?: () => void
}

function ToolbarButton({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-panel-2 hover:text-fg disabled:opacity-40 [&_svg]:size-4',
        active && 'bg-plum-soft text-plum-strong',
      )}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h2: e.isActive('heading', { level: 2 }),
      quote: e.isActive('blockquote'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
      <ToolbarButton label="Bold (Ctrl+B)" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolbarButton>
      <ToolbarButton label="Italic (Ctrl+I)" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </ToolbarButton>
      <ToolbarButton label="Heading" active={s.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton label="Block quote" active={s.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote />
      </ToolbarButton>
      <ToolbarButton label="Insert scene break" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <ToolbarButton label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton label="Redo (Ctrl+Shift+Z)" disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 />
      </ToolbarButton>
    </div>
  )
}

export function SaveIndicator({ state, onRetry }: { state: AutosaveState; onRetry: () => void }) {
  const [, tick] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => {
    const t = setInterval(tick, 15000)
    return () => clearInterval(t)
  }, [])

  const base = 'inline-flex items-center gap-1.5 text-xs font-medium'
  switch (state.status) {
    case 'saving':
      return (
        <span className={cn(base, 'text-fg-muted')} role="status" data-testid="save-status" data-status="saving">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving...
        </span>
      )
    case 'dirty':
      return (
        <span className={cn(base, 'text-fg-muted')} role="status" data-testid="save-status" data-status="dirty">
          <span className="size-2 rounded-full bg-amber" aria-hidden /> Unsaved changes
        </span>
      )
    case 'error':
      return (
        <span className={cn(base, 'text-danger')} role="alert" data-testid="save-status" data-status="error">
          <CloudOff className="size-3.5" aria-hidden /> Not saved. Retrying{state.retryInMs ? ` in ${Math.round(state.retryInMs / 1000)}s` : ''}.
          <button type="button" className="underline" onClick={onRetry}>
            Retry now
          </button>
        </span>
      )
    case 'conflict':
      return (
        <span className={cn(base, 'text-danger')} role="alert" data-testid="save-status" data-status="conflict">
          <AlertTriangle className="size-3.5" aria-hidden /> Changed elsewhere
        </span>
      )
    case 'saved':
      return (
        <span className={cn(base, 'text-ok')} role="status" data-testid="save-status" data-status="saved">
          <CheckCircle2 className="size-3.5" aria-hidden /> Saved {formatRelative(state.lastSavedAt?.toISOString())}
        </span>
      )
    default:
      return (
        <span className={cn(base, 'text-fg-faint')} data-testid="save-status" data-status="idle">
          All changes saved
        </span>
      )
  }
}

export const SceneEditor = React.forwardRef<SceneEditorHandle, Props>(function SceneEditor(
  { scene, paperDark, onWordsChange, onSaved },
  ref,
) {
  const qc = useQueryClient()
  const { state, controller, update } = useSceneAutosave(scene.id, scene.revision)
  const [recovered, setRecovered] = React.useState<RecoveredDraft | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ code: false, codeBlock: false, link: false, heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: 'Begin writing...' }),
      CharacterCount,
    ],
    content: scene.content,
    editorProps: {
      attributes: {
        class: 'manuscript min-h-[60vh]',
        'aria-label': `Manuscript: ${scene.title}`,
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: e }) => {
      update({ content: e.getJSON() as TiptapDoc, text: e.getText({ blockSeparator: '\n\n' }) })
      onWordsChange?.(e.storage.characterCount.words())
    },
  })

  // Report the initial word count once the editor exists.
  React.useEffect(() => {
    if (editor) onWordsChange?.(editor.storage.characterCount.words())
  }, [editor, onWordsChange])

  // Offer back any edits that never reached the server.
  React.useEffect(() => {
    const draft = recoveryBuffer.read(scene.id)
    if (!draft) return
    // Compare canonically: Postgres jsonb reorders object keys.
    const same = stableStringify(draft.content) === stableStringify(scene.content)
    if (same) recoveryBuffer.clear(scene.id)
    else setRecovered(draft)
  }, [scene.id, scene.content])

  // Refresh word counts elsewhere after saves land.
  const lastSaved = state.lastSavedAt?.getTime()
  React.useEffect(() => {
    if (lastSaved) onSaved?.()
  }, [lastSaved, onSaved])

  React.useImperativeHandle(
    ref,
    () => ({
      flush: () => controller.flush(),
      revision: () => controller.state.revision,
      replaceContent: (content, revision) => {
        editor?.commands.setContent(content, { emitUpdate: false })
        controller.reset(revision)
        recoveryBuffer.clear(scene.id)
        onWordsChange?.(editor?.storage.characterCount.words() ?? 0)
      },
    }),
    [controller, editor, scene.id, onWordsChange],
  )

  async function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      await controller.flush()
      if (controller.state.status === 'saved' || controller.state.status === 'idle') toast.success('Saved')
    }
  }

  async function resolveConflict(choice: 'theirs' | 'mine') {
    try {
      const latest = await getScene(scene.id)
      if (choice === 'theirs') {
        const mine = controller.takePending()
        if (mine) recoveryBuffer.write(scene.id, { ...mine, baseRevision: latest.revision, savedAt: new Date().toISOString() })
        editor?.commands.setContent(latest.content, { emitUpdate: false })
        controller.reset(latest.revision)
        toast.success('Loaded the latest saved version')
      } else {
        // Keep a recoverable copy of the other version before overwriting it.
        await createCheckpoint(scene.id, 'Kept before overwriting with edits from another window')
        controller.reset(latest.revision)
        if (editor) update({ content: editor.getJSON() as TiptapDoc, text: editor.getText({ blockSeparator: '\n\n' }) })
        await controller.flush()
        toast.success('Your version was saved. The other version is in history.')
      }
      qc.invalidateQueries({ queryKey: qk.versions(scene.id) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resolve the conflict')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ink/95 px-4 py-2 backdrop-blur">
        {editor ? <Toolbar editor={editor} /> : <span />}
        <SaveIndicator state={state} onRetry={() => controller.retry()} />
      </div>

      {state.status === 'conflict' && (
        <div role="alert" className="mx-auto mt-4 w-full max-w-3xl rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <p className="font-semibold">This scene was saved from another window or device after you opened it.</p>
          <p className="mt-1">Choose which version to keep. Nothing is lost either way: the other version stays recoverable.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void resolveConflict('theirs')}>
              Load the latest saved version
            </Button>
            <Button size="sm" variant="danger" onClick={() => void resolveConflict('mine')}>
              Keep my version
            </Button>
          </div>
        </div>
      )}

      {recovered && (
        <div role="status" className="mx-auto mt-4 w-full max-w-3xl rounded-lg border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber">
          <p className="font-semibold">Unsaved changes from {formatRelative(recovered.savedAt)} were found on this device.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="amber"
              onClick={() => {
                editor?.commands.setContent(recovered.content, { emitUpdate: false })
                update({ content: recovered.content, text: recovered.text })
                onWordsChange?.(editor?.storage.characterCount.words() ?? 0)
                setRecovered(null)
              }}
            >
              Restore them
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                recoveryBuffer.clear(scene.id)
                setRecovered(null)
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className={cn('flex-1 px-3 py-6 sm:px-8 sm:py-10', paperDark && 'paper-dark')}>
        <div className="mx-auto w-full max-w-[46rem] rounded-xl bg-paper px-6 py-10 shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_40px_-20px_rgba(0,0,0,0.35)] sm:px-14 sm:py-16">
          <EditorContent editor={editor} data-testid="scene-editor" />
        </div>
      </div>
    </div>
  )
})
