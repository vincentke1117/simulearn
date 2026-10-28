import type { DiagramMode } from '@/types/control'

export function isRunDisabled(diagramMode: DiagramMode, hasGround: boolean): boolean {
  if (diagramMode === 'empty') return true
  // 纯电路不接地也能算：内核会自动选参考点（lab-backend/src/Reference.jl）；混合仿真还没接这条路
  if (diagramMode === 'mixed' && !hasGround) return true
  return false
}
