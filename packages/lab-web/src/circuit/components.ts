import { Position } from '@xyflow/react'

import type { BridgeComponentType, ControlComponentType } from '@/types/control'
import { controlComponentLibrary } from './controlComponents'
import type { CircuitComponentDefinition } from './componentSchema'

export const DND_COMPONENT_MIME = 'application/x-jcircuit-component'

export type ElectricalComponentType =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'vsource_dc'
  | 'vsource_ac'
  | 'isource_dc'  // 直流电流源
  | 'isource_ac'  // 交流电流源
  | 'vcvs'        // 电压控制电压源
  | 'ccvs'        // 电流控制电压源
  | 'vccs'        // 电压控制电流源
  | 'cccs'        // 电流控制电流源
  | 'ground'
  | 'voltage_probe'
  | 'current_probe'
  | 'switch'

export type CircuitComponentType = ElectricalComponentType | ControlComponentType | BridgeComponentType

export type { CircuitComponentDefinition, CircuitComponentHandle, CircuitComponentParameter } from './componentSchema'

const electricalComponentLibrary: Record<ElectricalComponentType, CircuitComponentDefinition<ElectricalComponentType>> = {
  resistor: {
    type: 'resistor',
    label: '电阻',
    prefix: 'R',
    accent: '#f97316',
    description: '两端元件，满足欧姆定律，常用于限流、分压。',
    handles: [
      { id: 'p', position: Position.Left, label: 'p', hint: '左端节点（方向对仿真无影响）' },
      { id: 'n', position: Position.Right, label: 'n', hint: '右端节点（方向对仿真无影响）' },
    ],
    parameters: [
      { key: 'value', label: '阻值', unit: 'Ω', defaultValue: 1000, min: 0, description: '电阻值，越大电流越小。' },
    ],
  },
  capacitor: {
    type: 'capacitor',
    label: '电容',
    prefix: 'C',
    accent: '#38bdf8',
    description: '储能元件，电压与电荷相关；可隔直通交，用于滤波。',
    handles: [
      { id: 'p', position: Position.Left, label: 'p', hint: '左端节点（方向对仿真无影响）' },
      { id: 'n', position: Position.Right, label: 'n', hint: '右端节点（方向对仿真无影响）' },
    ],
    parameters: [
      { key: 'value', label: '电容值', unit: 'F', defaultValue: 1e-6, min: 0, description: '电容值，决定充放电速度与滤波能力。' },
    ],
  },
  inductor: {
    type: 'inductor',
    label: '电感',
    prefix: 'L',
    accent: '#a855f7',
    description: '储能元件，抵抗电流变化；直通直流、阻碍交流。',
    handles: [
      { id: 'p', position: Position.Left, label: 'p', hint: '左端节点（方向对仿真无影响）' },
      { id: 'n', position: Position.Right, label: 'n', hint: '右端节点（方向对仿真无影响）' },
    ],
    parameters: [
      { key: 'value', label: '电感值', unit: 'H', defaultValue: 1e-3, min: 0, description: '电感值，影响电流变化率与滤波特性。' },
    ],
  },
  vsource_dc: {
    type: 'vsource_dc',
    label: '直流电压源',
    prefix: 'V',
    accent: '#facc15',
    description: '提供恒定电压的理想源。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+', hint: '输出正端（较高电位）' },
      { id: 'neg', position: Position.Right, label: '-', hint: '输出负端（返回或接地）' },
    ],
    parameters: [
      { key: 'dc', label: '电压', unit: 'V', defaultValue: 5, description: '输出电压幅值。' },
    ],
  },
  vsource_ac: {
    type: 'vsource_ac',
    label: '交流电压源',
    prefix: 'VAC',
    accent: '#fb7185',
    description: '提供正弦交流电压的理想源。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+', hint: '输出正端（瞬时极性由正弦决定）' },
      { id: 'neg', position: Position.Right, label: '-', hint: '输出负端（返回或接地）' },
    ],
    parameters: [
      { key: 'amplitude', label: '幅值', unit: 'V', defaultValue: 5, min: 0, description: '峰值幅值（非有效值）。' },
      { key: 'frequency', label: '频率', unit: 'Hz', defaultValue: 1000, min: 0, description: '正弦频率（Hz）。' },
    ],
  },
  ground: {
    type: 'ground',
    label: '地',
    prefix: 'G',
    accent: '#94a3b8',
    description: '电路参考地，节点电位定义为 0V。',
    handles: [{ id: 'gnd', position: Position.Top, label: 'GND', hint: '连接需要定义为地的节点' }],
    parameters: [],
  },
  voltage_probe: {
    type: 'voltage_probe',
    label: '电压探针',
    prefix: 'VP',
    accent: '#34d399',
    description: '测量某节点相对地的电压。',
    handles: [{ id: 'node', position: Position.Top, label: '节点', hint: '将探针连接到待测节点（自动参考地）' }],
    parameters: [],
  },
  current_probe: {
    type: 'current_probe',
    label: '电流探针',
    prefix: 'IP',
    accent: '#f472b6',
    description: '测量通过元件或支路的电流，需串联在被测支路中。',
    handles: [
      { id: 'p', position: Position.Left, label: 'p', hint: '探针左端，电流方向定义为 p→n' },
      { id: 'n', position: Position.Right, label: 'n', hint: '探针右端，串联到被测支路另一端' },
    ],
    parameters: [],
  },
  switch: {
    type: 'switch',
    label: '开关',
    prefix: 'S',
    accent: '#94a3b8',
    description: '单刀单掷开关 (SPST)，理想导通或断路。',
    handles: [
      { id: 'p', position: Position.Left, label: 'p', hint: '开关一端' },
      { id: 'n', position: Position.Right, label: 'n', hint: '开关另一端' },
    ],
    parameters: [
      { key: 'state', label: '状态', unit: '', defaultValue: 0, description: '0: 断开, 1: 闭合' },
    ],
  },
  isource_dc: {
    type: 'isource_dc',
    label: '直流电流源',
    prefix: 'I',
    accent: '#facc15',
    description: '提供恒定电流的理想源，方向为 pos→neg。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+', hint: '电流流出端（方向 pos→neg）' },
      { id: 'neg', position: Position.Right, label: '-', hint: '电流流入端（返回或接地）' },
    ],
    parameters: [
      { key: 'dc', label: '电流', unit: 'A', defaultValue: 0.001, description: '输出恒定电流的幅值。' },
    ],
  },
  isource_ac: {
    type: 'isource_ac',
    label: '交流电流源',
    prefix: 'IAC',
    accent: '#fb7185',
    description: '提供正弦交流电流的理想源，方向为 pos→neg。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+', hint: '电流流出端（瞬时方向由正弦决定）' },
      { id: 'neg', position: Position.Right, label: '-', hint: '电流流入端（返回或接地）' },
    ],
    parameters: [
      { key: 'amplitude', label: '幅值', unit: 'A', defaultValue: 0.001, min: 0, description: '峰值幅值（非有效值）。' },
      { key: 'frequency', label: '频率', unit: 'Hz', defaultValue: 1000, min: 0, description: '正弦频率（Hz）。' },
    ],
  },
  vcvs: {
    type: 'vcvs',
    label: '电压控制电压源',
    prefix: 'E',
    accent: '#8b5cf6',
    description: '输出电压 = 增益 × (控制端电压差)。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+out', hint: '输出端正极（被控支路的正端）' },
      { id: 'neg', position: Position.Right, label: '-out', hint: '输出端负极（返回或接地）' },
      { id: 'ctrl_p', position: Position.Top, label: '+in', hint: '控制端正极（测量电压差的正端）' },
      { id: 'ctrl_n', position: Position.Bottom, label: '-in', hint: '控制端负极（测量电压差的负端）' },
    ],
    parameters: [
      { key: 'gain', label: '增益', unit: '', defaultValue: 1, description: '无量纲，输出/输入电压比（V/V）。' },
    ],
  },
  ccvs: {
    type: 'ccvs',
    label: '电流控制电压源',
    prefix: 'H',
    accent: '#06b6d4',
    description: '输出电压 = 跨阻 × 参考支路电流。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+out', hint: '输出端正极（被控支路的正端）' },
      { id: 'neg', position: Position.Right, label: '-out', hint: '输出端负极（返回或接地）' },
      { id: 'ctrl_p', position: Position.Top, label: 'i+', hint: '参考支路端点（串联在参考支路中）' },
      { id: 'ctrl_n', position: Position.Bottom, label: 'i-', hint: '参考支路端点（串联在参考支路中）' },
    ],
    parameters: [
      { key: 'gain', label: '跨阻增益', unit: 'Ω', defaultValue: 1000, description: 'V/A，输出电压与参考电流的比例。' },
    ],
  },
  vccs: {
    type: 'vccs',
    label: '电压控制电流源',
    prefix: 'GCS',
    accent: '#10b981',
    description: '输出电流 = 跨导 × (控制端电压差)。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+out', hint: '输出端正极（电流方向 pos→neg）' },
      { id: 'neg', position: Position.Right, label: '-out', hint: '输出端负极（返回或接地）' },
      { id: 'ctrl_p', position: Position.Top, label: '+in', hint: '控制端正极（测量电压差的正端）' },
      { id: 'ctrl_n', position: Position.Bottom, label: '-in', hint: '控制端负极（测量电压差的负端）' },
    ],
    parameters: [
      { key: 'gain', label: '跨导增益', unit: 'S', defaultValue: 0.001, description: 'A/V，输出电流与控制电压的比例。' },
    ],
  },
  cccs: {
    type: 'cccs',
    label: '电流控制电流源',
    prefix: 'F',
    accent: '#f59e0b',
    description: '输出电流 = 电流增益 × 参考支路电流。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+out', hint: '输出端正极（电流方向 pos→neg）' },
      { id: 'neg', position: Position.Right, label: '-out', hint: '输出端负极（返回或接地）' },
      { id: 'ctrl_p', position: Position.Top, label: 'i+', hint: '参考支路端点（串联在参考支路中）' },
      { id: 'ctrl_n', position: Position.Bottom, label: 'i-', hint: '参考支路端点（串联在参考支路中）' },
    ],
    parameters: [
      { key: 'gain', label: '电流增益', unit: '', defaultValue: 1, description: '无量纲，输出/参考电流比（A/A）。' },
    ],
  },
}

