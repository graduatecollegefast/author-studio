// Creative Flow design tokens. Single source of truth for every color in the app.
// Values are applied as CSS custom properties at runtime (see applyTheme.ts) and
// checked for WCAG AA contrast in tokens.test.ts.
//
// Role rules:
//   ai        Creative Blue: AI creativity features only
//   progress  Sage Green: progress bars, completed goals, successful saves
//   alert     Terracotta: corrections, warnings, destructive actions
//   action    Navy (light) / Ivory (dark): primary buttons
// Base hues are used as fills. Text that sits on a fill, or colored text on a
// surface, uses a darker or lighter derived tone so it meets 4.5:1.

export const palette = {
  deepFocusNavy: '#172638',
  creativeBlue: '#789DB8',
  sageGreen: '#A8BFA7',
  warmIvory: '#FAF7F0',
  softSlate: '#E8EDF0',
  inkCharcoal: '#293443',
} as const

export interface ChromeTokens {
  ink: string // page background
  ink2: string // sidebar / top bars
  panel: string // cards
  panel2: string // hover and subtle fills
  selected: string // selected nav item fill
  line: string // hairlines (decorative)
  control: string // input and control borders (>= 3:1 against panel)
  fg: string
  fgMuted: string
  fgFaint: string // still >= 4.5:1, used for metadata
  action: string
  actionFg: string
  ai: string // AI fill (buttons, chips)
  aiFg: string // text on ai fill
  aiText: string // AI-colored text on panels
  aiSoft: string // subtle AI background
  progress: string // progress fill
  progressText: string
  progressSoft: string
  alert: string // destructive fill
  alertFg: string
  alertText: string
  alertSoft: string
  ring: string
}

export const chrome: Record<'light' | 'dark', ChromeTokens> = {
  light: {
    ink: '#EEF1F3',
    ink2: '#E4E9ED',
    panel: '#FBFAF7',
    panel2: '#F1F3F4',
    selected: '#DCE5EC',
    line: '#D5DCE1',
    control: '#7D8995',
    fg: palette.inkCharcoal,
    fgMuted: '#4B5765',
    fgFaint: '#5A6673',
    action: palette.deepFocusNavy,
    actionFg: palette.warmIvory,
    ai: '#3F6787',
    aiFg: '#FFFFFF',
    aiText: '#365C7A',
    aiSoft: '#E1EAF1',
    progress: '#6F906E',
    progressText: '#466646',
    progressSoft: '#E3ECE2',
    alert: '#A4513A',
    alertFg: '#FFFFFF',
    alertText: '#984A35',
    alertSoft: '#F5E6DF',
    ring: '#3F6787',
  },
  dark: {
    ink: palette.deepFocusNavy,
    ink2: '#132131',
    panel: '#1D2E42',
    panel2: '#24374D',
    selected: '#2C4259',
    line: '#2F4359',
    control: '#73869A',
    fg: palette.warmIvory,
    fgMuted: '#C3CDD6',
    fgFaint: '#A9B6C2',
    action: palette.warmIvory,
    actionFg: palette.deepFocusNavy,
    ai: palette.creativeBlue,
    aiFg: palette.deepFocusNavy,
    aiText: '#9BBAD0',
    aiSoft: '#22384F',
    progress: palette.sageGreen,
    progressText: '#B7CCB6',
    progressSoft: '#253A36',
    alert: '#D69A85',
    alertFg: palette.deepFocusNavy,
    alertText: '#E2AC99',
    alertSoft: '#3A2D2E',
    ring: palette.creativeBlue,
  },
}

export type WritingMode = 'creative' | 'focus' | 'review'

export interface ModeTokens {
  label: string
  description: string
  surround: string // area around the page
  bar: string // top bar and status bar
  barFg: string
  barMuted: string
  barLine: string
  paper: string
  paperFg: string
  paperMuted: string // placeholder, scene-break glyph (>= 4.5:1 on paper)
  accent: string // mode accent on the bars (toggles, active states)
  accentText: string // accent used as text on the bars
  accentOnPaper: string // accent used on the page (quote rule, selection)
  selection: string
  progress: string // sage: goal progress and "saved" state on the bars
  alertText: string // terracotta: save errors and warnings on the bars
  chrome: 'light' | 'dark' // panel colors used inside the studio for this mode
}

