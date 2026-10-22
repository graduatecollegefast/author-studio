import type { CSSProperties } from 'react'
import { chrome, modes, type ChromeTokens, type ModeTokens, type WritingMode } from './tokens'

const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()

function declarations(tokens: ChromeTokens): string {
  return Object.entries(tokens)
    .map(([k, v]) => `--${kebab(k)}:${v};`)
    .join('')
}

/** CSS for the app chrome in both themes. Injected once at startup. */
export function chromeStylesheet(): string {
  return `:root{${declarations(chrome.light)}color-scheme:light}.dark{${declarations(chrome.dark)}color-scheme:dark}`
}

export function installChromeStyles() {
  if (typeof document === 'undefined' || document.getElementById('creative-flow-tokens')) return
  const el = document.createElement('style')
  el.id = 'creative-flow-tokens'
  el.textContent = chromeStylesheet()
  document.head.prepend(el)
}

const MODE_VARS: Record<keyof Omit<ModeTokens, 'label' | 'description' | 'chrome'>, string> = {
  surround: '--m-surround',
  bar: '--m-bar',
  barFg: '--m-bar-fg',
  barMuted: '--m-bar-muted',
  barLine: '--m-bar-line',
  paper: '--paper',
  paperFg: '--paper-fg',
  paperMuted: '--paper-muted',
  accent: '--m-accent',
  accentText: '--m-accent-text',
  accentOnPaper: '--m-accent-paper',
  selection: '--m-selection',
  progress: '--m-progress',
  alertText: '--m-alert-text',
}

/** Inline CSS variables for a writing mode, applied to the Writing Studio root. */
export function modeStyle(mode: WritingMode): CSSProperties {
  const t = modes[mode]
  const style: Record<string, string> = {}
  for (const [key, cssVar] of Object.entries(MODE_VARS)) style[cssVar] = t[key as keyof typeof MODE_VARS]
  // Panels inside the studio follow the mode (dark panels on navy, light panels for review).
  for (const [key, value] of Object.entries(chrome[t.chrome])) style[`--${kebab(key)}`] = value
  return style as CSSProperties
}
