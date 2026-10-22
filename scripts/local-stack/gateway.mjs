// Tiny stand-in for Supabase's API gateway: routes /auth/v1, /rest/v1 and
// /storage/v1 to the local services and adds CORS headers.
import http from 'node:http'

const routes = [
  ['/auth/v1', 'http://127.0.0.1:9999'],
  ['/rest/v1', 'http://127.0.0.1:3000'],
  ['/storage/v1', 'http://127.0.0.1:5000'],
]
const port = Number(process.env.GATEWAY_PORT ?? 54321)

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, range, prefer, accept-profile, content-profile, x-upsert, cache-control, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'content-range, content-length, etag, x-total-count',
}

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      return res.end()
    }
    const match = routes.find(([prefix]) => req.url.startsWith(prefix + '/') || req.url === prefix)
    if (!match) {
      res.writeHead(404, cors)
      return res.end('not found')
    }
    const [prefix, target] = match
    const url = new URL(req.url.slice(prefix.length) || '/', target)
    const headers = { ...req.headers, host: url.host }
    // PostgREST and Storage expect the JWT in Authorization; supabase-js always sends apikey too.
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`
    const upstream = http.request(url, { method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors })
      up.pipe(res)
    })
    upstream.on('error', (e) => {
      res.writeHead(502, cors)
      res.end(String(e))
    })
    req.pipe(upstream)
  })
  .listen(port, () => console.log(`gateway listening on ${port}`))
