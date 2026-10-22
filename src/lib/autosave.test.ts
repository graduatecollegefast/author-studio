import { AutosaveController, ConflictError } from './autosave'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AutosaveController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces rapid edits into one save with the latest content', async () => {
    const save = vi.fn(async (_p: string, rev: number) => ({ revision: rev + 1 }))
    const c = new AutosaveController<string>({ revision: 1, save, delayMs: 1000 })
    c.update('a')
    c.update('ab')
    c.update('abc')
    expect(c.state.status).toBe('dirty')
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('abc', 1)
    expect(c.state.status).toBe('saved')
    expect(c.state.revision).toBe(2)
    expect(c.hasUnsavedChanges).toBe(false)
  })

  it('never runs two saves at once and saves edits made during a save', async () => {
    const first = deferred<{ revision: number }>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ revision: 3 })
    const c = new AutosaveController<string>({ revision: 1, save, delayMs: 100 })
    c.update('one')
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(1)
    c.update('two')
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1) // still waiting for the first save
    first.resolve({ revision: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.state.status).toBe('dirty')
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('two', 2)
    expect(c.state.revision).toBe(3)
  })

  it('keeps unsaved content and retries with backoff after a failure', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ revision: 2 })
    const c = new AutosaveController<string>({ revision: 1, save, delayMs: 100 })
    c.update('draft')
    await vi.advanceTimersByTimeAsync(100)
    expect(c.state.status).toBe('error')
    expect(c.state.retryInMs).toBe(2000)
    expect(c.hasUnsavedChanges).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(c.state.retryInMs).toBe(4000)
    await vi.advanceTimersByTimeAsync(4000)
    expect(save).toHaveBeenCalledTimes(3)
    expect(save).toHaveBeenLastCalledWith('draft', 1)
    expect(c.state.status).toBe('saved')
  })

  it('stops on a revision conflict and does not overwrite', async () => {
    const save = vi.fn().mockRejectedValue(new ConflictError())
    const c = new AutosaveController<string>({ revision: 4, save, delayMs: 100 })
    c.update('mine')
    await vi.advanceTimersByTimeAsync(100)
    expect(c.state.status).toBe('conflict')
    c.update('more')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(c.takePending()).toBe('more')
  })

  it('flush saves immediately without waiting for the debounce', async () => {
    const save = vi.fn(async () => ({ revision: 9 }))
    const c = new AutosaveController<string>({ revision: 8, save, delayMs: 10_000 })
    c.update('now')
    await c.flush()
    expect(save).toHaveBeenCalledWith('now', 8)
    expect(c.state.revision).toBe(9)
  })

  it('reset adopts a new server revision and drops pending edits', async () => {
    const save = vi.fn(async (_p: string, rev: number) => ({ revision: rev + 1 }))
    const c = new AutosaveController<string>({ revision: 1, save, delayMs: 100 })
    c.update('x')
    c.reset(7)
    await vi.advanceTimersByTimeAsync(200)
    expect(save).not.toHaveBeenCalled()
    c.update('y')
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledWith('y', 7)
  })
})
