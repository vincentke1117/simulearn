import type { AnalysisResultData } from '@/types/circuit'

/** 内核自动选的参考点：有电路没接地时才下发（lab-backend/src/Reference.jl），每块没接地的电路一个 */
export interface ReferencePoint {
  net: string
  component: string | null
  terminal: string | null
}

const TERMINAL_NAMES: Record<string, string> = { neg: '负极' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isPoint = (value: unknown): value is ReferencePoint =>
  isRecord(value) && typeof value.net === 'string'

function readPoints(value: unknown): ReferencePoint[] | null {
  if (!isRecord(value) || !Array.isArray(value.reference)) return null
  const points = value.reference.filter(isPoint)
  return points.length > 0 ? points : null
}

/** 取结果里的自动参考点；互比模式是「方法 → 结果」的字典，各方法的参考点相同，取第一个带的 */
export function pickAutoReference(result: AnalysisResultData | null): ReferencePoint[] | null {
  const own = readPoints(result)
  if (own || !isRecord(result)) return own
  for (const value of Object.values(result)) {
    const nested = readPoints(value)
    if (nested) return nested
  }
  return null
}

/**
 * 给学生的说明。labels：元件 id → 画布上的标签（V1、R2…），内核只认 id；
 * hasGround：画布上有没有地线——有的话自动参考点只给了和地线不导通的那几块。
 */
export function describeAutoReference(points: ReferencePoint[], labels: Record<string, string>, hasGround: boolean): string {
  const where = points.map((point) => {
    if (!point.component) return `节点 ${point.net}`
    const label = labels[point.component] ?? point.component
    const terminal = point.terminal ? (TERMINAL_NAMES[point.terminal] ?? point.terminal) : ''
    return `${label} 的${terminal}（节点 ${point.net}）`
  })
  const list = where.join('、')
  // 全角括号后面不再空格，「节点 n1」这种以字母数字结尾的才空一格
  const gap = /\w$/.test(list) ? ' ' : ''
  const head = hasGround
    ? points.length === 1
      ? `有一部分电路和地线不导通，已自动取 ${list}${gap}作它的参考点（0 V）。`
      : `有 ${points.length} 部分电路和地线不导通，已各自取参考点（0 V）：${list}。`
    : points.length === 1
      ? `电路没有接地，已自动取 ${list}${gap}作参考点（0 V）。`
      : `电路分成 ${points.length} 部分互不导通，都没有接地，已各自取参考点（0 V）：${list}。`
  return `${head}节点电压都是相对参考点的读数；元件两端的电压和支路电流与参考点选在哪无关。`
}
