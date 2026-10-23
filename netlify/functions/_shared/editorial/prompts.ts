// Editorial Studio prompts. Every finding must quote the chapter word for word; findings
// whose passage cannot be found in the chapter are discarded before the author sees them.

export const REVIEW_TYPES = ['developmental', 'line', 'copy', 'dialogue', 'reader'] as const
export type ReviewType = (typeof REVIEW_TYPES)[number]

export const REVIEW_BRIEFS: Record<ReviewType, { label: string; focus: string; categories: string[]; revisions: string }> = {
  developmental: {
    label: 'Developmental review',
    focus:
      'Big-picture story craft: structure, pacing, stakes, character motivation and arcs, plot logic, scene purpose, the strength of the opening and ending. Ignore grammar and word choice.',
    categories: ['structure', 'pacing', 'stakes', 'motivation', 'character_arc', 'plot_logic', 'scene_purpose', 'opening', 'ending'],
    revisions:
      'Most developmental notes need the author to rethink something, so leave "revision" empty unless a single sentence change truly fixes it.',
  },
  line: {
    label: 'Line editing',
    focus:
      'Sentence-level prose: clarity, rhythm, word choice, redundancy, filter words, clichés, telling where showing would land harder, weak imagery.',
    categories: ['clarity', 'rhythm', 'word_choice', 'redundancy', 'filtering', 'cliche', 'show_dont_tell', 'imagery'],
    revisions: 'Give a revision for every finding: the passage rewritten in the author’s voice.',
  },
  copy: {
    label: 'Copyediting',
    focus:
      'Mechanical correctness: grammar, spelling, punctuation, capitalization, word usage, inconsistent spelling or formatting of names and terms, typos. Respect intentional voice, dialect and stylistic fragments; do not flag them.',
    categories: ['grammar', 'spelling', 'punctuation', 'capitalization', 'word_usage', 'consistency', 'typo'],
    revisions: 'Give a revision for every finding: the passage with only the correction applied, nothing else changed.',
  },
  dialogue: {
    label: 'Dialogue review',
    focus:
      'Dialogue only: natural speech, distinct character voices, dialogue tags and beats, exposition dumped into speech, missing subtext, unclear who is speaking.',
    categories: ['voice', 'naturalness', 'tags', 'exposition', 'subtext', 'attribution'],
    revisions: 'Give a revision where a rewrite of the quoted passage fixes it; otherwise leave "revision" empty.',
  },
  reader: {
    label: 'Reader perspective',
    focus:
      'React as an engaged first-time reader of this genre: where you were confused, where attention drifted, what moved or surprised you, what you expected to happen, what you wanted to know. Include what works, not only problems, as severity "suggestion".',
    categories: ['confusion', 'engagement', 'emotion', 'expectation', 'stakes', 'strength'],
    revisions: 'Readers do not rewrite, so leave "revision" empty unless the fix is a small clarifying change.',
  },
}

export function editorialSystem(type: ReviewType): string {
  const b = REVIEW_BRIEFS[type]
  return [
    `You are a professional fiction editor giving a ${b.label.toLowerCase()} of one chapter. ${b.focus}`,
    'Rules:',
    '- "passage" must be copied exactly, word for word, from the chapter: one sentence or a short run of sentences inside a single paragraph, at most 60 words. Never paraphrase it, never join text from two paragraphs.',
    '- "revision" replaces exactly that passage. Keep the author’s voice, tense, point of view, names and punctuation habits. Do not add new plot facts.',
    `- ${b.revisions}`,
    '- "description" says what the issue is in one or two plain sentences. "explanation" says why the change helps.',
    `- "category" is one of: ${b.categories.join(', ')}.`,
    '- "severity": critical (breaks the reader’s experience), warning (clearly weakens it), suggestion (optional polish or a strength).',
    '- Return at most 12 findings, the most important first. Return none if the chapter needs nothing for this review.',
    '- Never criticise the author. Never invent text that is not in the chapter.',
  ].join('\n')
}

export const EDITORIAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'severity', 'description', 'passage', 'revision', 'explanation'],
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'suggestion'] },
          description: { type: 'string' },
          passage: { type: 'string' },
          revision: { type: 'string' },
          explanation: { type: 'string' },
        },
      },
    },
  },
} as const

export interface EditorialOutput {
  findings: Array<{ category: string; severity: string; description: string; passage: string; revision: string; explanation: string }>
}

export function editorialInput(bookTitle: string, chapterTitle: string, text: string, styleNote: string): string {
  return [
    `Book: ${bookTitle}`,
    `Chapter: ${chapterTitle}`,
    styleNote ? `Author's style (keep revisions consistent with it): ${styleNote}` : '',
    '<chapter>',
    text,
    '</chapter>',
  ]
    .filter(Boolean)
    .join('\n')
}
