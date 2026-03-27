import type { NodeTypes } from '@xyflow/react'

import CircuitNode from './CircuitNode'

export const circuitNodeTypes: NodeTypes = {
  resistor: CircuitNode,
  capacitor: CircuitNode,
  inductor: CircuitNode,
  vsource_dc: CircuitNode,
  vsource_ac: CircuitNode,
  isource_dc: CircuitNode,
  isource_ac: CircuitNode,
  vcvs: CircuitNode,
  ccvs: CircuitNode,
  vccs: CircuitNode,
  cccs: CircuitNode,
  ground: CircuitNode,
  voltage_probe: CircuitNode,
  current_probe: CircuitNode,
  switch: CircuitNode,
  control_step: CircuitNode,
  control_constant: CircuitNode,
  control_sum: CircuitNode,
  control_gain: CircuitNode,
  control_integrator: CircuitNode,
  control_plant_1st: CircuitNode,
  control_pid: CircuitNode,
  control_scope: CircuitNode,
  voltage_sensor: CircuitNode,
  current_sensor: CircuitNode,
  controlled_voltage_source: CircuitNode,
  controlled_current_source: CircuitNode,
}
