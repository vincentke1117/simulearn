// 拓扑 JSON 契约（与 Julia 侧 src/types.jl + src/topology.jl 对齐）：
// 电气参数一律是【顶层扁平字段】，Julia 的 Node(obj) 会把除 id/type 外的顶层键收进 data。

export type NodeType = 'Bus' | 'Load' | 'Gen' | 'DG';
export type LinkType = 'Line' | 'Switch';
export type SwitchStatus = 'CLOSED' | 'OPEN';

export interface TopologyMeta {
  baseMVA: number;
  feeder?: string;
  description?: string;
}

export interface TopologyNode {
  id: string;
  type: NodeType;
  name?: string;
  loc?: { x: number; y: number };
  // Bus
  kv?: number;
  is_slack?: boolean;
  vm_pu?: number;
  va_deg?: number;
  vmin_pu?: number;
  vmax_pu?: number;
  // Load / Gen / DG
  bus?: string;
  p_kw?: number;
  q_kvar?: number;
  p_max_kw?: number;
  p_min_kw?: number;
  q_max_kvar?: number;
  q_min_kvar?: number;
  status?: number;
  [key: string]: unknown;
}

export interface TopologyLink {
  id: string;
  type: LinkType;
  from: string;
  to: string;
  r_ohm: number;
  x_ohm: number;
  rate_mva?: number;
  status?: SwitchStatus;
  switchable?: boolean;
  b_siemens?: number;
  [key: string]: unknown;
}

export interface Topology {
  meta: TopologyMeta;
  nodes: TopologyNode[];
  links: TopologyLink[];
}

// ---- 后端响应契约（与 src/errors.jl + src/powerflow.jl + src/optimization.jl 对齐） ----

export interface ApiEnvelope<T> {
  status: 'ok' | 'error';
  message: string;
  code?: string;
  path?: string[];
  data: T | null;
}

export interface BusResult {
  id: string;
  vm_pu: number;
  va_deg: number;
  vmin_pu: number;
  vmax_pu: number | null;
  violation: 'low' | 'high' | null;
}

export interface BranchResult {
  id: string;
  p_mw: number;
  q_mvar: number;
  p_to_mw: number;
  q_to_mvar: number;
  loss_mw: number;
  loading_pct: number;
  status: SwitchStatus;
  overloaded: boolean;
}

export interface PfSummary {
  loss_mw: number;
  vmin_pu: number;
  vmin_bus: string;
  violation_buses: string[];
  overloaded_branches: string[];
  solve_time_s: number;
  termination_status: string;
}

export interface PfResult {
  status: string;
  type: string;
  buses: BusResult[];
  branches: BranchResult[];
  summary: PfSummary;
}

export interface SwitchSchedule {
  id: string;
  status: SwitchStatus;
}

export interface DgDispatch {
  id: string;
  p_mw: number;
  q_mvar: number;
}

export interface ReconfigResult {
  status: string;
  type: string;
  switch_schedule: SwitchSchedule[];
  dg_dispatch: DgDispatch[];
  summary: {
    loss_before_mw: number;
    loss_after_mw: number;
    improvement_pct: number;
    solve_time_s: number | null;
  };
  pf: PfResult;
}

export interface ExampleInfo {
  name: string;
  feeder: string;
  description: string;
}
