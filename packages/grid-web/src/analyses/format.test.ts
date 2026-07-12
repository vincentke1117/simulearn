import { describe, expect, it } from 'vitest';
import {
  esc,
  fmt,
  fmtKw,
  fmtSci,
  fmtZth,
  heatColor,
  heatDomain,
  isIdealSourceRow,
  n1LostLoadCell,
  realMaxRow,
  summarizeMaxBus,
} from './format';
import type { ShortCircuitEntry } from '../types';

// 取自真实响应 .samples/grid-shortcircuit.json（IEEE-33，全网扫描）
const SLACK_ROW: ShortCircuitEntry = {
  bus: 'bus-1',
  v_prefault_pu: 1,
  zth_pu: { r: 2.5849394142282115e-26, x: 0.0000010000000000000002 },
  i_f_pu: 999999.9999999999,
  i_f_ka: 456042.86665847205,
  s_sc_mva: 9999999.999999998,
};
const BUS2: ShortCircuitEntry = {
  bus: 'bus-2',
  v_prefault_pu: 0.9970322597745297,
  zth_pu: { r: 0.00575259116172393, x: 0.0029334488568440852 },
  i_f_pu: 154.4025898234988,
  i_f_ka: 70.41419968260064,
  s_sc_mva: 1544.025898234988,
};
const BUS18: ShortCircuitEntry = {
  bus: 'bus-18',
  v_prefault_pu: 0.913,
  zth_pu: { r: 0.85, x: 0.55 },
  i_f_pu: 1.02,
  i_f_ka: 0.4650391191518537,
  s_sc_mva: 102,
};
const ROWS = [SLACK_ROW, BUS2, BUS18];

describe('数字格式化', () => {
  it('fmt / fmtKw 带有效位', () => {
    expect(fmt(0.91309, 4)).toBe('0.9131');
    expect(fmt(undefined)).toBe('—');
    expect(fmtKw(0.20267711696940527, 1)).toBe('202.7 kW');
  });

  it('fmtSci 对理想电源的天文数字改用科学计数', () => {
    expect(fmtSci(456042.86665847205, 2)).toBe('4.56e+5');
    expect(fmtSci(70.41419968260064, 2)).toBe('70.41');
  });

  it('fmtZth 输出 r + jx（zth_pu 是对象，不是复数字符串）', () => {
    expect(fmtZth(BUS2.zth_pu)).toBe('0.00575 + j0.00293');
    expect(fmtZth(SLACK_ROW.zth_pu)).toContain('j1.0e-6');
  });
});

describe('slack 理想电源特判（教学坑）', () => {
  it('slack 行被判定为理想电源约定产物', () => {
    expect(isIdealSourceRow(SLACK_ROW, 'bus-1')).toBe(true);
  });

  it('真实母线不被误判', () => {
    expect(isIdealSourceRow(BUS2, 'bus-1')).toBe(false);
    expect(isIdealSourceRow(BUS18, 'bus-1')).toBe(false);
  });

  it('热力色标定标排除理想电源，否则其它母线全挤成一个颜色', () => {
    const domain = heatDomain(ROWS, 'bus-1');
    expect(domain).toEqual([0.4650391191518537, 70.41419968260064]);
    // 若不排除，domain 上界会是 4.6e5，bus-2 与 bus-18 的颜色将无法区分
    const naive: [number, number] = [0.465, 456042.87];
    expect(heatColor(BUS2.i_f_ka, naive)).toBe(heatColor(BUS18.i_f_ka, naive));
    expect(heatColor(BUS2.i_f_ka, domain)).not.toBe(heatColor(BUS18.i_f_ka, domain));
  });

  it('色标两端分别是蓝与红，域退化时不崩', () => {
    const domain = heatDomain(ROWS, 'bus-1')!;
    expect(heatColor(domain[0], domain)).toBe('rgb(37, 99, 235)');
    expect(heatColor(domain[1], domain)).toBe('rgb(220, 38, 38)');
    expect(heatColor(1, [5, 5])).toMatch(/^rgb\(/);
    expect(heatColor(1, null)).toBe('#94a3b8');
  });

  it('全是理想电源时 heatDomain 为 null', () => {
    expect(heatDomain([SLACK_ROW], 'bus-1')).toBeNull();
  });

  it('概览的「最大短路电流母线」若落在 slack 上要能被识别，并给出真实最大值', () => {
    const info = summarizeMaxBus(ROWS, 'bus-1', 'bus-1');
    expect(info).toEqual({ bus: 'bus-1', ideal: true });
    expect(realMaxRow(ROWS, 'bus-1')?.bus).toBe('bus-2');
  });

  it('最大值本来就是真实母线时不特判', () => {
    expect(summarizeMaxBus([BUS2, BUS18], 'bus-2', 'bus-1')).toEqual({ bus: 'bus-2', ideal: false });
  });
});

describe('esc', () => {
  it('转义会被浏览器当作标记的全部五个字符', () => {
    expect(esc('bus-1<img src=x onerror=alert(1)>')).toBe(
      'bus-1&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(esc(`a&b"c'd`)).toBe('a&amp;b&quot;c&#39;d');
    expect(esc(undefined)).toBe('');
  });
});

describe('n1LostLoadCell', () => {
  it('ok = 0.000；islanding = 后端给的值；diverged = 未知（后端不给 lost_load_mw）', () => {
    expect(n1LostLoadCell({ branch: 'l1', outcome: 'ok', loss_mw: 0.2 })).toBe('0.000');
    expect(n1LostLoadCell({ branch: 'l2', outcome: 'islanding', lost_load_mw: 1.2345 })).toBe('1.234');
    expect(n1LostLoadCell({ branch: 'l3', outcome: 'diverged' })).toBe('未知');
  });
});
