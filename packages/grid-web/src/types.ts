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

// ---- 七种分析 ----

export type AnalysisKind = 'pf' | 'opf' | 'reconfig' | 'n1' | 'timeseries' | 'shortcircuit' | 'transient';

// ---- 最优潮流 / 经济调度（src/optimization.jl::execute_opf，请求体 = 拓扑 JSON 直接置于顶层） ----

/** OPF 母线 = 潮流母线 + 节点边际电价（LMP）。 */
export interface OpfBus extends BusResult {
  lmp_yuan_per_mwh: number;
}

/**
 * OPF 机组。marginal_cost = dC/dP = 2·c2·P + c1。
 * 教学核心：**未顶限**（binding=false）的机组，其边际成本 == 所在母线的 LMP（它在"定价"）；
 * 顶限机组（at_pmin / at_pmax）退出定价，其边际成本与 LMP 不再相等。
 */
export interface OpfGen {
  id: string;
  bus: string;
  pg_mw: number;
  qg_mvar: number;
  pmin_mw: number;
  pmax_mw: number;
  cost_c0: number;
  cost_c1: number;
  cost_c2: number;
  cost_yuan_per_h: number;
  marginal_cost_yuan_per_mwh: number;
  at_pmin: boolean;
  at_pmax: boolean;
  binding: boolean;
}

export interface OpfSummary {
  cost_total_yuan_per_h: number;
  gen_total_mw: number;
  load_total_mw: number;
  loss_mw: number;
  termination_status: string;
  solve_time_s: number;
  vmin_pu: number;
  vmin_bus: string;
  violation_buses: string[];
  overloaded_branches: string[];
  lmp_min_yuan_per_mwh: number;
  lmp_min_bus: string;
  lmp_max_yuan_per_mwh: number;
  lmp_max_bus: string;
}

/** branches 与潮流 PfResult 的支路格式同构 —— 可直接复用 paintResults 的画布着色。 */
export interface OpfResult {
  status: string;
  type: string;
  buses: OpfBus[];
  branches: BranchResult[];
  gens: OpfGen[];
  objective: {
    termination_status: string;
    solve_time_s: number;
    cost_total_yuan_per_h: number;
  };
  summary: OpfSummary;
}

// ---- N-1 开断扫描（src/analysis.jl::execute_n1，请求体 = {topology, restore}） ----

export type N1Outcome = 'ok' | 'islanding' | 'diverged';

/** islanding 行带 islanded_buses/lost_load_mw；ok 行带 loss_mw/vmin_pu/vmin_bus/violation_buses；diverged 行只有 branch/outcome。 */
export interface N1Entry {
  branch: string;
  outcome: N1Outcome;
  islanded_buses?: string[];
  lost_load_mw?: number;
  loss_mw?: number;
  vmin_pu?: number;
  vmin_bus?: string;
  violation_buses?: string[];
}

/**
 * 转供恢复条目（restore=true 时每条开断一条，可恢复/不可恢复**键集合完全一致**）。
 * 不可恢复条目：恢复后才有意义的字段为 null（loss_mw / vmin_pu / vmin_bus / violated /
 * radial / n_closed_branches / n_loops_after），数组为 []。null ≠ 0，界面上必须区分。
 */
export interface N1RestorationEntry {
  branch: string;
  restorable: boolean;
  fully_restored: boolean;
  reason: string | null;
  islanded_buses: string[];
  islanded_buses_after: string[];
  lost_load_before_mw: number;
  lost_load_after_mw: number;
  candidate_ties: string[];
  closed_ties: string[];
  n_candidates_evaluated: number;
  search_depth: number;
  max_search_depth: number;
  loss_mw: number | null;
  vmin_pu: number | null;
  vmin_bus: string | null;
  violated: boolean | null;
  violation_buses: string[];
  overloaded_branches: string[];
  radial: boolean | null;
  n_closed_branches: number | null;
  n_loops_base: number;
  n_loops_after: number | null;
  n_bus: number;
}

export interface N1Result {
  type: string;
  results: N1Entry[];
  /** 仅当请求 restore=true 时存在。 */
  restoration?: N1RestorationEntry[];
  summary: {
    n_branches: number;
    n_islanding: number;
    n_ok: number;
    n_diverged: number;
    max_lost_load_mw: number;
    worst_branch: string | null;
    n_restorable?: number;
    n_unrestorable?: number;
    max_search_depth?: number;
    n_loops_base?: number;
  };
}

/** N-1 请求体。⚠️ max_ties 已被后端删除，带上它直接 422（GRID_VALIDATION）。 */
export interface N1Request {
  topology: Topology;
  restore: boolean;
}

// ---- 时序潮流（请求体 {topology, load_scale}） ----

export interface TimeseriesPoint {
  scale: number;
  outcome: 'ok' | 'diverged';
  loss_mw?: number;
  vmin_pu?: number;
  vmin_bus?: string;
  violation_count?: number;
}

export interface TimeseriesResult {
  type: string;
  points: TimeseriesPoint[];
  summary: {
    n_points: number;
    max_loss_mw: number | null;
    min_vmin_pu: number | null;
  };
}

// ---- 短路计算（请求体 {topology, fault_bus, zf_pu}） ----

/** zth_pu 是对象 {r, x}（不是复数字符串，不是数组）。 */
export interface ShortCircuitEntry {
  bus: string;
  v_prefault_pu: number;
  zth_pu: { r: number; x: number };
  i_f_pu: number;
  i_f_ka: number;
  s_sc_mva: number;
}

export interface ShortCircuitResult {
  type: string;
  results: ShortCircuitEntry[];
  summary: {
    max_bus: string;
    max_i_f_ka: number;
    min_bus: string;
    min_i_f_ka: number;
  };
}

export interface ShortCircuitRequest {
  topology: Topology;
  fault_bus: string | null;
  zf_pu: number;
}

// ---- 暂态稳定（请求体 {topology, fault, sim, f_hz, find_cct}） ----

export interface TransientFault {
  bus: string;
  t_fault_s: number;
  t_clear_s: number;
  zf_pu: number;
  trip_branch: string | null;
}

export interface TransientSim {
  t_stop_s: number;
  dt_s: number;
}

export interface TransientRequest {
  topology: Topology;
  fault: TransientFault;
  sim: TransientSim;
  f_hz: number;
  find_cct: boolean;
}

export interface TransientMachine {
  id: string;
  h_s: number;
  xd1_pu: number;
  delta0_deg: number;
  pm_pu: number;
}

/** series.delta_deg / series.omega_pu 是 机组 id → 数组 的字典（不是数组的数组）。 */
export interface TransientResult {
  type: string;
  stable: boolean;
  t_unstable_s: number | null;
  cct_s: number | null;
  fault: TransientFault;
  machines: TransientMachine[];
  series: {
    t_s: number[];
    delta_deg: Record<string, number[]>;
    omega_pu: Record<string, number[]>;
  };
}

export interface TimeseriesRequest {
  topology: Topology;
  load_scale: number[];
}
