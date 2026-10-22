// Usage: node jwt.mjs <secret> <role>  -> prints a long-lived HS256 JWT for that role
import { createHmac } from 'node:crypto'
const [secret, role] = process.argv.slice(2)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase-local', role, iat: now, exp: now + 10 * 365 * 86400 })}`
process.stdout.write(`${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`)
