import { describe, expect, it } from 'vitest';
import { isDynamicMachine, validateForAnalysis, validateTopology } from './validation';
import type { Topology } from './types';

// 结构取自 packages/grid-backend/examples/smib.json
function smib(): Topology {
  return {
    meta: { baseMVA: 100, feeder: 'SMIB' },
    nodes: [
      { id: 'bus-1', type: 'Bus', kv: 10, is_slack: true, vm_pu: 1, vmin_pu: 0.5, vmax_pu: 1.5 },
      { id: 'bus-2', type: 'Bus', kv: 10, vm_pu: 1, vmin_pu: 0.5, vmax_pu: 1.5 },
      { id: 'grid-1', type: 'Gen', bus: 'bus-1', p_kw: 0, p_max_kw: 200000, p_min_kw: -200000, q_kvar: 0 },
      {
        id: 'gen-1',
        type: 'Gen',
        bus: 'bus-2',
        p_kw: 80000,
        p_max_kw: 100000,
        p_min_kw: 0,
        q_kvar: 0,
        h_s: 5,
        xd1_pu: 0.3,
        d_pu: 0,
      },
    ],
    links: [{ id: 'line-12', type: 'Line', from: 'bus-1', to: 'bus-2', r_ohm: 0, x_ohm: 0.2, rate_mva: 100 }],
  };
}

describe('isDynamicMachine', () => {
  it('必须同时有正的 h_s 与 xd1_pu', () => {
    expect(isDynamicMachine({ id: 'g', type: 'Gen', h_s: 5, xd1_pu: 0.3 })).toBe(true);
    expect(isDynamicMachine({ id: 'g', type: 'Gen', h_s: 5 })).toBe(false);
    expect(isDynamicMachine({ id: 'g', type: 'Gen', xd1_pu: 0.3 })).toBe(false);
    expect(isDynamicMachine({ id: 'g', type: 'Gen', h_s: 0, xd1_pu: 0.3 })).toBe(false);
    expect(isDynamicMachine({ id: 'g', type: 'Gen' })).toBe(false);
  });
});

describe('validateForAnalysis: transient', () => {
  it('smib 通过（gen-1 带 H/X′d，grid-1 作无穷大母线）', () => {
    const issues = validateForAnalysis(smib(), 'transient');
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('没有任何动态机组 → 可读的前置错误（不把 500/422 抛给学生）', () => {
    const topo = smib();
    topo.nodes = topo.nodes.map((n) => (n.id === 'gen-1' ? { ...n, h_s: undefined, xd1_pu: undefined } : n));
    const errors = validateForAnalysis(topo, 'transient').filter((i) => i.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('暂态动态机组');
  });

  it('动态参数只填一半 → 指名道姓地报出来', () => {
    const topo = smib();
    topo.nodes = topo.nodes.map((n) => (n.id === 'gen-1' ? { ...n, xd1_pu: undefined } : n));
    const errors = validateForAnalysis(topo, 'transient').filter((i) => i.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('gen-1');
  });

  it('所有电源都是动态机组 → 警告（没有无穷大母线参考）', () => {
    const topo = smib();
    topo.nodes = topo.nodes.map((n) => (n.id === 'grid-1' ? { ...n, h_s: 100, xd1_pu: 0.2 } : n));
    const issues = validateForAnalysis(topo, 'transient');
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.level === 'warning')).toHaveLength(1);
  });

  it('潮流/重构/N-1/时序不受动态参数缺失影响', () => {
    const topo = smib();
    topo.nodes = topo.nodes.map((n) => (n.id === 'gen-1' ? { ...n, h_s: undefined, xd1_pu: undefined } : n));
    for (const kind of ['pf', 'reconfig', 'n1', 'timeseries'] as const) {
      expect(validateForAnalysis(topo, kind)).toHaveLength(0);
    }
  });
});

describe('validateForAnalysis: shortcircuit', () => {
  it("没有机组给 X'd 时给出警告而非错误（仍可算，只是无机组贡献）", () => {
    const topo = smib();
    topo.nodes = topo.nodes.map((n) => (n.id === 'gen-1' ? { ...n, xd1_pu: undefined } : n));
    const issues = validateForAnalysis(topo, 'shortcircuit');
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.level === 'warning')).toHaveLength(1);
  });

  it('smib 有 X′d → 无提示', () => {
    expect(validateForAnalysis(smib(), 'shortcircuit')).toHaveLength(0);
  });
});

describe('validateTopology 基础规则仍然成立', () => {
  it('smib 拓扑本身合法', () => {
    expect(validateTopology(smib()).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('缺平衡节点报错', () => {
    const topo = smib();
    topo.nodes = topo.nodes.map((n) => (n.id === 'bus-1' ? { ...n, is_slack: false } : n));
    expect(validateTopology(topo).some((i) => i.level === 'error' && i.message.includes('平衡节点'))).toBe(true);
  });
});

describe('停运机组（status = 0）与后端保持一致地被排除', () => {
  it('isDynamicMachine 对停运机组返回 false（后端 dynamics.jl 要求 gen_status == 1）', () => {
    expect(isDynamicMachine({ id: 'g', type: 'Gen', h_s: 5, xd1_pu: 0.3, status: 0 })).toBe(false);
    expect(isDynamicMachine({ id: 'g', type: 'Gen', h_s: 5, xd1_pu: 0.3, status: 1 })).toBe(true);
    expect(isDynamicMachine({ id: 'g', type: 'Gen', h_s: 5, xd1_pu: 0.3 })).toBe(true); // status 缺省为 1
  });

  it('唯一动态机停运 → 前置校验拦下，并点名 status = 0（而不是把 422 丢给学生）', () => {
    const topo = smib();
    topo.nodes = topo.nodes.map((n) => (n.id === 'gen-1' ? { ...n, status: 0 } : n));
    const errors = validateForAnalysis(topo, 'transient').filter((i) => i.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('gen-1');
    expect(errors[0].message).toContain('停运');
  });

  it("停运机组的 X'd 不算数：短路分析仍应提示没有机组贡献", () => {
    const topo = smib();
    topo.nodes = topo.nodes.map((n) => (n.id === 'gen-1' ? { ...n, status: 0 } : n));
    const warnings = validateForAnalysis(topo, 'shortcircuit').filter((i) => i.level === 'warning');
    expect(warnings).toHaveLength(1);
  });
});
