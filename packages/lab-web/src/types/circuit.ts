import type { CircuitComponentType } from '@/circuit/components'
import type { ControlOutputPayload, ControlSimulationPayload, MixedBlockPayload } from '@/types/control'

// 分析方法枚举
export type AnalysisMethod = 
  | 'transient'           // 瞬态分析（时域仿真）
  | 'transient_modia'     // 瞬态分析（Modia）
  | 'node_voltage'        // 节点电压法（直流稳态）
  | 'branch_current'      // 支路电流法
  | 'mesh_current'        // 网孔电流法
  | 'thevenin'           // 戴维南等效

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

// 瞬态分析数据
export interface SimulationData {
  time: number[]
  signals: SimulationSignal[]
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
  data?: Record<string, unknown>
}

export type SimulationResponse = SimulationSuccessResponse | SimulationErrorResponse
