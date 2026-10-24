import { describe, expect, it } from 'vitest';

import { capacitorOptions, tapKv, tapOptions, transformerLabel } from './transformer';

// 教材例 12-3：110±2×2.5%/6.3 kV
const t1 = { hv_kv: 110, lv_kv: 6.3, tap_step_pct: 2.5, tap_steps: 2, tap_pos: -1 };

describe('transformer taps (例 12-3)', () => {
  it('computes the tap voltage of each position', () => {
    expect(tapKv(t1)).toBeCloseTo(107.25, 10);
    [104.5, 107.25, 110, 112.75, 115.5].forEach((kv, i) => expect(tapKv(t1, i - 2)).toBeCloseTo(kv, 10));
  });

  it('lists the five positions with their kV for the inspector', () => {
    const options = tapOptions(t1);
    expect(options.map((o) => o.value)).toEqual(['-2', '-1', '0', '1', '2']);
    expect(options[1].label).toBe('-1 挡（107.25 kV）');
    expect(options[2].label).toBe('0 挡（110.00 kV，额定）');
    expect(options[4].label).toBe('+2 挡（115.50 kV）');
  });

  it('labels the transformer by its current ratio', () => {
    expect(transformerLabel(t1)).toBe('107.25/6.3 kV');
    expect(transformerLabel({ ...t1, tap_pos: 0 })).toBe('110/6.3 kV');
  });

  it('tolerates missing step settings (fixed-ratio transformer)', () => {
    expect(tapOptions({ hv_kv: 35, lv_kv: 10.5 })).toEqual([{ value: '0', label: '0 挡（35.00 kV，额定）' }]);
  });
});

describe('capacitor groups', () => {
  it('lists 0..groups with the switched-in capacity', () => {
    const options = capacitorOptions({ q_unit_kvar: 2000, groups: 4 });
    expect(options.map((o) => o.value)).toEqual(['0', '1', '2', '3', '4']);
    expect(options[0].label).toBe('0 组（0 Mvar）');
    expect(options[4].label).toBe('4 组（8 Mvar）');
  });
});