const bridgeComponentLibrary: Record<BridgeComponentType, CircuitComponentDefinition<BridgeComponentType>> = {
  voltage_sensor: {
    type: 'voltage_sensor',
    label: '电压传感器',
    prefix: 'VSEN',
    accent: '#14b8a6',
    description: '采样电路两节点电压差，并输出信号到控制图。',
    handles: [
      { id: 'p', position: Position.Left, label: '+', hint: '被测正端电节点' },
      { id: 'n', position: Position.Bottom, label: '-', hint: '被测负端电节点（通常接地）' },
      { id: 'out', position: Position.Right, label: 'out', hint: '控制信号输出' },
    ],
    parameters: [],
  },
  current_sensor: {
    type: 'current_sensor',
    label: '电流传感器',
    prefix: 'ISEN',
    accent: '#06b6d4',
    description: '采样支路电流，并输出信号到控制图。',
    handles: [
      { id: 'p', position: Position.Left, label: 'p', hint: '被测支路输入端' },
      { id: 'n', position: Position.Right, label: 'n', hint: '被测支路输出端' },
      { id: 'out', position: Position.Top, label: 'out', hint: '控制信号输出' },
    ],
    parameters: [],
  },
  controlled_voltage_source: {
    type: 'controlled_voltage_source',
    label: '受控电压源',
    prefix: 'CVS',
    accent: '#22c55e',
    description: '由控制信号驱动的电压源（u→V）。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+', hint: '输出正端' },
      { id: 'neg', position: Position.Right, label: '-', hint: '输出负端' },
      { id: 'in', position: Position.Top, label: 'in', hint: '控制信号输入' },
    ],
    parameters: [{ key: 'gain', label: '增益', unit: 'V/u', defaultValue: 1, description: '输出电压 = gain × 控制输入。' }],
  },
  controlled_current_source: {
    type: 'controlled_current_source',
    label: '受控电流源',
    prefix: 'CCS',
    accent: '#84cc16',
    description: '由控制信号驱动的电流源（u→I）。',
    handles: [
      { id: 'pos', position: Position.Left, label: '+', hint: '输出正端（电流方向 pos→neg）' },
      { id: 'neg', position: Position.Right, label: '-', hint: '输出负端' },
      { id: 'in', position: Position.Top, label: 'in', hint: '控制信号输入' },
    ],
    parameters: [{ key: 'gain', label: '增益', unit: 'A/u', defaultValue: 1, description: '输出电流 = gain × 控制输入。' }],
  },
}

export const circuitComponentLibrary: Record<CircuitComponentType, CircuitComponentDefinition<CircuitComponentType>> = {
  ...electricalComponentLibrary,
  ...controlComponentLibrary,
  ...bridgeComponentLibrary,
}

export const circuitComponentList: CircuitComponentDefinition<CircuitComponentType>[] = Object.values(circuitComponentLibrary)