export const modes: Record<WritingMode, ModeTokens> = {
  creative: {
    label: 'Creative Drafting',
    description: 'Deep navy framing, warm ivory page, soft blue accents.',
    surround: palette.deepFocusNavy,
    bar: '#132131',
    barFg: palette.warmIvory,
    barMuted: '#B7C3CE',
    barLine: '#2B3E53',
    paper: palette.warmIvory,
    paperFg: palette.inkCharcoal,
    paperMuted: '#5F6A75',
    accent: palette.creativeBlue,
    accentText: '#9BBAD0',
    accentOnPaper: '#4E7697',
    selection: '#D6E3EE',
    progress: palette.sageGreen,
    alertText: '#E2AC99',
    chrome: 'dark',
  },
  focus: {
    label: 'Deep Focus',
    description: 'Muted green-gray surroundings, soft off-white page, sage accents. Panels and notifications hidden.',
    surround: '#46534D',
    bar: '#3F4B45',
    barFg: '#F4F5F0',
    barMuted: '#D2DACF',
    barLine: '#56645D',
    paper: '#F6F6F1',
    paperFg: palette.inkCharcoal,
    paperMuted: '#5E6862',
    accent: palette.sageGreen,
    accentText: '#C3D4C2',
    accentOnPaper: '#5F7F5E',
    selection: '#DDE7DC',
    progress: '#C3D4C2',
    alertText: '#F0C2B2',
    chrome: 'dark',
  },
  review: {
    label: 'Editing & Review',
    description: 'Clean light page, charcoal text, muted terracotta for findings and corrections.',
    surround: palette.softSlate,
    bar: '#F7F8F9',
    barFg: palette.inkCharcoal,
    barMuted: '#4B5765',
    barLine: '#D3DAE0',
    paper: '#FFFFFF',
    paperFg: palette.inkCharcoal,
    paperMuted: '#5F6A75',
    accent: '#A4513A',
    accentText: '#984A35',
    accentOnPaper: '#A4513A',
    selection: '#F3E1D9',
    progress: '#5E7F5D',
    alertText: '#984A35',
    chrome: 'light',
  },
}

export const DEFAULT_MODE: WritingMode = 'creative'

/** Pairs that must meet WCAG AA. [foreground key, background key, minimum ratio] */
export const chromePairs: Array<[keyof ChromeTokens, keyof ChromeTokens, number]> = [
  ['fg', 'ink', 4.5],
  ['fg', 'ink2', 4.5],
  ['fg', 'panel', 4.5],
  ['fg', 'panel2', 4.5],
  ['fg', 'selected', 4.5],
  ['fgMuted', 'ink', 4.5],
  ['fgMuted', 'ink2', 4.5],
  ['fgMuted', 'panel', 4.5],
  ['fgMuted', 'panel2', 4.5],
  ['fgFaint', 'ink', 4.5],
  ['fgFaint', 'ink2', 4.5],
  ['fgFaint', 'panel', 4.5],
  ['fgFaint', 'panel2', 4.5],
  ['actionFg', 'action', 4.5],
  ['aiFg', 'ai', 4.5],
  ['aiText', 'panel', 4.5],
  ['aiText', 'ink', 4.5],
  ['aiText', 'aiSoft', 4.5],
  ['progressText', 'panel', 4.5],
  ['progressText', 'progressSoft', 4.5],
  ['progressText', 'ink', 4.5],
  ['alertFg', 'alert', 4.5],
  ['alertText', 'panel', 4.5],
  ['alertText', 'alertSoft', 4.5],
  ['alertText', 'ink', 4.5],
  // Non-text UI: control borders, focus ring, and fills that carry meaning need 3:1.
  ['control', 'panel', 3],
  ['control', 'ink', 3],
  ['ring', 'panel', 3],
  ['ring', 'ink', 3],
  ['progress', 'panel2', 3],
  ['action', 'ink', 3],
]

export const modePairs: Array<[Exclude<keyof ModeTokens, 'chrome'>, Exclude<keyof ModeTokens, 'chrome'>, number]> = [
  ['paperFg', 'paper', 7], // the manuscript gets AAA-level legibility
  ['paperFg', 'selection', 4.5],
  ['paperMuted', 'paper', 4.5],
  ['accentOnPaper', 'paper', 3],
  ['barFg', 'bar', 4.5],
  ['barMuted', 'bar', 4.5],
  ['barFg', 'surround', 4.5],
  ['barMuted', 'surround', 4.5],
  ['accentText', 'bar', 4.5],
  ['accent', 'bar', 3],
  ['progress', 'bar', 3],
  ['alertText', 'bar', 4.5],
]

// ---------------------------------------------------------------------------
// WCAG 2.x relative luminance and contrast ratio
// ---------------------------------------------------------------------------
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
