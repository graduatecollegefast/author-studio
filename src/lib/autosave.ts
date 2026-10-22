// Debounced, single-flight autosave with retries and conflict detection.
// Framework-free so it can be unit tested with fake timers.

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

export interface AutosaveState {
  status: AutosaveStatus
  revision: number
  lastSavedAt: Date | null
  error: string | null
  retryInMs: number | null
}

export class ConflictError extends Error {
  constructor(message = 'This scene was changed somewhere else since you opened it.') {
    super(message)
    this.name = 'ConflictError'
  }
}

export interface AutosaveOptions<T> {
  revision: number
  save: (payload: T, expectedRevision: number) => Promise<{ revision: number }>
  onChange?: (state: AutosaveState) => void
  delayMs?: number
  maxRetryDelayMs?: number
}

export class AutosaveController<T> {
  private pending: T | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private attempt = 0
  private disposed = false
  private readonly delayMs: number
  private readonly maxRetryDelayMs: number
  state: AutosaveState

  constructor(private readonly opts: AutosaveOptions<T>) {
    this.delayMs = opts.delayMs ?? 1200
    this.maxRetryDelayMs = opts.maxRetryDelayMs ?? 30000
    this.state = { status: 'idle', revision: opts.revision, lastSavedAt: null, error: null, retryInMs: null }
  }

  get hasUnsavedChanges(): boolean {
    return this.pending !== null || this.inFlight !== null
  }

  /** Record new editor content and schedule a debounced save. */
  update(payload: T) {
    if (this.disposed || this.state.status === 'conflict') {
      this.pending = payload
      return
    }
    this.pending = payload
    this.attempt = 0
    this.set({ status: this.inFlight ? 'saving' : 'dirty', retryInMs: null })
    this.schedule(this.delayMs)
  }

  /** Save immediately (used for Ctrl+S, checkpoints, and leaving the page). */
  async flush(): Promise<void> {
    this.clearTimer()
    if (this.inFlight) await this.inFlight
    if (this.pending !== null && this.state.status !== 'conflict') await this.run()
  }

  /** Retry right away after an error. */
  retry() {
    if (this.state.status === 'conflict') return
    this.attempt = 0
    this.clearTimer()
    void this.run()
  }

  /** Accept a new server revision (after resolving a conflict or restoring a version). */
  reset(revision: number) {
    this.clearTimer()
    this.pending = null
    this.attempt = 0
    this.set({ status: 'idle', revision, error: null, retryInMs: null })
  }

  takePending(): T | null {
    return this.pending
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
  }

  private schedule(ms: number) {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, ms)
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async run(): Promise<void> {
    if (this.inFlight) {
      // A save is already running; the latest content will be saved when it finishes.
      return this.inFlight
    }
    const payload = this.pending
    if (payload === null) return
    this.pending = null
    this.set({ status: 'saving', error: null, retryInMs: null })

    this.inFlight = (async () => {
      try {
        const result = await this.opts.save(payload, this.state.revision)
        this.attempt = 0
        this.set({
          revision: result.revision,
          lastSavedAt: new Date(),
          status: this.pending !== null ? 'dirty' : 'saved',
          error: null,
        })
      } catch (err) {
        // Put the unsaved content back unless something newer arrived meanwhile.
        if (this.pending === null) this.pending = payload
        if (err instanceof ConflictError) {
          this.set({ status: 'conflict', error: err.message, retryInMs: null })
          return
        }
        this.attempt++
        const wait = Math.min(this.maxRetryDelayMs, 1000 * 2 ** this.attempt)
        this.set({
          status: 'error',
          error: err instanceof Error ? err.message : 'Save failed',
          retryInMs: wait,
        })
        if (!this.disposed) this.schedule(wait)
      } finally {
        this.inFlight = null
      }
    })()

    await this.inFlight
    if (this.pending !== null && this.state.status === 'dirty' && !this.timer && !this.disposed) {
      this.schedule(this.delayMs)
    }
  }

  private set(patch: Partial<AutosaveState>) {
    this.state = { ...this.state, ...patch }
    this.opts.onChange?.(this.state)
  }
}
