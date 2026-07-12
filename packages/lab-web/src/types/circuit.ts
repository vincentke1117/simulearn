import type { CircuitComponentType } from '@/circuit/components'
import type { ControlOutputPayload, ControlSimulationPayload, MixedBlockPayload } from '@/types/control'

// 分析方法枚举
export type AnalysisMethod =
  | 'transient'           // 瞬态分析（时域仿真）
  | 'node_voltage'        // 节点电压法（直流稳态）
  | 'branch_current'      // 支路电流法
  | 'mesh_current'        // 网孔电流法
  | 'thevenin'           // 戴维南等效
  | 'dc_op'              // 直流工作点（电容开路、电感短路、交流源置直流分量）
  | 'ac_phasor'          // 交流相量分析（单频正弦稳态）
  | 'frequency_sweep'    // 频率扫描（Bode 图）

// 频率扫描配置（后端硬约束：n_points ∈ [2,401]，v1 仅支持 log 刻度）
export const SWEEP_MIN_POINTS = 2
export const SWEEP_MAX_POINTS = 401

export interface SweepSettings {
  fStartHz: number
  fStopHz: number
  nPoints: number
  scale: 'log'
}

export const defaultSweepSettings: SweepSettings = {
  fStartHz: 10,
  fStopHz: 100_000,
  nPoints: 61,
  scale: 'log',
}

// 后端 sweep 字段（顶层，与 method 平级）
export interface SweepPayload {
  f_start_hz: number
  f_stop_hz: number
  n_points: number
  scale: 'log'
}

export interface CircuitNodeData {
  label: string
  type: CircuitComponentType
  parameters: Record<string, number>
  // 组件旋转角度（度），用于纯视觉旋转：0/90/180/270
  rotation?: number
  // 字体大小 (px)，默认 12
  fontSize?: number
  // 仿真结果数据（节点电压法）
  voltage?: number  // 节点电压值
  // 元件两端的电压差（用于电压源副行或“元件电压差”显示）
  voltageDelta?: number
  // 元件电流值（用于电流表显示）
  current?: number
  // 索引签名，允许 React Flow 的 NodeTypes 泛型约束
  [key: string]: unknown
}

export interface SimulationSettings {
  tStop: number
  nSamples: number
  method?: AnalysisMethod  // 分析方法，未指定则自动检测
  comparisonMethods?: AnalysisMethod[]  // 对比模式：同时运行的多个方法
  // 电压显示模式：node 显示网络节点电压；element 显示元件两端电压差
  voltageDisplayMode?: 'node' | 'element'
  // 是否显示支路电流
  showBranchCurrents?: boolean
  // 频率扫描配置（method === 'frequency_sweep' 时使用）
  sweep?: SweepSettings
}

// 戴维南端口配置
export interface TheveninPortConfig {
  positiveNode: string  // 正端节点ID
  negativeNode: string  // 负端节点ID（通常是地）
}

export interface CircuitProjectNode {
  id: string
  type: CircuitComponentType
  position: { x: number; y: number }
  data: CircuitNodeData
}

