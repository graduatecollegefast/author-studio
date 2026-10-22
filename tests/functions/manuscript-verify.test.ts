import verify, { readObjectHead } from '../../netlify/functions/manuscript-verify'

describe('manuscript-verify function', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects requests without a session', async () => {
    process.env.SUPABASE_URL = 'http://localhost:1'
    process.env.SUPABASE_ANON_KEY = 'anon'
    const res = await verify(new Request('http://x/', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(401)
  })

  it('rejects wrong methods', async () => {
    const res = await verify(new Request('http://x/', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('reads only the head of an object and the total size from Content-Range', async () => {
    const body = new Uint8Array(10000).fill(65)
    globalThis.fetch = vi.fn(async (_url, init) => {
      expect((init?.headers as Record<string, string>).Range).toBe('bytes=0-4095')
      return new Response(body.subarray(0, 4096), { status: 206, headers: { 'content-range': 'bytes 0-4095/10000' } })
    }) as typeof fetch
    const { head, size } = await readObjectHead('http://storage/obj', 't', 'k')
    expect(size).toBe(10000)
    expect(head.length).toBe(4096)
  })

  it('handles servers that ignore Range', async () => {
    const body = new Uint8Array(9000).fill(66)
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-length': '9000' } })) as typeof fetch
    const { head, size } = await readObjectHead('http://storage/obj', 't', 'k')
    expect(size).toBe(9000)
    expect(head.length).toBe(4096)
  })

  it('reports missing objects', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 400 })) as typeof fetch
    await expect(readObjectHead('http://storage/obj', 't', 'k')).rejects.toThrow(/not found/)
  })
})
