import { dia } from '@joint/core';
import type { Board } from './board';
import { isBus, isDevice } from './board';
import { createLink, createNodeElement, defaultLinkElec, styleLink } from './shapes';
import type { LinkType, NodeType, Topology, TopologyLink, TopologyNode } from './types';

const NODE_TYPES = new Set(['Bus', 'Load', 'Gen', 'DG']);
const LINK_TYPES = new Set(['Line', 'Switch']);

/** 画布 → 扁平拓扑 JSON（电气参数在顶层，与 Julia 契约一致；挂接线不导出）。 */
export function exportTopology(board: Board, meta: { baseMVA: number; feeder?: string }): Topology {
  const nodes: TopologyNode[] = [];
  const links: TopologyLink[] = [];

  for (const el of board.graph.getElements()) {
    const type = el.get('jgdoType') as NodeType | undefined;
    if (!type || !NODE_TYPES.has(type)) continue;
    const elec = (el.get('elec') ?? {}) as Record<string, unknown>;
    const pos = el.position();
    const node: TopologyNode = {
      id: String(el.id),
      type,
      name: String(el.attr('label/text') || el.id).replace(/ ★$/, ''),
      loc: { x: Math.round(pos.x), y: Math.round(pos.y) },
      ...elec,
    };
    if (type === 'Bus') delete node.bus;
    nodes.push(node);
  }

  for (const link of board.graph.getLinks()) {
    const kind = link.get('jgdoType');
    if (!kind || !LINK_TYPES.has(kind)) continue;
    const src = link.getSourceElement();
    const tgt = link.getTargetElement();
    if (!src || !tgt) continue;
    const elec = (link.get('elec') ?? {}) as Record<string, unknown>;
    links.push({
      id: String(link.id),
      type: kind as LinkType,
      from: String(src.id),
      to: String(tgt.id),
      r_ohm: Number(elec.r_ohm ?? 0),
      x_ohm: Number(elec.x_ohm ?? 0),
      rate_mva: elec.rate_mva !== undefined ? Number(elec.rate_mva) : undefined,
      status: (elec.status as 'CLOSED' | 'OPEN') ?? 'CLOSED',
      switchable: Boolean(elec.switchable ?? kind === 'Switch'),
    });
  }

  return {
    meta: { baseMVA: meta.baseMVA, feeder: meta.feeder ?? 'F1' },
    nodes,
    links,
  };
}

// h_s / xd1_pu / d_pu：机电暂态动态参数，后端 topology.jl 从 Gen/DG 节点原样透传。
// 之前这里没有列出，导致导入 smib 再导出/运行时动态参数被静默丢弃 → 暂态直接报错。
const DYNAMIC_KEYS = ['h_s', 'xd1_pu', 'd_pu'];
const ELEC_KEYS: Record<string, string[]> = {
  Bus: ['kv', 'is_slack', 'vm_pu', 'va_deg', 'vmin_pu', 'vmax_pu'],
  Load: ['bus', 'p_kw', 'q_kvar'],
  Gen: ['bus', 'p_kw', 'p_max_kw', 'p_min_kw', 'q_kvar', 'q_max_kvar', 'q_min_kvar', 'status', ...DYNAMIC_KEYS],
  DG: ['bus', 'p_kw', 'p_max_kw', 'p_min_kw', 'q_kvar', 'q_max_kvar', 'q_min_kvar', 'status', ...DYNAMIC_KEYS],
};

