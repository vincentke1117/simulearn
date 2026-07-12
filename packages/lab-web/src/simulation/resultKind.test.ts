import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AnalysisResultData } from '@/types/circuit'
import { classifyResult, supportsVoltageOverlay } from '@/simulation/resultKind'

/** 从当前工作目录向上找到仓库根的 .samples/ 目录 */
function findSamplesDir(): string {
  let current = resolve(process.cwd())
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, '.samples')
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('找不到 .samples 目录（后端真实响应样本）')
}

const SAMPLES_DIR = findSamplesDir()

/**
 * 地面真相：直接读 .samples/ 里抓下来的后端原样响应封套。
 * 不许照着记忆手写键名——样本变了这里必须跟着红。
 */
function loadSample(name: string): { method?: string; data: AnalysisResultData } {
  const envelope = JSON.parse(readFileSync(join(SAMPLES_DIR, `${name}.json`), 'utf8')) as {
    body: { method?: string; status: string; data: AnalysisResultData }
  }
  expect(envelope.body.status).toBe('ok')
  return { method: envelope.body.method, data: envelope.body.data }
}

describe('classifyResult — 回归：面板空洞', () => {
  it('ac_phasor 的真实响应必须命中相量分支，而不是空态', () => {
    const { method, data } = loadSample('lab-ac-phasor')
    expect(method).toBe('ac_phasor')

    const kind = classifyResult(method, data)

    expect(kind.kind).toBe('ac_phasor')
    if (kind.kind !== 'ac_phasor') throw new Error('unreachable')
    expect(kind.data.frequency_hz).toBe(1000)
    expect(kind.data.node_voltages.n2).toBeCloseTo(0.7071067811865476, 12)
    expect(kind.data.node_phases_deg.n2).toBeCloseTo(-45, 9)
    expect(kind.data.branch_phases_deg.R1).toBeCloseTo(45, 9)
    expect(kind.data.power.sources.VAC1.pf).toBeCloseTo(0.7071067811865476, 12)
    expect(kind.data.power.elements.R1.p_w).toBeCloseTo(0.00025, 12)
    expect(kind.data.power.convention).toContain('峰值')
  })

  it('dc_op 的真实响应必须命中直流工作点分支，而不是空态', () => {
    const { method, data } = loadSample('lab-dc-op')
    expect(method).toBe('dc_op')

    const kind = classifyResult(method, data)

    expect(kind.kind).toBe('dc_op')
    if (kind.kind !== 'dc_op') throw new Error('unreachable')
    expect(Object.keys(kind.data.node_voltages)).toContain('n2')
    expect(Object.keys(kind.data.branch_currents)).toContain('R1')
  })

  it('frequency_sweep 的真实响应必须命中 Bode 分支，而不是空态', () => {
    const { method, data } = loadSample('lab-freq-sweep')
    expect(method).toBe('frequency_sweep')

    const kind = classifyResult(method, data)

    expect(kind.kind).toBe('frequency_sweep')
    if (kind.kind !== 'frequency_sweep') throw new Error('unreachable')
    expect(kind.data.freq_hz.length).toBeGreaterThan(2)
    expect(Object.keys(kind.data.probes)).toContain('VP1')
    const probe = kind.data.probes.VP1
    expect(probe.mag.length).toBe(kind.data.freq_hz.length)
    expect(probe.mag_db.length).toBe(kind.data.freq_hz.length)
    expect(probe.phase_deg.length).toBe(kind.data.freq_hz.length)
  })

  it('控制仿真的真实响应命中瞬态分支，并带出阶跃指标', () => {
    const { method, data } = loadSample('lab-control-metrics')

    const kind = classifyResult(method, data)

    expect(kind.kind).toBe('transient')
    if (kind.kind !== 'transient') throw new Error('unreachable')
    expect(kind.data.signals[0].id).toBe('scope:SCOPE1')
    // 指标按信号 id 索引，必须能直接对上
    const metrics = kind.data.metrics?.[kind.data.signals[0].id]
    expect(metrics).toBeDefined()
    expect(metrics?.final_value).toBeCloseTo(2, 3)
    expect(metrics?.rise_time_s).toBeCloseTo(0.4394449154672439, 2)
    expect(metrics?.settling_time_s).toBeCloseTo(0.7824046010856291, 2)
  })
})

