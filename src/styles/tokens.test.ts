import { chrome, chromePairs, contrastRatio, modePairs, modes, palette } from './tokens'

describe('Creative Flow contrast (WCAG AA)', () => {
  it('computes known ratios correctly', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const [fg, bg, min] of chromePairs) {
      it(`${theme}: ${fg} on ${bg} >= ${min}`, () => {
        const ratio = contrastRatio(chrome[theme][fg], chrome[theme][bg])
        expect(ratio, `${chrome[theme][fg]} on ${chrome[theme][bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min)
      })
    }
  }

  for (const mode of Object.keys(modes) as Array<keyof typeof modes>) {
    for (const [fg, bg, min] of modePairs) {
      it(`${mode}: ${fg} on ${bg} >= ${min}`, () => {
        const ratio = contrastRatio(modes[mode][fg], modes[mode][bg])
        expect(ratio, `${modes[mode][fg]} on ${modes[mode][bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min)
      })
    }
  }

  it('uses the six Creative Flow colors', () => {
    expect(modes.creative.surround).toBe(palette.deepFocusNavy)
    expect(modes.creative.paper).toBe(palette.warmIvory)
    expect(modes.creative.paperFg).toBe(palette.inkCharcoal)
    expect(modes.creative.accent).toBe(palette.creativeBlue)
    expect(modes.focus.accent).toBe(palette.sageGreen)
    expect(modes.review.surround).toBe(palette.softSlate)
    expect(chrome.dark.progress).toBe(palette.sageGreen)
    expect(chrome.dark.ai).toBe(palette.creativeBlue)
  })
})
