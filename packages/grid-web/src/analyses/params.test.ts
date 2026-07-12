import { describe, expect, it } from 'vitest';
import {
  MAX_TIMESERIES_POINTS,
  parseLoadScale,
  parseShortCircuitParams,
  parseTransientParams,
  typicalDayScale,
} from './params';

describe('parseLoadScale', () => {
  it('逗号/空格/换行/分号混合分隔', () => {
    const r = parseLoadScale('0.5, 0.8 1.0\n1.2;1.5');
    expect(r.ok && r.value).toEqual([0.5, 0.8, 1.0, 1.2, 1.5]);
  });

  it('空输入报错', () => {
    const r = parseLoadScale('   ');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/不能为空/);
  });

  it('非正数被拒（后端要求 load_scale > 0）', () => {
    expect(parseLoadScale('1.0, 0').ok).toBe(false);
    expect(parseLoadScale('-0.5').ok).toBe(false);
  });

  it('非数字被拒', () => {
    const r = parseLoadScale('1.0, abc');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('abc');
  });

  it(`最多 ${MAX_TIMESERIES_POINTS} 点`, () => {
    const ok = parseLoadScale(Array(MAX_TIMESERIES_POINTS).fill('1').join(','));
    expect(ok.ok).toBe(true);
    const tooMany = parseLoadScale(Array(MAX_TIMESERIES_POINTS + 1).fill('1').join(','));
    expect(tooMany.ok).toBe(false);
    expect(!tooMany.ok && tooMany.error).toContain('97');
  });

  it('典型日 24 点自身可解析', () => {
    const r = parseLoadScale(typicalDayScale().join(','));
    expect(r.ok && r.value.length).toBe(24);
  });
});

describe('parseShortCircuitParams', () => {
  it('空母线 → null（全网扫描）', () => {
    const r = parseShortCircuitParams({ faultBus: '', zf: '0' });
    expect(r.ok && r.value).toEqual({ fault_bus: null, zf_pu: 0 });
  });

  it('指定母线与过渡电阻', () => {
    const r = parseShortCircuitParams({ faultBus: ' bus-18 ', zf: '0.05' });
    expect(r.ok && r.value).toEqual({ fault_bus: 'bus-18', zf_pu: 0.05 });
  });

  it('zf 为负或非数被拒', () => {
    expect(parseShortCircuitParams({ faultBus: '', zf: '-1' }).ok).toBe(false);
    expect(parseShortCircuitParams({ faultBus: '', zf: 'x' }).ok).toBe(false);
  });

  it('zf 留空按 0 处理', () => {
    const r = parseShortCircuitParams({ faultBus: 'bus-2', zf: '' });
    expect(r.ok && r.value.zf_pu).toBe(0);
  });
});

const base = {
  faultBus: 'bus-2',
  tFault: '0.1',
  tClear: '0.378402',
  zf: '0',
  tripBranch: '',
  tStop: '3.0',
  dt: '0.001',
  findCct: true,
};

describe('parseTransientParams', () => {
  it('SMIB 契约参数解析为后端请求形状', () => {
    const r = parseTransientParams(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fault).toEqual({
      bus: 'bus-2',
      t_fault_s: 0.1,
      t_clear_s: 0.378402,
      zf_pu: 0,
      trip_branch: null,
    });
    expect(r.value.sim).toEqual({ t_stop_s: 3.0, dt_s: 0.001 });
    expect(r.value.f_hz).toBe(50);
    expect(r.value.find_cct).toBe(true);
  });

  it('跳闸支路非空时透传', () => {
    const r = parseTransientParams({ ...base, tripBranch: 'br-5' });
    expect(r.ok && r.value.fault.trip_branch).toBe('br-5');
  });

  it('未选故障母线被拒', () => {
    const r = parseTransientParams({ ...base, faultBus: '' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/故障母线/);
  });

  it('t_clear 必须大于 t_fault（对齐后端校验）', () => {
    const r = parseTransientParams({ ...base, tClear: '0.1' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/t_clear/);
  });

  it('t_stop 不得小于 t_clear', () => {
    const r = parseTransientParams({ ...base, tClear: '0.5', tStop: '0.4' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/t_stop/);
  });

  it('dt 必须为正、zf 不能为负', () => {
    expect(parseTransientParams({ ...base, dt: '0' }).ok).toBe(false);
    expect(parseTransientParams({ ...base, zf: '-0.1' }).ok).toBe(false);
  });

  it('步数上限：dt 过小时提前拦下（后端 MAX_SIM_STEPS = 200000）', () => {
    const r = parseTransientParams({ ...base, dt: '0.000001', tStop: '3' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/步数/);
  });

  it('留空的数值字段回落到后端默认值', () => {
    const r = parseTransientParams({ ...base, tFault: '', tClear: '', tStop: '', dt: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fault.t_fault_s).toBe(0.1);
    expect(r.value.fault.t_clear_s).toBe(0.25);
    expect(r.value.sim).toEqual({ t_stop_s: 3, dt_s: 0.001 });
  });
});
