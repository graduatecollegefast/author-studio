export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

/**
 * Wrap a handler with method checks and safe error responses. Error details are
 * logged without request bodies, so manuscript text never reaches logs.
 */
export function handler(methods: string[], fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (!methods.includes(req.method)) return json({ error: 'Method not allowed' }, 405, { Allow: methods.join(', ') })
    try {
      return await fn(req)
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status)
      console.error('Unhandled function error:', err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown')
      return json({ error: 'Something went wrong on the server.' }, 500)
    }
  }
}

export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const text = await req.text()
  if (text.length > maxBytes) throw new HttpError(413, 'Request too large')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
}
