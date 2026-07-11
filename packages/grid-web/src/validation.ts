import type { Topology } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
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