export interface CircuitProjectEdge {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

export interface CircuitProject {
  nodes: CircuitProjectNode[]
  edges: CircuitProjectEdge[]
}

export interface SimulationComponentPayload {
  id: string
  type: CircuitComponentType
  parameters: Record<string, number>
  connections: Record<string, string>
}

export interface SimulationNetPayload {
  name: string
  nodes: [string, string][]
}

export interface SimulationPayload {
  kind?: 'circuit'
  components: SimulationComponentPayload[]
  nets: SimulationNetPayload[]
  sim: {
    t_stop: number
    n_samples: number
  }
  method?: AnalysisMethod  // 分析方法，默认为 transient
  thevenin_port?: { positive: string; negative: string }  // 戴维南端口（后端格式）
  teaching_mode?: boolean  // 教学模式
  sweep?: SweepPayload  // 频率扫描参数（顶层字段，method === 'frequency_sweep' 时必需）
}

export interface MixedBridgeBindingPayload {
  blockId: string
  positiveNet: string
  negativeNet: string
}

export interface MixedSimulationPayload {
  kind: 'mixed'
  blocks: MixedBlockPayload[]
  edges: {
    id: string
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }[]
  outputs: ControlOutputPayload[]
  bridges: MixedBridgeBindingPayload[]
  circuit: {
    components: SimulationComponentPayload[]
    nets: SimulationNetPayload[]
  }
  sim: {
    t_stop: number
    n_samples: number
  }
}

export type SimulationRequestPayload = SimulationPayload | ControlSimulationPayload | MixedSimulationPayload

export interface SimulationSignal {
  id: string
  label: string
  values: number[]
}

// 阶跃响应指标（控制/混合仿真：后端按信号 id 聚合，键与 SimulationSignal.id 一致，如 "scope:SCOPE1"）
export interface StepResponseMetrics {
  final_value: number      // 稳态值
  overshoot_pct: number    // 超调量（%）
  rise_time_s: number      // 上升时间 10%→90%（s）
  settling_time_s: number  // 调节时间 ±2%（s）
  peak_value: number       // 峰值
  peak_time_s: number      // 峰值时刻（s）
}

// 瞬态分析数据
export interface SimulationData {
  time: number[]
  signals: SimulationSignal[]
  // 控制/混合仿真才有；纯电路瞬态与旧结果没有该字段 → 消费方必须优雅降级
  metrics?: Record<string, StepResponseMetrics>
}

// 节点电压法结果
export interface NodeVoltageResult {
  node_voltages: Record<string, number>  // 节点名 -> 电压值
  branch_currents: Record<string, number> // 元件ID -> 电流值
  steps?: string[]  // 教学模式：求解步骤（可选）
}

// 戴维南等效结果
export interface TheveninResult {
  vth: number  // 戴维南电压（V）
  rth: number  // 戴维南电阻（Ω）
  port: { positive: string; negative: string }  // 端口节点名称
}

// 支路电流法结果
export interface BranchCurrentResult {
  branch_currents: Record<string, number>  // 支路ID -> 电流值
  node_voltages: Record<string, number>    // 节点名 -> 电压值
}

// 网孔电流法结果
export interface MeshCurrentResult {
  mesh_currents: Record<string, number>    // 网孔ID -> 电流值
  branch_currents: Record<string, number>  // 支路ID -> 电流值
  node_voltages: Record<string, number>    // 节点名 -> 电压值
}

// 直流工作点结果（电容开路 / 电感短路 / 交流源取直流分量）——与节点电压法同构
export interface DcOpResult {
  node_voltages: Record<string, number>
  branch_currents: Record<string, number>
}

// 交流相量功率（源为输出功率，元件为耗散有功）
export interface AcSourcePower {
  p_w: number      // 有功功率（W）
  q_var: number    // 无功功率（var），>0 感性、<0 容性
  s_va: number     // 视在功率（VA）
  pf: number       // 功率因数
}

export interface AcElementPower {
  p_w: number      // 元件耗散有功（W）
}

export interface AcPowerResult {
  convention: string  // 后端下发的功率约定说明，原样展示，不要改写
  sources: Record<string, AcSourcePower>
  elements: Record<string, AcElementPower>
}

// 交流相量分析结果（单频正弦稳态；幅值为峰值约定）
export interface AcPhasorResult {
  frequency_hz: number
  node_voltages: Record<string, number>      // 幅值（峰值）
  node_phases_deg: Record<string, number>    // 相角（度）
  branch_currents: Record<string, number>    // 幅值（峰值）
  branch_phases_deg: Record<string, number>  // 相角（度）
  power: AcPowerResult
}

// 频率扫描（Bode）单探针曲线
export interface SweepProbeCurve {
  mag: number[]
  phase_deg: number[]
  mag_db: number[]
}

export interface FrequencySweepResult {
  freq_hz: number[]
  probes: Record<string, SweepProbeCurve>
}

// 互比模式结果（每个方法一条输入）
export interface ComparisonResult {
  [method: string]: AnalysisResultData | null
}

// 统一的分析结果数据
export type AnalysisResultData =
  | SimulationData          // 瞬态分析
  | NodeVoltageResult       // 节点电压法
  | TheveninResult          // 戴维南等效
  | BranchCurrentResult     // 支路电流法
  | MeshCurrentResult       // 网孔电流法
  | DcOpResult              // 直流工作点
  | AcPhasorResult          // 交流相量分析
  | FrequencySweepResult    // 频率扫描 (Bode)
  | ComparisonResult        // 互比模式的多个结果

export type DiscriminatedResult =
  | ({ type: 'single'; method: AnalysisMethod; data: Exclude<AnalysisResultData, ComparisonResult> })
  | ({ type: 'comparison'; data: ComparisonResult })

export const isSingleResult = (r: DiscriminatedResult): r is { type: 'single'; method: AnalysisMethod; data: Exclude<AnalysisResultData, ComparisonResult> } => r.type === 'single'
export const isComparisonResultDisc = (r: DiscriminatedResult): r is { type: 'comparison'; data: ComparisonResult } => r.type === 'comparison'
export const hasNodeVoltages = (d: AnalysisResultData): d is NodeVoltageResult | BranchCurrentResult | MeshCurrentResult => typeof d === 'object' && d !== null && 'node_voltages' in d
export const hasBranchCurrents = (d: AnalysisResultData): d is BranchCurrentResult | MeshCurrentResult => typeof d === 'object' && d !== null && 'branch_currents' in d

export interface SimulationSuccessResponse {
  status: 'ok'
  message: string
  method?: AnalysisMethod  // 使用的分析方法
  data: AnalysisResultData  // 根据方法返回不同类型的数据
}

export interface SimulationErrorResponse {
  status: 'error'
  message: string
  code?: string  // 后端 422/500 的机器可读错误码，如 LAB_VALIDATION —— 必须展示给学生，不要吞掉
  data?: Record<string, unknown>
}

export type SimulationResponse = SimulationSuccessResponse | SimulationErrorResponse

/** 前端持有的错误信息：后端 422/500 的 message + code + 诊断字段都要能显示出来，不许吞 */
export interface SimulationErrorInfo {
  message: string
  code?: string
  data?: Record<string, unknown>
}
