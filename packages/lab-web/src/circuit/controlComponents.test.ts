import { describe, expect, it } from 'vitest'

import { controlComponentLibrary } from '@/circuit/controlComponents'

describe('controlComponentLibrary', () => {
  it('defines the minimum phase 1 control blocks', () => {
    expect(controlComponentLibrary.control_step.handles.map((handle) => handle.id)).toEqual(['out'])
    expect(controlComponentLibrary.control_sum.handles.map((handle) => handle.id)).toEqual([
      'in1',
      'in2',
      'out',
    ])
    expect(controlComponentLibrary.control_pid.parameters.map((parameter) => parameter.key)).toEqual([
      'kp',
      'ki',
      'kd',
      'tf',
    ])
  })
})
