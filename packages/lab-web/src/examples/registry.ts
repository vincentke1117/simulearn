import type { CircuitProject } from '@/types/circuit'

export interface ExampleCircuit {
  id: string
  title: string
  description: string
  thumbnail?: string // URL or component
  data: CircuitProject
}

export async function loadExamples(): Promise<ExampleCircuit[]> {
  const [voltageDividerData, rlcSeriesData, wheatstoneBridgeData, controlStepResponseData, rcDischargeData] = await Promise.all([
    import('./data/voltage-divider.json'),
    import('./data/rlc-series.json'),
    import('./data/wheatstone-bridge.json'),
    import('./data/control-step-response.json'),
    import('./data/rc-discharge.json'),
  ])
  return [
    {
      id: 'voltage-divider',
      title: 'Voltage Divider',
      description: 'A fundamental circuit that produces an output voltage that is a fraction of its input voltage.',
      data: voltageDividerData.default as unknown as CircuitProject,
    },
    {
      id: 'rlc-series',
      title: 'RLC Series Circuit',
      description: 'An electrical circuit consisting of a resistor, an inductor, and a capacitor connected in series.',
      data: rlcSeriesData.default as unknown as CircuitProject,
    },
    {
      id: 'wheatstone-bridge',
      title: 'Wheatstone Bridge',
      description: 'A bridge circuit used to measure an unknown electrical resistance by balancing two legs of a bridge circuit.',
      data: wheatstoneBridgeData.default as unknown as CircuitProject,
    },
    {
      // 电容初始电压 v0 的示例（零输入响应），与 contracts/lab/transient-rc-discharge.json 同一电路
      id: 'rc-discharge',
      title: 'RC 放电（零输入响应）',
      description: '电容带 10 V 初始电压经 1 kΩ 放电，没有电源；瞬态分析看 τ = RC = 1 ms 的指数衰减。',
      data: rcDischargeData.default as unknown as CircuitProject,
    },
    {
      id: 'control-step-response',
      title: 'Control Step Response',
      description: 'A control-only step -> gain -> first-order plant -> scope diagram for Phase 1 control simulation.',
      data: controlStepResponseData.default as unknown as CircuitProject,
    },
  ]
}
