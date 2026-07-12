import { describe, expect, it } from 'vitest';
import { extent, formatTick, makeScale, niceNum, niceTicks } from './chart';

describe('niceNum', () => {
  it('把跨度收敛到 1/2/5×10^k', () => {
    expect(niceNum(0.9, true)).toBeCloseTo(1, 10);
    expect(niceNum(1.4, true)).toBeCloseTo(1, 10);
    expect(niceNum(2.9, true)).toBeCloseTo(2, 10);
    expect(niceNum(6.9, true)).toBeCloseTo(5, 10);
    expect(niceNum(9.9, true)).toBeCloseTo(10, 10);
    expect(niceNum(0.021, true)).toBeCloseTo(0.02, 10);
  });

  it('round=false 时向上取', () => {
    expect(niceNum(1.1, false)).toBeCloseTo(2, 10);
    expect(niceNum(2.1, false)).toBeCloseTo(5, 10);
  });

  it('非法跨度退化为 1', () => {
    expect(niceNum(0, true)).toBe(1);
    expect(niceNum(-3, true)).toBe(1);
    expect(niceNum(NaN, true)).toBe(1);
  });
});

describe('niceTicks', () => {
  it('刻度覆盖数据域且首尾在轴端点上', () => {
    const t = niceTicks(0, 0.30145410639457193, 5);
    expect(t.min).toBeLessThanOrEqual(0);
    expect(t.max).toBeGreaterThanOrEqual(0.30145410639457193);
    expect(t.ticks[0]).toBe(t.min);
    expect(t.ticks[t.ticks.length - 1]).toBe(t.max);
    expect(t.step).toBeCloseTo(0.1, 10);
    expect(t.ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  it('等距且无浮点毛刺', () => {
    const t = niceTicks(0.8938422254522972, 0.9582647068655263, 5);
    for (let i = 1; i < t.ticks.length; i += 1) {
      expect(t.ticks[i] - t.ticks[i - 1]).toBeCloseTo(t.step, 9);
    }
    // 0.30000000000000004 这类毛刺必须被清掉
    expect(t.ticks.every((v) => String(v).length <= 8)).toBe(true);
  });

  it('常数序列（ω(t) 恒为 1.0 pu）也能撑开可读窗口', () => {
    const t = niceTicks(1, 1, 5);
    expect(t.max).toBeGreaterThan(t.min);
    expect(t.min).toBeLessThanOrEqual(1);
    expect(t.max).toBeGreaterThanOrEqual(1);
  });

  it('反序输入自动纠正，非有限值有兜底', () => {
    expect(niceTicks(5, 1).min).toBeLessThanOrEqual(1);
    const t = niceTicks(NaN, NaN);
    expect(Number.isFinite(t.min) && Number.isFinite(t.max)).toBe(true);
  });

  it('暂态时间轴 0..3 s', () => {
    const t = niceTicks(0, 2.99999999999978, 6);
    expect(t.min).toBe(0);
    expect(t.max).toBeGreaterThanOrEqual(3);
    expect(t.ticks).toContain(1);
  });
});

describe('makeScale', () => {
  it('线性映射端点与中点', () => {
    const s = makeScale(0, 10, 100, 200);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(200);
    expect(s(5)).toBe(150);
  });

  it('退化域返回像素域中点（不产生 NaN/Infinity）', () => {
    const s = makeScale(2, 2, 0, 300);
    expect(s(2)).toBe(150);
    expect(Number.isFinite(s(99))).toBe(true);
  });
});

describe('extent', () => {
  it('忽略非有限值', () => {
    expect(extent([3, NaN, 1, Infinity, 7])).toEqual([1, 7]);
  });
  it('空数组给出默认域', () => {
    expect(extent([])).toEqual([0, 1]);
  });
});

describe('formatTick', () => {
  it('小数位跟随步长', () => {
    expect(formatTick(0.3, 0.1)).toBe('0.3');
    expect(formatTick(1, 1)).toBe('1');
    expect(formatTick(0.91309, 0.005)).toBe('0.913');
  });
  it('极大值走科学计数（理想电源 4.6e5 kA 不会撑爆刻度）', () => {
    expect(formatTick(456042.86, 100000)).toBe('4.6e+5');
  });
});
