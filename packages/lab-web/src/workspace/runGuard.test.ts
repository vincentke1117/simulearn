import { describe, expect, it } from 'vitest'

import { isRunDisabled } from '@/workspace/runGuard'

describe('isRunDisabled', () => {
  it('disables run for empty diagrams', () => {
    expect(isRunDisabled('empty', false)).toBe(true)
    expect(isRunDisabled('empty', true)).toBe(true)
  })

  it('requires ground for mixed diagrams', () => {
    expect(isRunDisabled('mixed', false)).toBe(true)
    expect(isRunDisabled('mixed', true)).toBe(false)
  })

  it('lets electrical diagrams run without ground (the kernel picks a reference node)', () => {
    expect(isRunDisabled('electrical', false)).toBe(false)
    expect(isRunDisabled('electrical', true)).toBe(false)
  })

  it('allows control diagrams to run without ground', () => {
    expect(isRunDisabled('control', false)).toBe(false)
    expect(isRunDisabled('control', true)).toBe(false)
  })
})
