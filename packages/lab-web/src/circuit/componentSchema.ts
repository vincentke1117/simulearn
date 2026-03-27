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
