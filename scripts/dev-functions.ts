// Local runner for Netlify Functions (v2 handlers) without the Netlify CLI.
// Serves /.netlify/functions/<name> from netlify/functions/<name>.ts on port 8888.
// `netlify dev` works too; this exists so tests can run fully offline.
import http from 'node:http'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const port = Number(process.env.FUNCTIONS_PORT ?? 8888)
const dir = path.resolve('netlify/functions')

http
  .createServer(async (req, res) => {
    const m = /^\/\.netlify\/functions\/([\w-]+)/.exec(req.url ?? '')
    const file = m && path.join(dir, `${m[1]}.ts`)
    if (!m || !file || m[1].startsWith('_') || !existsSync(file)) {
      res.writeHead(404).end('Function not found')
      return
    }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    })
    const mod = await import(pathToFileURL(file).href)
    const response: Response = await mod.default(request, {})
    const headers: Record<string, string> = {}
    response.headers.forEach((v, k) => (headers[k] = v))
    res.writeHead(response.status, headers)
    res.end(Buffer.from(await response.arrayBuffer()))
  })
  .listen(port, () => console.log(`functions listening on ${port}`))
