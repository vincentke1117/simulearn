import { describe, expect, it } from 'vitest'

import { dropRemovals } from './topologyLock'

describe('dropRemovals (D19 topology lock)', () => {
  const changes = [
    { type: 'select', id: 'R1' },
    { type: 'remove', id: 'R1' },
    { type: 'position', id: 'R2' },
    { type: 'remove', id: 'e1' },
  ]

  it('drops deletions when locked but keeps selection and moves', () => {
    expect(dropRemovals(changes, true).map((change) => change.type)).toEqual(['select', 'position'])
  })

  it('passes everything through when not locked', () => {
    expect(dropRemovals(changes, false)).toBe(changes)
  })
})
