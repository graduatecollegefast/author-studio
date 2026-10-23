// AI writing commands in the Writing Studio. Shared by the app and the server.
// Every command produces a proposal; nothing is inserted until the author accepts it.

export type InsertMode = 'replace' | 'insert_after' | 'append' | 'new_scene' | 'new_chapter' | 'notes'
export type CommandGroup = 'write' | 'selection' | 'check'

export interface WritingCommand {
  id: string
  label: string
  group: CommandGroup
  /** Needs selected text in the editor. */
  needsSelection: boolean
  /** Needs a direction from the author (Draft Scene, Draft Chapter). */
  needsDirection: boolean
  insertMode: InsertMode
  taskType: 'writing_assist' | 'writing_draft'
  maxOutputTokens: number
  /** What the model is asked to do. */
  instruction: string
}

const PROSE = 'Write only the prose itself, with paragraphs separated by a blank line. No headings, titles, notes, quotation of these instructions, or commentary.'

export const WRITING_COMMANDS: WritingCommand[] = [
  {
    id: 'continue',
    label: 'Continue Writing',
    group: 'write',
    needsSelection: false,
    needsDirection: false,
    insertMode: 'append',
    taskType: 'writing_draft',
    maxOutputTokens: 2500,
    instruction: `Continue the current scene from exactly where it ends, for about 300 to 600 words, keeping the point of view, tense, voice and momentum. Do not repeat or summarize what came before. ${PROSE}`,
  },
  {
    id: 'draft_scene',
    label: 'Draft Scene',
    group: 'write',
    needsSelection: false,
    needsDirection: true,
    insertMode: 'new_scene',
    taskType: 'writing_draft',
    maxOutputTokens: 6000,
    instruction: `Draft a complete new scene that follows the current scene, guided by the author's direction, about 1,000 to 2,000 words. ${PROSE}`,
  },
  {
    id: 'draft_chapter',
    label: 'Draft Chapter',
    group: 'write',
    needsSelection: false,
    needsDirection: true,
    insertMode: 'new_chapter',
    taskType: 'writing_draft',
    maxOutputTokens: 12000,
    instruction: `Draft a complete new chapter that follows the current chapter, guided by the author's direction, about 2,500 to 4,000 words. Mark a scene break inside the chapter with a line containing only * * *. ${PROSE}`,
  },
  {
    id: 'expand',
    label: 'Expand Selection',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 3000,
    instruction: `Rewrite the selected passage at roughly twice its length, adding sensory detail, interiority and beats, without changing what happens. ${PROSE}`,
  },
  {
    id: 'rewrite',
    label: 'Rewrite Selection',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 3000,
    instruction: `Rewrite the selected passage so it reads more clearly and vividly in the author's voice, keeping its meaning, events and length about the same. Follow the author's direction if one is given. ${PROSE}`,
  },
  {
    id: 'shorten',
    label: 'Shorten Selection',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 2000,
    instruction: `Tighten the selected passage to about half its length, keeping every essential event, line of dialogue that matters, and the voice. ${PROSE}`,
  },
  {
    id: 'dialogue',
    label: 'Improve Dialogue',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 3000,
    instruction: `Improve the dialogue in the selected passage: make each speaker sound distinct and true to their established voice, cut on-the-nose lines, add subtext and natural beats. Keep what happens. ${PROSE}`,
  },
  {
    id: 'tension',
    label: 'Increase Tension',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 3000,
    instruction: `Rewrite the selected passage with more tension: sharper stakes, friction, withheld information, and pacing that tightens. Keep the events consistent with canon. ${PROSE}`,
  },
  {
    id: 'emotion',
    label: 'Improve Emotional Depth',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 3000,
    instruction: `Rewrite the selected passage with deeper emotion shown through physical reaction, thought, and subtext rather than named feelings. Keep what happens. ${PROSE}`,
  },
  {
    id: 'pacing',
    label: 'Improve Pacing',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 3000,
    instruction: `Rewrite the selected passage with better pacing: vary sentence and paragraph length, cut drag, and linger where the moment matters. Keep what happens. ${PROSE}`,
  },
  {
    id: 'voice',
    label: 'Strengthen Character Voice',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 3000,
    instruction: `Rewrite the selected passage so the point-of-view character's personality, speech patterns and way of noticing things come through more strongly, consistent with canon. ${PROSE}`,
  },
  {
    id: 'description',
    label: 'Add Description',
    group: 'selection',
    needsSelection: true,
    needsDirection: false,
    insertMode: 'replace',
    taskType: 'writing_assist',
    maxOutputTokens: 3000,
    instruction: `Rewrite the selected passage with richer, specific description of setting, bodies and objects, consistent with canon, without slowing the scene too much. ${PROSE}`,
  },
  {
    id: 'check_pov',
    label: 'Check POV',
    group: 'check',
    needsSelection: false,
    needsDirection: false,
    insertMode: 'notes',
    taskType: 'writing_assist',
    maxOutputTokens: 1500,
    instruction:
      'Check the point of view of the text (the selection if there is one, otherwise the current scene). Name the POV and list each slip (head-hopping, knowledge the POV character cannot have) with a short quote and a fix. If there are none, say so in one line.',
  },
  {
    id: 'check_tense',
    label: 'Check Tense',
    group: 'check',
    needsSelection: false,
    needsDirection: false,
    insertMode: 'notes',
    taskType: 'writing_assist',
    maxOutputTokens: 1500,
    instruction:
      'Check verb tense in the text (the selection if there is one, otherwise the current scene). Name the main tense and list each unintended shift with a short quote and the corrected wording. If there are none, say so in one line.',
  },
  {
    id: 'check_continuity',
    label: 'Check Continuity',
    group: 'check',
    needsSelection: false,
    needsDirection: false,
    insertMode: 'notes',
    taskType: 'writing_assist',
    maxOutputTokens: 1800,
    instruction:
      'Compare the text (the selection if there is one, otherwise the current scene) with the established canon, timeline and decisions in the context. List each contradiction with a short quote, the canon it conflicts with, and a suggested fix. If there are none, say so in one line.',
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm Alternatives',
    group: 'check',
    needsSelection: false,
    needsDirection: false,
    insertMode: 'notes',
    taskType: 'writing_assist',
    maxOutputTokens: 1800,
    instruction:
      'Brainstorm five distinct alternative directions for the text (the selection if there is one, otherwise where the current scene could go next), following the author’s direction if given. For each: a short title and two or three sentences. Keep them consistent with canon.',
  },
  {
    id: 'questions',
    label: 'Ask Clarification Questions',
    group: 'check',
    needsSelection: false,
    needsDirection: false,
    insertMode: 'notes',
    taskType: 'writing_assist',
    maxOutputTokens: 1800,
    instruction: 'Ask the author the few questions whose answers you most need to write this part well.',
  },
]

