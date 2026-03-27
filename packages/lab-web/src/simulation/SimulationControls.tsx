import type { SimulationSettings, AnalysisMethod, TheveninPortConfig } from '@/types/circuit'

import styles from './SimulationControls.module.css'

// 分析方法显示名称
const ANALYSIS_METHOD_LABELS: Record<AnalysisMethod, string> = {
  transient: '瞬态分析（时域）',
  transient_modia: '瞬态分析（Modia）',
  node_voltage: '节点电压法（DC）',
  branch_current: '支路电流法（DC）',
  mesh_current: '网孔电流法（DC）',
  thevenin: '戴维南等效',
}

export interface SimulationControlsProps {
  settings: SimulationSettings
  onChange: (settings: SimulationSettings) => void
  onRun: () => void
  disabled?: boolean
  isRunning?: boolean
  isResistive?: boolean  // 是否为纯电阻电路
  hasResult?: boolean    // 是否有仿真结果
  onShowResult?: () => void  // 显示结果面板
  availableNodes?: string[]  // 可用的节点列表（用于戴维南端口选择）
  theveninPort?: TheveninPortConfig  // 戴维南端口配置
  onTheveninPortChange?: (config: TheveninPortConfig) => void
  teachingMode?: boolean  // 教学模式
  onTeachingModeChange?: (enabled: boolean) => void
}

export function SimulationControls({ 
  settings, 
  onChange, 
  onRun, 
  disabled, 
  isRunning, 
  isResistive, 
  hasResult, 
  onShowResult,
  availableNodes,
  theveninPort,
  onTheveninPortChange,
  teachingMode,
  onTeachingModeChange
}: SimulationControlsProps) {
  // 根据电路类型可用的分析方法
  const availableMethods: AnalysisMethod[] = isResistive
    ? ['node_voltage', 'branch_current', 'mesh_current', 'thevenin', 'transient', 'transient_modia']  // 纯电阻电路
    : ['transient', 'transient_modia']  // 动态电路可用瞬态与Modia瞬态
  
  const currentMethod = settings.method ?? 'transient'
  const showTheveninConfig = currentMethod === 'thevenin'
  // 教学模式在纯电阻电路且选择了非瞬态、非戴维南方法，或在对比模式中选择了这些方法时显示
  const showTeachingMode = isResistive && (currentMethod !== 'thevenin' && currentMethod !== 'transient' || (settings.comparisonMethods?.length ?? 0) > 0)

  return (
    <div className={styles.controls}>
      <label className={styles.field}>
        <span>分析方法</span>
        <select
          className={styles.input}
          value={settings.method ?? 'transient'}
          onChange={(event) => onChange({ ...settings, method: event.target.value as AnalysisMethod })}
        >
          {availableMethods.map(method => (
            <option key={method} value={method}>
              {ANALYSIS_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
      </label>

      {/* 电压显示模式 */}
      <label className={styles.field}>
        <span>电压显示</span>
        <select
          className={styles.input}
          value={settings.voltageDisplayMode ?? 'node'}
          onChange={(event) => onChange({ ...settings, voltageDisplayMode: event.target.value as ('node' | 'element') })}
        >
          <option value="node">节点电压</option>
          <option value="element">元件电压差</option>
        </select>
      </label>
      
      {/* 戴维南端口配置 */}
      {showTheveninConfig && (
        <>
          <label className={styles.field}>
            <span>正端节点</span>
            <select
              className={styles.input}
              value={theveninPort?.positiveNode ?? ''}
              onChange={(e) => onTheveninPortChange?.({
                positiveNode: e.target.value,
                negativeNode: theveninPort?.negativeNode ?? 'gnd'
              })}
            >
              <option value="">请选择节点</option>
              {availableNodes?.map(node => (
                <option key={node} value={node}>{node}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>负端节点</span>
            <select
              className={styles.input}
              value={theveninPort?.negativeNode ?? 'gnd'}
              onChange={(e) => onTheveninPortChange?.({
                positiveNode: theveninPort?.positiveNode ?? '',
                negativeNode: e.target.value
              })}
            >
              <option value="gnd">地 (gnd)</option>
              {availableNodes?.map(node => (
                <option key={node} value={node}>{node}</option>
              ))}
            </select>
          </label>
        </>
      )}
      
      {/* 方法对比模式：根据选中的方法个数水平排布 */}
      {isResistive && (
        <div className={styles.comparisonSection}>
          <div className={styles.comparisonTitle}>方法对比 (选择列数)</div>
          <div className={styles.methodCheckboxes}>
            {['node_voltage', 'branch_current', 'mesh_current', 'thevenin'].map((method) => (
              <label key={method} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={settings.comparisonMethods?.includes(method as AnalysisMethod) ?? false}
                  onChange={(e) => {
                    const methods = settings.comparisonMethods ?? []
                    if (e.target.checked) {
                      onChange({ ...settings, comparisonMethods: [...methods, method as AnalysisMethod] })
                    } else {
                      onChange({ ...settings, comparisonMethods: methods.filter(m => m !== method) })
                    }
                  }}
                />
                <span className={styles.checkboxText}>
                  {ANALYSIS_METHOD_LABELS[method as AnalysisMethod]}
                </span>
              </label>
            ))}
          </div>
          {(settings.comparisonMethods?.length ?? 0) > 0 && (
            <div className={styles.comparisonInfo}>
              {settings.comparisonMethods?.length} 个方法求解结果将按 {settings.comparisonMethods?.length} 列水平排布
            </div>
          )}
        </div>
      )}
      
      {/* 教学模式开关 */}
      {showTeachingMode && onTeachingModeChange && (
        <label className={styles.field} style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            checked={teachingMode ?? false}
            onChange={(e) => onTeachingModeChange(e.target.checked)}
            style={{ width: 'auto', margin: 0 }}
          />
          <span>显示求解步骤（教学模式）</span>
        </label>
      )}
      
      <label className={styles.field}>
        <span>仿真时长（秒）</span>
        <input
          className={styles.input}
          type="number"
          min={0}
          step={0.001}
          value={settings.tStop}
          onChange={(event) => onChange({ ...settings, tStop: Number(event.target.value) })}
        />
      </label>
      <label className={styles.field}>
        <span>采样点数</span>
        <input
          className={styles.input}
          type="number"
          min={1}
          step={1}
          value={settings.nSamples}
          onChange={(event) => onChange({ ...settings, nSamples: Number(event.target.value) })}
        />
      </label>
      <button
        type="button"
        className={styles.button}
        disabled={disabled || isRunning}
        onClick={onRun}
      >
        {isRunning ? '仿真中…' : '运行仿真'}
      </button>
      {hasResult && onShowResult && (
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={onShowResult}
        >
          查看结果
        </button>
      )}
    </div>
  )
}
