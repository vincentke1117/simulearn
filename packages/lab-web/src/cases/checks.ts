import type { SimulationPayload, SimulationSettings, TheveninPortConfig } from '@/types/circuit'
import { defaultSweepSettings } from '@/types/circuit'
import { initialSimulationSettings } from '@/workspace/circuitWorkspaceHelpers'
import type { CaseCheck, CasePreset } from './types'

/** 案例预设 → 工具栏的仿真设置（没写的项沿用编辑器的缺省值） */
export function presetSettings(preset: CasePreset): SimulationSettings {
  return {
    ...initialSimulationSettings,
    method: preset.method,
    tStop: preset.tStop ?? initialSimulationSettings.tStop,
    nSamples: preset.nSamples ?? initialSimulationSettings.nSamples,
    sweep: { ...defaultSweepSettings, ...preset.sweep, scale: 'log' },
    ...(preset.voltageDisplayMode ? { voltageDisplayMode: preset.voltageDisplayMode } : {}),
    ...(preset.showBranchCurrents !== undefined ? { showBranchCurrents: preset.showBranchCurrents } : {}),
  }
}

/** 「探针 id」或「元件 id.端子」→ 它所在的网络名；gnd 原样返回 */
export function resolveNet(ref: string, payload: Pick<SimulationPayload, 'components'>): string | undefined {
  if (ref === 'gnd') return 'gnd'
  const [id, handle] = ref.includes('.') ? ref.split('.') : [ref, 'node']
  return payload.components.find((component) => component.id === id)?.connections[handle]
}

export function resolveTheveninPort(
  preset: CasePreset,
  payload: Pick<SimulationPayload, 'components'>,
): TheveninPortConfig | undefined {
  if (!preset.theveninPort) return undefined
  const positiveNode = resolveNet(preset.theveninPort.positive, payload)
  const negativeNode = resolveNet(preset.theveninPort.negative, payload)
  return positiveNode && negativeNode ? { positiveNode, negativeNode } : undefined
}

/** 核对点路径里的 {X} 换成网络名；找不到就返回 undefined（案例数据写错了） */
export function resolveCheckPath(path: string, payload: Pick<SimulationPayload, 'components'>): string | undefined {
  let missing = false
  const resolved = path.replace(/\{([^}]+)\}/g, (_, ref: string) => {
    const net = resolveNet(ref, payload)
    if (!net) missing = true
    return net ?? ''
  })
  return missing ? undefined : resolved
}

/** 按 contracts/ 的路径规则取值：`.` 分段，数组 1 起始，-1 为末位 */
export function readPath(data: unknown, path: string): unknown {
  let current: unknown = data
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      current = index === -1 ? current[current.length - 1] : current[index - 1]
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return current
}

export interface CheckOutcome {
  check: CaseCheck
  actual?: number
  ok: boolean
  reason?: string
}

/** 拿内核返回的 data 核对一个案例的全部核对点 */
export function evaluateChecks(
  checks: CaseCheck[],
  payload: Pick<SimulationPayload, 'components'>,
  data: unknown,
): CheckOutcome[] {
  return checks.map((check) => {
    const path = resolveCheckPath(check.path, payload)
    if (!path) return { check, ok: false, reason: `路径里的探针 / 端子找不到：${check.path}` }
    const raw = readPath(data, path)
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return { check, ok: false, reason: `结果里没有 ${path}` }
    const actual = check.rms ? raw / Math.SQRT2 : raw
    return { check, actual, ok: Math.abs(actual - check.expect) <= check.tol }
  })
}
