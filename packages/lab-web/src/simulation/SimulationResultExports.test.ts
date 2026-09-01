import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AcPhasorResult, NodeVoltageResult, SimulationData } from '@/types/circuit'
import {
  exportSimulationResultCSV,
  serializeSimulationResultCSV,
} from '@/simulation/SimulationResultExports'

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsText(blob)
  })
}

describe('exportSimulationResultCSV download adapter', () => {
  const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(
    () => 'blob:simulation-result',
  )
  const revokeObjectURL = vi.fn()
  const click = vi.fn()

  beforeEach(() => {
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    click.mockClear()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does nothing when there is no result', () => {
    exportSimulationResultCSV(null, { kind: 'empty' })

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('downloads one CSV blob and revokes its object URL', () => {
    const result: NodeVoltageResult = {
      node_voltages: { n1: 5 },
      branch_currents: { R1: 0.005 },
    }

    exportSimulationResultCSV(result, { kind: 'dc_solve', method: 'node_voltage', data: result })

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:simulation-result')
  })

  it('serializes AC rows as RFC 4180', async () => {
    const result: AcPhasorResult = {
      frequency_hz: 50,
      node_voltages: { n1: 2.5 },
      node_phases_deg: { n1: 30 },
      branch_currents: { R1: 0.25 },
      branch_phases_deg: { R1: -45 },
      power: { convention: 'load convention', sources: {}, elements: {} },
    }

    exportSimulationResultCSV(result, { kind: 'ac_phasor', data: result })

    const blob = createObjectURL.mock.calls[0][0] as Blob
    const csv = await readBlob(blob)
    expect(csv.split('\r\n').slice(0, 7)).toEqual([
      '交流相量分析 (f = 50 Hz)',
      '节点,"电压幅值(V,峰值)",电压相角(deg)',
      'n1,2.5,30',
      '',
      '支路,"电流幅值(A,峰值)",电流相角(deg)',
      'R1,0.25,-45',
      '',
    ])
    expect(csv).not.toMatch(/(^|[^\r])\n/)
  })

  it('neutralizes spreadsheet formulas and escapes hostile text', () => {
    const labels = [
      '=HYPERLINK("https://attacker.test","x"),line\r\nbreak',
      '+cmd',
      '-2+3',
      '@evil',
      '\t=evil',
      '\r=evil',
    ]
    const result: SimulationData = {
      time: [0],
      signals: labels.map((label, index) => ({
        id: `signal-${index}`,
        label,
        values: [index + 1],
      })),
    }

    const csv = serializeSimulationResultCSV({ kind: 'transient', data: result })

    expect(csv).toBe([
      '时间,"\'=HYPERLINK(""https://attacker.test"",""x""),line\r\nbreak",\'+cmd,\'-2+3,\'@evil,\'\t=evil,"\'\r=evil"',
      '0,1,2,3,4,5,6',
      '',
    ].join('\r\n'))
  })
})
