import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { CircuitNodeData, SimulationSettings, SimulationResponse } from '@/types/circuit'
import { buildSimulationPayload } from '@/simulation/payload'
import { classifyResult, supportsVoltageOverlay } from '@/simulation/resultKind'
import { formatPhasor } from '@/simulation/format'

const BACKEND = 'http://127.0.0.1:8080/simulate'

/**
 * 打活后端的端到端验证：前端 payload 构造函数 → 真实 Julia 内核 → 前端类型/判别器解析。
 *
 * 需要 lab 内核在 127.0.0.1:8080 上跑着，因此不进离线门禁（npm run check 保持不依赖后端）。
 * 跑法：LAB_E2E=1 npm run test:e2e -w @simulearn/lab-web
 */
const E2E_ENABLED = process.env.LAB_E2E === '1'

function n(id: string, type: string, parameters: Record<string, number> = {}): Node<CircuitNodeData> {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, type: type as CircuitNodeData['type'], parameters } }
}
function e(id: string, s: string, sh: string, t: string, th: string): Edge {
  return { id, source: s, target: t, sourceHandle: sh, targetHandle: th }
}

// RC 低通 R=1k, C=1/(2π·10⁶) → fc = 1kHz，源幅值 5V @1kHz
function rc() {
  return {
    nodes: [
      n('VAC1', 'vsource_ac', { amplitude: 5, frequency: 1000 }),
      n('R1', 'resistor', { value: 1000 }),
      n('C1', 'capacitor', { value: 1.5915494309189535e-7 }),
      n('VP1', 'voltage_probe'),
      n('G1', 'ground'),
    ],
    edges: [
      e('e1', 'VAC1', 'pos', 'R1', 'p'),
      e('e2', 'R1', 'n', 'C1', 'p'),
      e('e3', 'C1', 'p', 'VP1', 'node'),
      e('e4', 'C1', 'n', 'VAC1', 'neg'),
      e('e5', 'VAC1', 'neg', 'G1', 'gnd'),
    ],
  }
}

const settings: SimulationSettings = { tStop: 1e-3, nSamples: 10 }

