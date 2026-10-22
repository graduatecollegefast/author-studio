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

export function mockProvider(): AIProvider {
  return {
    id: 'mock',
    async generateStructuredData<T>(req: StructuredRequest) {
      const text = passage(req.input)
      const inputTokens = Math.ceil((req.system.length + req.input.length) / 4)
      if (text.includes('MOCK_DECLINE')) throw new ProviderDeclined('The test model declined this passage.', { inputTokens, outputTokens: 5 })
      const data = req.schemaName === 'book_synthesis' ? synthesize(text) : extract(text)
      return { data: data as T, usage: { inputTokens, outputTokens: Math.ceil(JSON.stringify(data).length / 4) } }
    },
    async generateText(req: TextRequest) {
      return { text: 'Test response.', usage: { inputTokens: Math.ceil(req.input.length / 4), outputTokens: 3 } }
    },
    getProviderCapabilities: () => ({ structuredOutput: true, streaming: false, declinesReported: true }),
  }
}
