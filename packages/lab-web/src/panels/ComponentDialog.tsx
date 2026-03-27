import { useState, useEffect } from 'react'
import type { CircuitComponentDefinition } from '@/circuit/components'
import type { CircuitNodeData } from '@/types/circuit'
import styles from './ComponentDialog.module.css'

export interface ComponentDialogProps {
  data: CircuitNodeData
  definition: CircuitComponentDefinition
  onSave: (parameters: Record<string, number>, rotation: number) => void
  onClose: () => void
}

export function ComponentDialog({ data, definition, onSave, onClose }: ComponentDialogProps) {
  const [parameters, setParameters] = useState<Record<string, number>>(data.parameters)
  const [rotation, setRotation] = useState<number>(data.rotation ?? 0)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleSave = () => {
    onSave(parameters, rotation)
    onClose()
  }

  const handleParameterChange = (key: string, value: number) => {
    setParameters(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>{definition.label} 设置</h3>
          <button className={styles.closeButton} onClick={onClose}>✕</button>
        </div>
        
        <div className={styles.body}>
          {definition.description && (
            <div className={styles.hint}>{definition.description}</div>
          )}
          <div className={styles.field}>
            <label>标识</label>
            <input
              type="text"
              value={data.label}
              disabled
              className={styles.input}
            />
          </div>

          {definition.parameters.map((param) => (
            <div key={param.key} className={styles.field}>
              <label>
                {param.label}
                {param.unit && <span className={styles.unit}> ({param.unit})</span>}
              </label>
              <input
                type="number"
                value={parameters[param.key] ?? param.defaultValue}
                onChange={(e) => handleParameterChange(param.key, Number(e.target.value))}
                step={0.001}
                min={param.min}
                className={styles.input}
              />
              {param.description && (
                <div className={styles.hint}>{param.description}</div>
              )}
            </div>
          ))}

          {definition.handles.length > 0 && (
            <div className={styles.field}>
              <label>旋转角度</label>
              <select
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className={styles.input}
              >
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </div>
          )}

          {definition.handles.length > 0 && (
            <div className={styles.field}>
              <label>连线说明</label>
              <div className={styles.handleList}>
                {definition.handles.map((h) => (
                  <div key={h.id} className={styles.handleItem}>
                    <span className={styles.handleId}>{h.label ?? h.id}</span>
                    <span className={styles.hint}>{h.hint ?? '将该端子连接到对应节点'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>
            取消
          </button>
          <button className={styles.saveButton} onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
