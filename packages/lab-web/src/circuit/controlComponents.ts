import { Position } from '@xyflow/react'

import type { CircuitComponentDefinition } from './componentSchema'
import type { ControlComponentType } from '@/types/control'

type ControlComponentDefinition = CircuitComponentDefinition<ControlComponentType>

export const controlComponentLibrary: Record<ControlComponentType, ControlComponentDefinition> = {
  control_step: {
    type: 'control_step',
    label: '阶跃输入',
    prefix: 'STEP',
    accent: '#22c55e',
    description: '标准阶跃信号源。',
    handles: [{ id: 'out', position: Position.Right, label: 'out', hint: '输出信号' }],
    parameters: [
      { key: 'amplitude', label: '幅值', defaultValue: 1, description: '阶跃幅值。' },
      { key: 'offset', label: '偏置', defaultValue: 0, description: '初始偏置。' },
      { key: 'startTime', label: '开始时间', unit: 's', defaultValue: 0, min: 0, description: '阶跃发生时刻。' },
    ],
  },
  control_constant: {
    type: 'control_constant',
    label: '常数源',
    prefix: 'CONST',
    accent: '#10b981',
    description: '输出恒定数值的信号源。',
    handles: [{ id: 'out', position: Position.Right, label: 'out', hint: '输出信号' }],
    parameters: [{ key: 'value', label: '数值', defaultValue: 1, description: '常数输出值。' }],
  },
  control_sum: {
    type: 'control_sum',
    label: '求和器',
    prefix: 'SUM',
    accent: '#38bdf8',
    description: '对多个输入执行加减运算。',
    handles: [
      { id: 'in1', position: Position.Left, label: 'in1', hint: '输入 1' },
      { id: 'in2', position: Position.Bottom, label: 'in2', hint: '输入 2' },
      { id: 'out', position: Position.Right, label: 'out', hint: '输出信号' },
    ],
    parameters: [
      { key: 'sign1', label: '输入1符号', defaultValue: 1, description: '1 表示 +，-1 表示 -。' },
      { key: 'sign2', label: '输入2符号', defaultValue: -1, description: '1 表示 +，-1 表示 -。' },
    ],
  },
  control_gain: {
    type: 'control_gain',
    label: '增益',
    prefix: 'K',
    accent: '#f59e0b',
    description: '输出 = gain × 输入。',
    handles: [
      { id: 'in', position: Position.Left, label: 'in', hint: '输入信号' },
      { id: 'out', position: Position.Right, label: 'out', hint: '输出信号' },
    ],
    parameters: [{ key: 'gain', label: '增益', defaultValue: 1, description: '比例系数。' }],
  },
  control_integrator: {
    type: 'control_integrator',
    label: '积分器',
    prefix: 'INT',
    accent: '#a855f7',
    description: '状态方程 ẋ = u，输出 y = x。',
    handles: [
      { id: 'in', position: Position.Left, label: 'in', hint: '输入信号' },
      { id: 'out', position: Position.Right, label: 'out', hint: '输出信号' },
    ],
    parameters: [{ key: 'initialValue', label: '初值', defaultValue: 0, description: '积分初始状态。' }],
  },
  control_plant_1st: {
    type: 'control_plant_1st',
    label: '一阶对象',
    prefix: 'PLANT',
    accent: '#f97316',
    description: '一阶惯性对象 K/(τs+1)。',
    handles: [
      { id: 'in', position: Position.Left, label: 'in', hint: '输入信号' },
      { id: 'out', position: Position.Right, label: 'out', hint: '输出信号' },
    ],
    parameters: [
      { key: 'gain', label: '增益K', defaultValue: 1, description: '对象静态增益。' },
      { key: 'timeConstant', label: '时间常数τ', unit: 's', defaultValue: 0.1, min: 1e-9, description: '对象时间常数。' },
      { key: 'initialValue', label: '初值', defaultValue: 0, description: '对象初始输出。' },
    ],
  },
  control_pid: {
    type: 'control_pid',
    label: 'PID 控制器',
    prefix: 'PID',
    accent: '#ef4444',
    description: '并联 PID，带微分滤波。',
    handles: [
      { id: 'in', position: Position.Left, label: 'in', hint: '误差信号输入' },
      { id: 'out', position: Position.Right, label: 'out', hint: '控制量输出' },
    ],
    parameters: [
      { key: 'kp', label: 'Kp', defaultValue: 1, description: '比例增益。' },
      { key: 'ki', label: 'Ki', defaultValue: 0, description: '积分增益。' },
      { key: 'kd', label: 'Kd', defaultValue: 0, description: '微分增益。' },
      { key: 'tf', label: 'Tf', unit: 's', defaultValue: 0.01, min: 1e-9, description: '微分滤波时间常数。' },
    ],
  },
  control_scope: {
    type: 'control_scope',
    label: '示波器',
    prefix: 'SCOPE',
    accent: '#06b6d4',
    description: '记录输入信号用于波形显示。',
    handles: [{ id: 'in', position: Position.Left, label: 'in', hint: '待观察输入信号' }],
    parameters: [],
  },
}

export const controlComponentList = Object.values(controlComponentLibrary)