async function post(body: unknown): Promise<{ http: number; envelope: SimulationResponse }> {
  const res = await fetch(BACKEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { http: res.status, envelope: (await res.json()) as SimulationResponse }
}

describe.runIf(E2E_ENABLED)('live backend e2e', () => {
  it('ac_phasor', async () => {
    const { nodes, edges } = rc()
    const build = buildSimulationPayload(nodes, edges, { ...settings, method: 'ac_phasor' })
    expect(build.ok).toBe(true)

    const { http, envelope } = await post(build.payload)
    console.log('[ac_phasor] HTTP', http, 'status', envelope.status)
    expect(http).toBe(200)
    if (envelope.status !== 'ok') throw new Error(envelope.message)

    const kind = classifyResult(envelope.method, envelope.data)
    expect(kind.kind).toBe('ac_phasor')
    if (kind.kind !== 'ac_phasor') throw new Error('unreachable')
    console.log('[ac_phasor] f =', kind.data.frequency_hz, 'Hz')
    console.log('[ac_phasor] V(n2) =', formatPhasor(kind.data.node_voltages.n2, kind.data.node_phases_deg.n2, 'V'))
    console.log('[ac_phasor] I(R1) =', formatPhasor(kind.data.branch_currents.R1, kind.data.branch_phases_deg.R1, 'A'))
    console.log('[ac_phasor] power.sources.VAC1 =', JSON.stringify(kind.data.power.sources.VAC1))
    console.log('[ac_phasor] convention =', kind.data.power.convention)
    // 解析解 @fc：|V(n2)| = 5/√2，∠ = -45°
    expect(kind.data.node_voltages.n2).toBeCloseTo(3.5355339059327378, 9)
    expect(kind.data.node_phases_deg.n2).toBeCloseTo(-45, 6)
    expect(kind.data.power.sources.VAC1.q_var).toBeLessThan(0) // 容性

    // 相量结果绝不能进画布叠加层：叠加层做标量减法 |V+|−|V−|，R1 上会算成
    // 5 − 3.5355 = 1.465 V，而真实压降 |5∠0° − 3.5355∠−45°| = 3.536 V
    expect(supportsVoltageOverlay(envelope.data)).toBe(false)
  })

  it('dc_op', async () => {
    const { nodes, edges } = rc()
    const build = buildSimulationPayload(nodes, edges, { ...settings, method: 'dc_op' })
    expect(build.ok).toBe(true)

    const { http, envelope } = await post(build.payload)
    console.log('[dc_op] HTTP', http, 'status', envelope.status)
    expect(http).toBe(200)
    if (envelope.status !== 'ok') throw new Error(envelope.message)

    const kind = classifyResult(envelope.method, envelope.data)
    expect(kind.kind).toBe('dc_op')
    if (kind.kind !== 'dc_op') throw new Error('unreachable')
    console.log('[dc_op] node_voltages =', JSON.stringify(kind.data.node_voltages))
    console.log('[dc_op] branch_currents =', JSON.stringify(kind.data.branch_currents))
    // 交流源取直流分量 = 0 → 全网 0V
    expect(kind.data.node_voltages.n2).toBeCloseTo(0, 12)
  })

  it('frequency_sweep', async () => {
    const { nodes, edges } = rc()
    const build = buildSimulationPayload(nodes, edges, {
      ...settings,
      method: 'frequency_sweep',
      sweep: { fStartHz: 100, fStopHz: 10000, nPoints: 3, scale: 'log' },
    })
    expect(build.ok).toBe(true)
    console.log('[frequency_sweep] request.sweep =', JSON.stringify(build.payload?.sweep))

    const { http, envelope } = await post(build.payload)
    console.log('[frequency_sweep] HTTP', http, 'status', envelope.status)
    expect(http).toBe(200)
    if (envelope.status !== 'ok') throw new Error(envelope.message)

    const kind = classifyResult(envelope.method, envelope.data)
    expect(kind.kind).toBe('frequency_sweep')
    if (kind.kind !== 'frequency_sweep') throw new Error('unreachable')
    console.log('[frequency_sweep] freq_hz =', JSON.stringify(kind.data.freq_hz))
    console.log('[frequency_sweep] VP1.mag_db =', JSON.stringify(kind.data.probes.VP1.mag_db))
    console.log('[frequency_sweep] VP1.mag =', JSON.stringify(kind.data.probes.VP1.mag))
    console.log('[frequency_sweep] VP1.phase_deg =', JSON.stringify(kind.data.probes.VP1.phase_deg))
    // 源幅值 5V（峰值）→ @fc=1kHz 中点：|V| = 5/√2 = 3.5355V，20log10(5/√2) = 10.9691 dB，∠ = -45°
    // 注意：mag_db 是探针处的**绝对幅值**（dB re 1V），不是传递函数 |H|——|H| 在 fc 处才是 -3.01 dB。
    // 前端因此按「探针幅值 (dB)」标注（BodePlot.tsx / SimulationResultPanel.tsx 脚注），不写 |H|。
    expect(kind.data.probes.VP1.mag[1]).toBeCloseTo(3.5355339059327378, 9)
    expect(kind.data.probes.VP1.mag_db[1]).toBeCloseTo(20 * Math.log10(5 / Math.SQRT2), 6)
    expect(kind.data.probes.VP1.phase_deg[1]).toBeCloseTo(-45, 6)
    // 一阶低通高频段 -20 dB/dec：10× 频率 → -20 dB
    expect(kind.data.probes.VP1.mag_db[2] - kind.data.probes.VP1.mag_db[1]).toBeCloseTo(-17.03, 1)
  })

  it('422 error envelope keeps message + code', async () => {
    // 绕过前端校验，直接把无探针的 sweep 请求发给后端，确认我们的错误类型能吃下 code
    const { nodes, edges } = rc()
    const build = buildSimulationPayload(nodes, edges, { ...settings, method: 'ac_phasor' })
    const raw = { ...build.payload, method: 'frequency_sweep' }

    const { http, envelope } = await post(raw)
    console.log('[422] HTTP', http, 'body =', JSON.stringify(envelope))
    expect(http).toBe(422)
    expect(envelope.status).toBe('error')
    if (envelope.status !== 'error') throw new Error('unreachable')
    expect(envelope.code).toBe('LAB_VALIDATION')
    expect(envelope.message).toContain('sweep')
  })
})
