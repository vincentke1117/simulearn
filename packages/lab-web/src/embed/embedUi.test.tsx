import { ReactFlowProvider } from '@xyflow/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { configureSimulationApi } from '@/simulation/apiBase'
import { Plot, plotConfigFor } from '@/simulation/Plot'
import { SimulationResultPanel } from '@/simulation/SimulationResultPanel'
import { fitPanelToViewport } from '@/simulation/useFloatingPanel'
import { initialSimulationSettings } from '@/workspace/circuitWorkspaceHelpers'
import { EditorTopBar, type EditorTopBarProps } from '@/workspace/EditorTopBar'

// 嵌入知帆课堂时的界面约束（约定 §3/§4、设计记录 D19）：iframe 沙箱不许下载、不许弹窗、写不了剪贴板，
// 舞台大小不固定。这几条一旦回退，学生那边就是「按钮点了没反应」，门禁要能红。

const plotlyReact = vi.hoisted(() => vi.fn())
vi.mock('plotly.js-basic-dist-min', () => ({ default: { react: plotlyReact, purge: vi.fn(), Plots: { resize: vi.fn() } } }))

afterEach(() => configureSimulationApi({ storagePrefix: 'slp:lab:', embedded: false }))

function topBar(props: Partial<EditorTopBarProps>) {
  return render(
    <ReactFlowProvider>
      <EditorTopBar
        onExport={vi.fn()}
        onImport={vi.fn()}
        canExport
        settings={initialSimulationSettings}
        onSettingsChange={vi.fn()}
        onRun={vi.fn()}
        {...props}
      />
    </ReactFlowProvider>,
  )
}

describe('EditorTopBar in embed mode', () => {
  it('offers only "restore initial circuit", behind a two-step confirm', () => {
    const restore = vi.fn()
    topBar({ onRestoreInitial: restore, message: { tone: 'info', text: '已恢复初始电路' } })
    expect(screen.queryByLabelText('导入项目')).toBeNull()
    expect(screen.queryByLabelText('导出项目')).toBeNull()
    expect(screen.queryByLabelText('重置电路')).toBeNull()
    expect(screen.queryByText('复制')).toBeNull()

    fireEvent.click(screen.getByText('恢复初始电路'))
    expect(restore).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('再点一次确认恢复'))
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('keeps import / export / reset outside embed mode', () => {
    topBar({ onReset: vi.fn(), message: { tone: 'info', text: 'x' } })
    expect(screen.getByLabelText('导入项目')).toBeInTheDocument()
    expect(screen.getByLabelText('导出项目')).toBeInTheDocument()
    expect(screen.getByLabelText('重置电路')).toBeInTheDocument()
    expect(screen.getByText('复制')).toBeInTheDocument()
  })
})

describe('result panel and charts in embed mode', () => {
  const result = { node_voltages: { n1: 5, n2: 2.5 }, branch_currents: { R1: 0.0025 } }

  it('hides the JSON / CSV / PDF export buttons when exports are not allowed', () => {
    const { rerender } = render(<SimulationResultPanel result={result} error={null} isRunning={false} method="node_voltage" />)
    expect(screen.getByTitle('导出JSON')).toBeInTheDocument()
    rerender(<SimulationResultPanel result={result} error={null} isRunning={false} method="node_voltage" allowExport={false} />)
    expect(screen.queryByTitle('导出JSON')).toBeNull()
    expect(screen.queryByTitle('导出CSV')).toBeNull()
    expect(screen.queryByTitle('导出PDF报告')).toBeNull()
  })

  it('removes the Plotly "download as png" button only when embedded', () => {
    const config = { responsive: true, displaylogo: false }
    expect(plotConfigFor(config, false)).toBe(config)
    expect(plotConfigFor(config, true).modeBarButtonsToRemove).toEqual(['toImage'])
  })

  it('wires the embed flag into the config Plotly actually receives', () => {
    configureSimulationApi({ storagePrefix: 'slp:lab:exp:lab-1:', embedded: true })
    render(<Plot data={[]} config={{ displaylogo: false }} />)
    const calls = plotlyReact.mock.calls
    const lastConfig = calls[calls.length - 1]?.[3] as { modeBarButtonsToRemove?: string[] }
    expect(lastConfig.modeBarButtonsToRemove).toContain('toImage')
  })

  it('fits the floating result panel inside a small stage', () => {
    const fitted = fitPanelToViewport({ position: { x: 100, y: 100 }, size: { width: 800, height: 600 } }, { width: 700, height: 450 })
    expect(fitted.size).toEqual({ width: 668, height: 418 })
    expect(fitted.position.x + fitted.size.width).toBeLessThanOrEqual(700)
    expect(fitted.position.y + fitted.size.height).toBeLessThanOrEqual(450)
    // 舞台够大时不动
    const roomy = { position: { x: 100, y: 100 }, size: { width: 800, height: 600 } }
    expect(fitPanelToViewport(roomy, { width: 1600, height: 900 })).toEqual(roomy)
  })
})

describe('EditorTopBar keeps a case preset method', () => {
  it('does not drop ac_phasor on the first frame, before the canvas store has the nodes', () => {
    const onSettingsChange = vi.fn()
    topBar({
      settings: { ...initialSimulationSettings, method: 'ac_phasor' },
      onSettingsChange,
      diagramMode: 'electrical',
      isResistive: false,
      hasAcSource: true,
      hasProbe: true,
    })
    expect(onSettingsChange).not.toHaveBeenCalled()
  })
})
