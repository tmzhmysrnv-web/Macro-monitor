import { describe, it, expect } from 'vitest'
import { toneFor, headlineFor, changeLine, bottomLine } from './statusLadder'

// Guards the shared status ladder boundaries — these have been reverted by
// stale-copy overwrites before, so pin them.
describe('toneFor', () => {
  it('maps score to tone at 40 / 65 / 85', () => {
    expect(toneFor(0)).toBe('calm')
    expect(toneFor(39)).toBe('calm')
    expect(toneFor(40)).toBe('elevated')
    expect(toneFor(64)).toBe('elevated')
    expect(toneFor(65)).toBe('high')
    expect(toneFor(84)).toBe('high')
    expect(toneFor(85)).toBe('severe')
    expect(toneFor(100)).toBe('severe')
  })
})

describe('headlineFor', () => {
  it('splits the low band at 25 so 25–39 reads "Stable but worth watching"', () => {
    expect(headlineFor(20)).toBe('Calm and steady')
    expect(headlineFor(24)).toBe('Calm and steady')
    expect(headlineFor(25)).toBe('Stable but worth watching')
    expect(headlineFor(39)).toBe('Stable but worth watching')
    expect(headlineFor(40)).toBe('Elevated — worth watching')
    expect(headlineFor(70)).toBe('High — stress is building')
    expect(headlineFor(90)).toBe('Breaking — systemic stress')
  })
})

describe('changeLine', () => {
  it('positive change = worse / up arrow', () => {
    const c = changeLine(5)
    expect(c.dir).toBe('worse')
    expect(c.arrow).toBe('↑')
  })
  it('negative change = better / down arrow', () => {
    const c = changeLine(-5)
    expect(c.dir).toBe('better')
    expect(c.arrow).toBe('↓')
  })
  it('zero or null = flat', () => {
    expect(changeLine(0).dir).toBe('flat')
    expect(changeLine(null).dir).toBe('flat')
  })
})

describe('bottomLine', () => {
  it('low score reassures with "stable" territory', () => {
    expect(bottomLine(20).swap).toBe('stable')
  })
})
