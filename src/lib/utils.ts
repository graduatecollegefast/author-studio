import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat().format(n ?? 0)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Never'
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000
  if (diff < 10) return 'just now'
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return formatDate(iso)
}

export function countWords(text: string): number {
  const t = text.trim()
  if (!t) return 0
  return t.split(/\s+/).length
}

export function labelize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
