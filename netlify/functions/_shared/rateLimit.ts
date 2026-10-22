import { HttpError } from './http'

// Best-effort, per-instance limiter. Serverless instances do not share memory,
// so this blunts bursts rather than enforcing a global quota.
const buckets = new Map<string, { tokens: number; updated: number }>()

export function rateLimit(key: string, capacity = 30, refillPerSecond = 0.5) {
  const now = Date.now()
  const b = buckets.get(key) ?? { tokens: capacity, updated: now }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updated) / 1000) * refillPerSecond)
  b.updated = now
  if (b.tokens < 1) {
    buckets.set(key, b)
    throw new HttpError(429, 'Too many requests. Wait a moment and try again.')
  }
  b.tokens -= 1
  buckets.set(key, b)
}
