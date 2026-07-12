import { describe, expect, it } from 'vitest'

import type { StepResponseMetrics } from '@/types/circuit'
import {
  formatEngineering,
  formatFrequency,
  formatPercent,
  formatPhaseDeg,
  formatPhasor,
  formatPowerFactor,
  formatSeconds,
  formatStepMetrics,
  reactiveNature,
} from '@/simulation/format'

describe('formatEngineering', () => {
  it('keeps 4 significant digits in the base unit for readable magnitudes', () => {
    expect(formatEngineering(0.7071067811865476, 'V')).toBe('0.7071 V')
    expect(formatEngineering(3.5355339059327378, 'V')).toBe('3.536 V')
    expect(formatEngineering(5, 'V')).toBe('5.000 V')
  })

  it('switches to SI prefixes instead of printing 0.0007071 A', () => {
    expect(formatEngineering(0.0007071067811865475, 'A')).toBe('707.1 µA')
    expect(formatEngineering(0.00025, 'W')).toBe('250.0 µW')
    expect(formatEngineering(-0.00025, 'var')).toBe('-250.0 µvar')
    expect(formatEngineering(100000, 'Hz')).toBe('100.0 kHz')
  })

  it('handles zero, dimensionless values and non-finite input', () => {
    expect(formatEngineering(0, 'V')).toBe('0 V')
    expect(formatEngineering(2.0000012076814118)).toBe('2.000')
    expect(formatEngineering(Number.NaN, 'V')).toBe('— V')
    expect(formatEngineering(Number.POSITIVE_INFINITY, 'A')).toBe('— A')
  })
})

describe('formatPhaseDeg', () => {
  it('always prints two decimals with the degree sign', () => {
    expect(formatPhaseDeg(-45)).toBe('-45.00°')
    expect(formatPhaseDeg(0)).toBe('0.00°')
    expect(formatPhaseDeg(-135)).toBe('-135.00°')
  })

  it('normalises negative zero', () => {
    expect(formatPhaseDeg(-0)).toBe('0.00°')
  })
})

describe('formatPhasor', () => {
  it('renders the classroom notation "幅值 单位 ∠ 相角"', () => {
    expect(formatPhasor(0.7071067811865476, -45, 'V')).toBe('0.7071 V ∠ -45.00°')
    expect(formatPhasor(0.0007071067811865475, 45, 'A')).toBe('707.1 µA ∠ 45.00°')
    expect(formatPhasor(0, 0, 'V')).toBe('0 V ∠ 0.00°')
  })
})

describe('power helpers', () => {
  it('formats power factor with 4 decimals', () => {
    expect(formatPowerFactor(0.7071067811865476)).toBe('0.7071')
  })

  it('maps the sign of Q to 感性/容性 (与后端 convention 一致)', () => {
    expect(reactiveNature(-0.00025)).toBe('容性')
    expect(reactiveNature(0.00025)).toBe('感性')
    expect(reactiveNature(0)).toBe('纯阻性')
  })
})

describe('frequency / time / percent', () => {
  it('formats frequency with SI prefixes', () => {
    expect(formatFrequency(1000)).toBe('1.000 kHz')
    expect(formatFrequency(10)).toBe('10.00 Hz')
  })

  it('formats seconds', () => {
    expect(formatSeconds(0.4394296811201883)).toBe('0.4394 s')
    expect(formatSeconds(0.0015)).toBe('1.500 ms')
  })

  it('formats percentages with two decimals', () => {
    expect(formatPercent(0.0003936207767393094)).toBe('0.00 %')
    expect(formatPercent(16.3)).toBe('16.30 %')
  })
})

describe('formatStepMetrics', () => {
  const metrics: StepResponseMetrics = {
    settling_time_s: 0.7823937312558138,
    final_value: 1.9999933352921107,
    peak_time_s: 2.615,
    rise_time_s: 0.4394296811201883,
    peak_value: 2.0000012076814118,
    overshoot_pct: 0.0003936207767393094,
  }

  it('produces the six classroom readouts in a stable order', () => {
    const cards = formatStepMetrics(metrics)

    expect(cards.map((card) => card.key)).toEqual([
      'overshoot_pct',
      'rise_time_s',
      'settling_time_s',
      'peak_value',
      'peak_time_s',
      'final_value',
    ])
    expect(cards[0].value).toBe('0.00 %')
    expect(cards[1].value).toBe('0.4394 s')
    expect(cards[2].value).toBe('0.7824 s')
    expect(cards[3].value).toBe('2.000')
    expect(cards[4].value).toBe('2.615 s')
    expect(cards[5].value).toBe('2.000')
    expect(cards[1].label).toBe('上升时间')
  })
})
