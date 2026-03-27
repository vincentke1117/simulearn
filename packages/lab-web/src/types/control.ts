export type ControlComponentType =
  | 'control_step'
  | 'control_constant'
  | 'control_sum'
  | 'control_gain'
  | 'control_integrator'
  | 'control_plant_1st'
  | 'control_pid'
  | 'control_scope'

export type BridgeComponentType =
  | 'voltage_sensor'
  | 'current_sensor'
  | 'controlled_voltage_source'
  | 'controlled_current_source'

export type SignalBlockType = ControlComponentType | BridgeComponentType

export type DiagramMode = 'empty' | 'electrical' | 'control' | 'mixed'

export interface ControlBlockPayload {
  id: string
  type: ControlComponentType
  parameters: Record<string, number>
}

export interface MixedBlockPayload {
  id: string
  type: SignalBlockType
  parameters: Record<string, number>
}

export interface ControlEdgePayload {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

export interface ControlOutputPayload {
  id: string
  blockId: string
  handle: string
  label: string
}

export interface ControlSimulationPayload {
  kind: 'control'
  blocks: ControlBlockPayload[]
  edges: ControlEdgePayload[]
  outputs: ControlOutputPayload[]
  sim: {
    t_stop: number
    n_samples: number
  }
}

export const CONTROL_COMPONENT_TYPES: readonly ControlComponentType[] = [
  'control_step',
  'control_constant',
  'control_sum',
  'control_gain',
  'control_integrator',
  'control_plant_1st',
  'control_pid',
  'control_scope',
]

export const BRIDGE_COMPONENT_TYPES: readonly BridgeComponentType[] = [
  'voltage_sensor',
  'current_sensor',
  'controlled_voltage_source',
  'controlled_current_source',
]

export const CONTROL_DYNAMIC_COMPONENT_TYPES = new Set<ControlComponentType>([
  'control_integrator',
  'control_plant_1st',
  'control_pid',
])
