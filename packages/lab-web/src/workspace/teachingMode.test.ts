import { describe, expect, it } from 'vitest'

import { teachingStepsReliable } from '@/workspace/circuitWorkspaceHelpers'

// 顶栏的「教学模式」开关和发给内核的 teaching_mode 都按这个函数决定：
// 网孔法、支路法的教学步骤在内核里还是占位，这两种方法既不显示开关也不要步骤
describe('teachingStepsReliable', () => {
  it.each(['node_voltage', 'dc_op', 'ac_steady', undefined])('%s 可以要教学步骤', (method) => {
    expect(teachingStepsReliable(method)).toBe(true)
  })

  it.each(['mesh_current', 'branch_current'])('%s 不要教学步骤', (method) => {
    expect(teachingStepsReliable(method)).toBe(false)
  })
})
