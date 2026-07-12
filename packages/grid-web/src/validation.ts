import type { AnalysisKind, Topology, TopologyNode } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

const isGen = (n: TopologyNode) => n.type === 'Gen' || n.type === 'DG';

/**
 * 机组是否在运。后端 topology.jl 把节点的 status 原样写成 gen_status（缺省 1），
 * 而 dynamics.jl::extract_machines / shortcircuit.jl 都要求 gen_status == 1 才收这台机。
 */
export function isInService(node: TopologyNode): boolean {
  return Number(node.status ?? 1) === 1;
}

/**
 * 一台机组是否具备暂态建模所需的动态参数。
 * 后端 dynamics.jl::extract_machines 的入选条件：**在运**（gen_status == 1）+ 有 h_s + 必须同时有 xd1_pu。
 * 停运机组即便填了 H/X'd 后端也不收，前端跟着排除，否则「唯一动态机 status=0」会被前置校验放行、
 * 到后端才抛 no generator provides dynamic parameters (h_s)。
 */
export function isDynamicMachine(node: TopologyNode): boolean {
  if (!isInService(node)) return false;
  const h = Number(node.h_s);
  const xd1 = Number(node.xd1_pu);
  return Number.isFinite(h) && h > 0 && Number.isFinite(xd1) && xd1 > 0;
}

/**
 * 分析类型相关的前置校验（在 validateTopology 之外追加）。
 * 目的：把后端会抛的 422/500 提前翻译成学生看得懂的中文，而不是把堆栈丢给他。
 */
export function validateForAnalysis(topo: Topology, kind: AnalysisKind): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allGens = (topo.nodes ?? []).filter(isGen);
  // 后端（dynamics.jl / shortcircuit.jl）只看在运机组，前端的前置校验必须用同一个集合
  const gens = allGens.filter(isInService);

  if (kind === 'transient') {
    const machines = gens.filter(isDynamicMachine);
    if (machines.length === 0) {
      // 后端会抛 "no generator provides dynamic parameters (h_s)"（422）——但学生根本不知道去哪填
      const halfDone = gens.filter((g) => g.h_s !== undefined || g.xd1_pu !== undefined);
      // 填了 H/X'd 但被 status=0 停运的机组：后端直接跳过，学生看不出为什么"明明填了"还报错
      const stopped = allGens.filter((g) => !isInService(g) && (g.h_s !== undefined || g.xd1_pu !== undefined));
      issues.push({
        level: 'error',
        message: halfDone.length
          ? `电源 ${halfDone.map((g) => g.id).join('、')} 的动态参数不完整：暂态分析要求同时给出 H (h_s > 0) 与 X'd (xd1_pu > 0)`
          : stopped.length
            ? `电源 ${stopped.map((g) => g.id).join('、')} 填了动态参数但处于停运（status = 0），后端不会把它建成动态机组：请把 status 改回 1，或另加一台在运的动态机组`
            : "暂态分析需要至少一台动态机组：选中一个电源/DG，在检查器「机电暂态参数」里勾选「暂态动态机组」并填写 H (s) 与 X'd (pu)",
      });
    } else if (machines.length === gens.length && gens.length > 1) {
      issues.push({
        level: 'warning',
        message: '所有电源都被建模为动态机组，系统中没有无穷大母线参考；若结果异常，可把并网点电源的动态参数关掉',
      });
    }
  }

  if (kind === 'shortcircuit') {
    const withXd1 = gens.filter((g) => Number.isFinite(Number(g.xd1_pu)) && Number(g.xd1_pu) > 0);
    if (withXd1.length === 0) {
      issues.push({
        level: 'warning',
        message: "没有任何机组给出 X'd：短路电流将只由平衡节点（理想电源）与线路阻抗决定，机组不提供短路电流贡献",
      });
    }
  }

  return issues;
}

/** 前端预检：拦住必然会被 Julia 拒绝或产生无意义结果的拓扑。后端仍是最终权威。 */
export function validateTopology(topo: Topology): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });

  if (!Number.isFinite(topo.meta.baseMVA) || topo.meta.baseMVA <= 0) {
    err('基准容量 baseMVA 必须为正数');
  }

  const buses = topo.nodes.filter((n) => n.type === 'Bus');
  if (buses.length === 0) err('至少需要一条母线');

  const slacks = buses.filter((b) => b.is_slack);
  if (buses.length > 0 && slacks.length === 0) err('缺少平衡节点：请在某条母线上勾选「平衡节点」');
  if (slacks.length > 1) err(`存在 ${slacks.length} 个平衡节点，只能有一个`);

  const busIds = new Set(buses.map((b) => b.id));
  for (const bus of buses) {
    if (!Number.isFinite(bus.kv) || (bus.kv as number) <= 0) err(`母线 ${bus.id} 缺少有效的额定电压 kv`);
  }

  for (const node of topo.nodes) {
    if (node.type === 'Bus') continue;
    if (!node.bus) {
      err(`${node.type} ${node.id} 未挂接母线（从设备拖一条线到母线）`);
    } else if (!busIds.has(String(node.bus))) {
      err(`${node.type} ${node.id} 挂接的母线 ${node.bus} 不存在`);
    }
    if (node.type === 'Load' && (!Number.isFinite(node.p_kw) || !Number.isFinite(node.q_kvar))) {
      err(`负荷 ${node.id} 缺少 p_kw / q_kvar`);
    }
  }

  if (topo.links.length === 0 && buses.length > 1) err('多条母线之间没有任何连线');

  const seen = new Set<string>();
  for (const link of topo.links) {
    if (!busIds.has(link.from) || !busIds.has(link.to)) {
      err(`支路 ${link.id} 的端点必须都是母线`);
      continue;
    }
    if (link.from === link.to) err(`支路 ${link.id} 两端连接了同一条母线`);
    const r = Number(link.r_ohm ?? 0);
    const x = Number(link.x_ohm ?? 0);
    if (r < 0 || x < 0) err(`支路 ${link.id} 的阻抗不能为负`);
    if (r === 0 && x === 0 && (link.status ?? 'CLOSED') === 'CLOSED') {
      err(`支路 ${link.id} 阻抗为零（r_ohm 与 x_ohm 至少一项应大于 0）`);
    }
    if (seen.has(link.id)) err(`支路 id 重复：${link.id}`);
    seen.add(link.id);
  }

  // 重构可行性提示（与 Julia 侧辐射预检对应）
  const closedFixed = topo.links.filter(
    (l) => (l.status ?? 'CLOSED') === 'CLOSED' && !(l.switchable ?? l.type === 'Switch'),
  ).length;
  if (buses.length > 1 && closedFixed > buses.length - 1) {
    warn(
      `闭合且不可开断的支路（${closedFixed}）多于生成树规模（${buses.length - 1}），重构优化将不可行；潮流计算不受影响`,
    );
  }

  return issues;
}
