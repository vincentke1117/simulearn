import type { DiagramMode } from '@/types/control'

export function isRunDisabled(diagramMode: DiagramMode, hasGround: boolean): boolean {
  if (diagramMode === 'empty') return true
  if (diagramMode === 'mixed' && !hasGround) return true
  if (diagramMode === 'electrical' && !hasGround) return true
  return false
}
