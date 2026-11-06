import { Position } from '@xyflow/react'

export type ComponentPosition = Position

export interface CircuitComponentHandle {
  id: string
  position: ComponentPosition
  label?: string
  hint?: string
}

export interface CircuitComponentParameter {
  key: string
  label: string
  unit?: string
  defaultValue?: number
  min?: number
  description?: string
  // 可选参数（电容初始电压、电感初始电流、交流源初相）：旧工程、旧草稿里没有这个键时不报错、不发给内核，内核按 0 处理
  optional?: boolean
}

export interface CircuitComponentDefinition<TType extends string = string> {
  type: TType
  label: string
  prefix: string
  accent: string
  handles: CircuitComponentHandle[]
  parameters: CircuitComponentParameter[]
  description?: string
}
