// Deterministic offline provider for automated tests. Enabled only when the server
// environment sets AI_MOCK=1; production never sets it. It reads simple sentence patterns
// so tests can check evidence handling, statement types, declines and spending.
import { type AIProvider, ProviderDeclined, type StructuredRequest, type TextRequest } from './types'

function passage(input: string): string {
  const m = /<manuscript>\n?([\s\S]*?)\n?<\/manuscript>/.exec(input)
  return m ? m[1] : input
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const fact = (o: Record<string, unknown>) => ({
  related_name: '',
  relationship_category: 'none',
  world_category: 'none',
  when: '',
  is_flashback: false,
  characters_involved: [],
  attribute: 'detail',
  confidence: 0.9,
  statement_type: 'narrator',
  ...o,
})

function extract(text: string) {
  const facts: Array<Record<string, unknown>> = []
  for (const s of sentences(text)) {
    let m = /\b([A-Z][a-z]+ [A-Z][a-z]+) (?:worked|works) as an? ([a-z ]+?)[.,;]/.exec(s)
    if (m) facts.push(fact({ category: 'character', subject: m[1], attribute: 'occupation', value: m[2], excerpt: s }))
    m = /\b([A-Z][a-z]+) and ([A-Z][a-z]+) were (sisters|brothers|married|friends|rivals)\b/.exec(s)
    if (m) {
      const cat = { sisters: 'family', brothers: 'family', married: 'married', friends: 'friendship', rivals: 'rivalry' }[m[3]]
      facts.push(fact({ category: 'relationship', subject: m[1], related_name: m[2], relationship_category: cat, attribute: m[3], value: s, excerpt: s }))
    }
    m = /\bat the ([A-Z][a-z]+(?: [A-Z][a-z]+)+)/.exec(s)
    if (m) facts.push(fact({ category: 'world', subject: m[1], world_category: 'business', attribute: 'description', value: s, excerpt: s, confidence: 0.8 }))
    m = /^People said ([A-Z][a-z]+) (.+)$/.exec(s)
    if (m) facts.push(fact({ category: 'character', subject: m[1], attribute: 'history.secret', value: m[2], excerpt: s, statement_type: 'rumor', confidence: 0.95 }))
    m = /^Years earlier, (.+)$/.exec(s)
    if (m) facts.push(fact({ category: 'timeline', subject: 'Years earlier', attribute: 'event', value: m[1], when: 'years earlier', is_flashback: true, excerpt: s }))
  }
  // A quotation that is not in the text. The server must discard it.
  facts.push(fact({ category: 'character', subject: 'Nobody Real', attribute: 'occupation', value: 'invented', excerpt: 'This sentence does not appear anywhere in the book at all.' }))
  return { summary: sentences(text)[0] ?? '', facts }
}

function synthesize(text: string) {
  const first = sentences(text.replace(/^\[\d+\][^\n]*\n/gm, ''))[0] ?? ''
  return {
    plot: { primary: `Mock plot: ${first}`, subplots: [], conflicts: ['A family secret surfaces'], turning_points: [], climax: '', ending: '', unresolved: [] },
    themes: ['Family secrets'],
    emotional_conflicts: [],
    central_questions: [],
    style: { pov: 'Third person', tense: 'Past tense', dialogue: '', pacing: '', sentence_structure: '', description: '', voice: '', tone: '' },
    series_opportunities: [{ kind: 'sequel', idea: 'Follow the sisters after the lighthouse closes.' }],
  }
}

// Continuity: a chapter saying "<Name> worked as a <job>" that differs from a canon occupation.
function continuity(input: string) {
  const canon = /<canon>\n?([\s\S]*?)\n?<\/canon>/.exec(input)?.[1] ?? ''
  const text = passage(input)
  const findings: Array<Record<string, unknown>> = []
  for (const line of canon.split('\n')) {
    const m = /^\[(F\d+)\] ([^|]+?) \| occupation: ([^(]+?) \(/.exec(line)
    if (!m) continue
    for (const s of sentences(text)) {
      const w = new RegExp(`${m[2]} (?:worked|works) as an? ([a-z ]+?)[.,;]`).exec(s)
      if (w && w[1].trim() !== m[3].trim())
        findings.push({
          category: 'occupation',
          severity: 'warning',
          canon_refs: [m[1]],
          conflicting_excerpt: s,
          description: `${m[2]} is a ${m[3].trim()} in canon but a ${w[1]} here.`,
          suggested_resolution: 'Change the job in this line, or add a line explaining the career change.',
        })
    }
  }
  // Cites canon that does not exist; the server must discard it.
  findings.push({ category: 'timeline', severity: 'critical', canon_refs: ['F999'], conflicting_excerpt: sentences(text)[0] ?? '', description: 'Invented.', suggested_resolution: '' })
  return { findings }
}

// Writing: deterministic answers that echo what was asked, so tests can check the plumbing.
const between = (input: string, tag: string) => new RegExp(`<${tag}[^>]*>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(input)?.[1]?.trim() ?? ''
function prose(input: string): string {
  const request = /Request: ([^\n]*)/.exec(input)?.[1] ?? ''
  const direction = between(input, 'instruction')
  const selection = /<manuscript selection="true">\n?([\s\S]*?)\n?<\/manuscript>/.exec(input)?.[1]?.trim() ?? ''
  const scene = /Scene to write now: ([^\n]*)/.exec(input)?.[1]
  if (scene) return `Mock scene: ${scene}.\n\nThe tide turned *slowly* against the pier.`
  if (/^(Check the point of view|Check verb tense|Compare the text|Brainstorm)/.test(request)) return `Mock notes for: ${request.slice(0, 40)}`
  if (selection) return `Mock rewrite of: ${selection.slice(0, 60)}`
  return `Mock continuation${direction ? ` following: ${direction.slice(0, 60)}` : ''}.\n\nShe walked on.`
}
/** Editorial: a real sentence from the chapter with a revision, a note without one, and an invented quote that must be dropped. */
function editorial(input: string) {
  const chapter = between(input, 'chapter')
  const first = chapter.split(/\n+/).flatMap((para) => para.match(/[^.!?]+[.!?]+/g) ?? []).map((s) => s.trim()).find((s) => s.split(/\s+/).length >= 4)
  if (!first) return { findings: [] }
  return {
    findings: [
      { category: 'word_choice', severity: 'warning', description: 'Mock issue in this sentence.', passage: first, revision: `${first.replace(/[.!?]+$/, '')}, revised.`, explanation: 'Mock reason.' },
      { category: 'pacing', severity: 'suggestion', description: 'Mock note with no rewrite.', passage: first, revision: '', explanation: 'Mock pacing reason.' },
      { category: 'clarity', severity: 'critical', description: 'Invented passage.', passage: 'This sentence never appears anywhere in the chapter text.', revision: 'Nope.', explanation: 'Should be dropped.' },
    ],
  }
}

const WRITING: Record<string, (input: string) => unknown> = {
  editorial_findings: editorial,
  clarification_questions: () => ({
    questions: [
      { question: 'What does Mara want most in this chapter?', context: 'It sets her choices.', options: ['To leave the island', 'To protect Eli'] },
      { question: 'Is the lighthouse fire a secret from Eli?', context: 'It changes the dialogue.', options: ['Yes', 'No'] },
    ],
  }),
  decide_question: () => ({ answer: 'To protect Eli', reasoning: 'It fits the established sisters relationship.' }),
  question_options: () => ({ options: ['Option one', 'Option two', 'Option three'] }),
  idea_links: (input) => ({ links: [/\bB1:/.test(input) ? { ref: 'B1', reason: 'Same setting.' } : null, { ref: 'Z9', reason: 'Not a real reference.' }].filter(Boolean) }),
  style_profile: () => ({
    summary: 'Short, rhythmic sentences with close third person. "' + 'word '.repeat(20).trim() + '"',
    ...Object.fromEntries(
      ['narrative_voice', 'pov', 'tense', 'sentence_patterns', 'dialogue_style', 'pacing', 'description_density', 'emotional_intensity', 'humor', 'romantic_tension', 'character_development', 'chapter_structure', 'scene_transitions', 'common_themes'].map((k) => [k, `Mock ${k.replace(/_/g, ' ')}.`]),
    ),
    pov: 'Close third person.',
    tense: 'Past tense.',
  }),
  partner_analysis: () => ({
    analysis: 'Mock analysis of the concept.',
    questions: [{ question: 'Should the sisters reconcile by the end?', context: 'It decides the ending.', options: ['Yes', 'No'] }],
  }),
  partner_plan: (input) => {
    const chapters = Number(/exactly (\d+) chapters/.exec(input)?.[1] ?? 2)
    const scenes = Number(/and (\d+) scene plans/.exec(input)?.[1] ?? 1)
    return {
      premise: 'Mock premise.',
      character_arcs: [{ character: 'Mara Vance', arc: 'From guarded to open.' }],
      chapters: Array.from({ length: chapters }, (_, c) => ({
        title: `Mock Chapter ${c + 1}`,
        summary: `Summary ${c + 1}.`,
        scenes: Array.from({ length: scenes }, (_, s) => ({ title: `Scene ${c + 1}.${s + 1}`, plan: `Plan ${c + 1}.${s + 1}.` })),
      })),
    }
  },
}

export function mockProvider(): AIProvider {
  return {
    id: 'mock',
    async generateStructuredData<T>(req: StructuredRequest) {
      const text = passage(req.input)
      const inputTokens = Math.ceil((req.system.length + req.input.length) / 4)
      if (text.includes('MOCK_DECLINE')) throw new ProviderDeclined('The test model declined this passage.', { inputTokens, outputTokens: 5 })
      if (req.input.includes('MOCK_DECLINE')) throw new ProviderDeclined('The test model declined this request.', { inputTokens, outputTokens: 5 })
      const data =
        req.schemaName === 'book_synthesis'
          ? synthesize(text)
          : req.schemaName === 'continuity_findings'
            ? continuity(req.input)
            : req.schemaName in WRITING
              ? WRITING[req.schemaName](req.input)
              : extract(text)
      return { data: data as T, usage: { inputTokens, outputTokens: Math.ceil(JSON.stringify(data).length / 4) } }
    },
    async generateText(req: TextRequest) {
      const inputTokens = Math.ceil((req.system.length + req.input.length) / 4)
      if (req.input.includes('MOCK_DECLINE')) throw new ProviderDeclined('The test model declined this request.', { inputTokens, outputTokens: 5 })
      const text = prose(req.input)
      return { text, usage: { inputTokens, outputTokens: Math.ceil(text.length / 4) } }
    },
    getProviderCapabilities: () => ({ structuredOutput: true, streaming: false, declinesReported: true }),
  }
}