/** 扁平拓扑 JSON → 画布。缺 loc 的节点走 BFS 分层自动布局；设备自动生成挂接线。 */
export function importTopology(board: Board, topo: Topology): void {
  board.select(null);
  board.graph.clear();

  const nodes = (topo.nodes ?? []).filter((n) => NODE_TYPES.has(n.type));
  const links = (topo.links ?? []).filter((l) => LINK_TYPES.has(l.type));
  const layout = computeLayout(nodes, links);

  const cells: dia.Cell[] = [];
  const byId = new Map<string, dia.Element>();

  for (const node of nodes) {
    const el = createNodeElement(node.type, node.id, node.name ?? node.id);
    const elec: Record<string, unknown> = {};
    for (const key of ELEC_KEYS[node.type]) {
      if (node[key] !== undefined) elec[key] = node[key];
      else if ((el.get('elec') as Record<string, unknown>)[key] !== undefined) {
        elec[key] = (el.get('elec') as Record<string, unknown>)[key];
      }
    }
    el.set('elec', elec);
    const pos = node.loc && Number.isFinite(node.loc.x) ? node.loc : layout.get(node.id)!;
    el.position(pos.x, pos.y);
    if (node.type === 'Bus' && node.is_slack) {
      el.attr('label/text', `${node.name ?? node.id} ★`);
    }
    byId.set(node.id, el);
    cells.push(el);
  }

  for (const spec of links) {
    const src = byId.get(spec.from);
    const tgt = byId.get(spec.to);
    if (!src || !tgt) continue;
    const link = createLink(spec.type, spec.id);
    link.source({ id: src.id });
    link.target({ id: tgt.id });
    const defaults = defaultLinkElec(spec.type);
    link.set('elec', {
      r_ohm: spec.r_ohm ?? defaults.r_ohm,
      x_ohm: spec.x_ohm ?? defaults.x_ohm,
      rate_mva: spec.rate_mva ?? defaults.rate_mva,
      status: spec.status ?? 'CLOSED',
      switchable: spec.switchable ?? spec.type === 'Switch',
    });
    styleLink(link);
    cells.push(link);
  }

  // 设备 → 母线挂接线
  for (const node of nodes) {
    if (node.type === 'Bus' || !node.bus) continue;
    const device = byId.get(node.id);
    const bus = byId.get(String(node.bus));
    if (!device || !bus) continue;
    const link = createLink('Line', `at-${node.id}`);
    link.set('jgdoType', 'attach');
    link.set('elec', {});
    link.source({ id: device.id });
    link.target({ id: bus.id });
    styleLink(link);
    cells.push(link);
  }

  board.graph.addCells(cells);
  board.fitContent();
}

/** BFS 分层布局：母线按到平衡节点的图距离分列，设备挂在所属母线下方。 */
function computeLayout(
  nodes: TopologyNode[],
  links: TopologyLink[],
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const buses = nodes.filter((n) => n.type === 'Bus');
  if (buses.length === 0) return result;

  const adjacency = new Map<string, string[]>();
  for (const bus of buses) adjacency.set(bus.id, []);
  for (const link of links) {
    if (adjacency.has(link.from) && adjacency.has(link.to)) {
      adjacency.get(link.from)!.push(link.to);
      adjacency.get(link.to)!.push(link.from);
    }
  }

  const root = buses.find((b) => b.is_slack) ?? buses[0];
  const depth = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, depth.get(current)! + 1);
        queue.push(next);
      }
    }
  }

  const lanes = new Map<number, number>();
  for (const bus of buses) {
    const d = depth.get(bus.id) ?? 0;
    const lane = lanes.get(d) ?? 0;
    lanes.set(d, lane + 1);
    result.set(bus.id, { x: 90 + d * 300, y: 90 + lane * 200 });
  }

  const deviceCount = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === 'Bus') continue;
    const busId = String(node.bus ?? '');
    const busPos = result.get(busId);
    const n = deviceCount.get(busId) ?? 0;
    deviceCount.set(busId, n + 1);
    result.set(
      node.id,
      busPos
        ? { x: busPos.x + 30 + n * 80, y: busPos.y + 85 }
        : { x: 90, y: 600 + (deviceCount.get('') ?? 0) * 90 },
    );
  }

  return result;
}

/** 若图中还没有平衡节点，把新加的母线设为平衡节点。 */
export function shouldBeSlack(board: Board): boolean {
  for (const el of board.graph.getElements()) {
    if (isBus(el)) {
      const elec = (el.get('elec') ?? {}) as Record<string, unknown>;
      if (elec.is_slack) return false;
    }
  }
  return true;
}

export { isBus, isDevice };