export const commandById = (id: string) => WRITING_COMMANDS.find((c) => c.id === id)

export const AI_MODES = [
  { id: 'assistant', label: 'Writing Assistant', description: 'You write. AI helps with planning, suggestions, rewriting and editing.' },
  { id: 'co_writer', label: 'Collaborative Co-Writer', description: 'You give scene or chapter direction. AI drafts for your review.' },
  { id: 'creative_partner', label: 'Full Creative Partner', description: 'You give a concept. AI plans and drafts the book step by step, with your approval along the way.' },
] as const
export type AIMode = (typeof AI_MODES)[number]['id']

/** Commands offered in each mode. The Assistant leaves drafting new scenes to the author. */
export function commandsForMode(mode: AIMode): WritingCommand[] {
  if (mode === 'assistant') return WRITING_COMMANDS.filter((c) => c.id !== 'draft_scene' && c.id !== 'draft_chapter')
  return WRITING_COMMANDS
}

/** Plain prose (paragraphs split by blank lines, "* * *" scene breaks) to editor content. */
export function proseToDoc(text: string): { type: 'doc'; content: Array<Record<string, unknown>> } {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
  const content = blocks.map((b) => (/^(\*\s*){3}$|^#$/.test(b) ? { type: 'horizontalRule' } : { type: 'paragraph', content: inlineRuns(b) }))
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

/** *emphasis* or _emphasis_ becomes italic; everything else is plain text. */
function inlineRuns(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const re = /(\*|_)([^*_\n]+?)\1/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    out.push({ type: 'text', text: m[2], marks: [{ type: 'italic' }] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out.filter((r) => (r.text as string).length > 0)
}

/** Editor content back to plain text, for word counts and search. */
export function docText(doc: { content?: Array<Record<string, unknown>> }): string {
  return (doc.content ?? [])
    .map((n) => (n.type === 'horizontalRule' ? '* * *' : ((n.content as Array<{ text?: string }> | undefined) ?? []).map((r) => r.text ?? '').join('')))
    .join('\n\n')
}

/** Split a drafted chapter at its "* * *" lines into scenes. */
export function splitScenes(text: string): string[] {
  return text
    .split(/\n\s*(?:\*\s*){3}\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}