describe('classifyResult — 既有分支不回归', () => {
  it('node_voltage / branch_current / mesh_current 仍走直流表格分支', () => {
    const data = { node_voltages: { n1: 5, gnd: 0 }, branch_currents: { R1: 0.005 } }

    for (const method of ['node_voltage', 'branch_current', 'mesh_current'] as const) {
      const kind = classifyResult(method, data)
      expect(kind.kind).toBe('dc_solve')
      if (kind.kind !== 'dc_solve') throw new Error('unreachable')
      expect(kind.method).toBe(method)
    }
  })

  it('thevenin 结果命中戴维南分支', () => {
    const kind = classifyResult('thevenin', { vth: 2.5, rth: 500, port: { positive: 'n2', negative: 'gnd' } })
    expect(kind.kind).toBe('thevenin')
  })

  it('对比模式结果命中 comparison 分支', () => {
    const kind = classifyResult(undefined, {
      node_voltage: { node_voltages: { n1: 5 }, branch_currents: {} },
      thevenin: { vth: 1, rth: 2, port: { positive: 'n1', negative: 'gnd' } },
    } as unknown as AnalysisResultData)
    expect(kind.kind).toBe('comparison')
  })

  it('纯电路瞬态（无 metrics）仍是 transient，不崩', () => {
    const kind = classifyResult('transient', {
      time: [0, 1],
      signals: [{ id: 'VP1', label: 'VP1', values: [0, 1] }],
    })
    expect(kind.kind).toBe('transient')
    if (kind.kind !== 'transient') throw new Error('unreachable')
    expect(kind.data.metrics).toBeUndefined()
  })
})

describe('supportsVoltageOverlay — 回归：相量结果不许灌进画布叠加层', () => {
  it('ac_phasor 的真实响应必须被挡在叠加层之外（相量幅值不能做标量减法）', () => {
    const { data } = loadSample('lab-ac-phasor')
    expect(supportsVoltageOverlay(data)).toBe(false)
  })

  it('复现错误压降：标量相减 1.465 V ≠ 复数相减真值 3.536 V', () => {
    // 后端 RC 低通、5 V∠0° @1kHz 的相量解（教科书解析解）
    const n1 = { mag: 5, deg: 0 }
    const n2 = { mag: 5 / Math.SQRT2, deg: -45 }
    const scalarDelta = n1.mag - n2.mag
    const re = n1.mag * Math.cos((n1.deg * Math.PI) / 180) - n2.mag * Math.cos((n2.deg * Math.PI) / 180)
    const im = n1.mag * Math.sin((n1.deg * Math.PI) / 180) - n2.mag * Math.sin((n2.deg * Math.PI) / 180)
    const phasorDelta = Math.hypot(re, im)

    expect(scalarDelta).toBeCloseTo(1.4645, 3)
    expect(phasorDelta).toBeCloseTo(3.5355, 3)
    // 两者差 2.4 倍：正因为如此，叠加层必须拒绝相量结果
    expect(supportsVoltageOverlay({ node_voltages: { n1: 5, n2: 3.5355 }, node_phases_deg: { n1: 0, n2: -45 } })).toBe(false)
  })

  it('frequency_sweep / transient 也不进叠加层；直流标量结果照常进', () => {
    expect(supportsVoltageOverlay(loadSample('lab-freq-sweep').data)).toBe(false)
    expect(supportsVoltageOverlay(loadSample('lab-control-metrics').data)).toBe(false)
    expect(supportsVoltageOverlay(loadSample('lab-dc-op').data)).toBe(true)
    expect(supportsVoltageOverlay({ node_voltages: { n1: 5 }, branch_currents: { R1: 0.005 } })).toBe(true)
  })
})

describe('classifyResult — 保底行为', () => {
  it('method 缺失但结构是节点电压表 → 仍渲染表格，绝不掉进空态', () => {
    const kind = classifyResult(undefined, { node_voltages: { n1: 1 }, branch_currents: {} })
    expect(kind.kind).toBe('dc_solve')
  })

  it('后端未来新增的同构方法（未知 method 名）也不会掉进空态', () => {
    const kind = classifyResult('some_future_dc_method', { node_voltages: { n1: 1 }, branch_currents: {} })
    expect(kind.kind).toBe('dc_solve')
  })

  it('null / 空对象才是空态', () => {
    expect(classifyResult('ac_phasor', null).kind).toBe('empty')
    expect(classifyResult(undefined, {} as AnalysisResultData).kind).toBe('empty')
  })
})
