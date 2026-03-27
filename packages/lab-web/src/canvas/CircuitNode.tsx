import { Handle, Position, useReactFlow, type Node } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { memo, useMemo } from 'react'

import type { CircuitComponentDefinition } from '@/circuit/components'
import { circuitComponentLibrary } from '@/circuit/components'
import type { CircuitNodeData } from '@/types/circuit'

import styles from './CircuitNode.module.css'
import { ComponentIcon } from '@/circuit/icons'

function formatParameter(definition: CircuitComponentDefinition, data: CircuitNodeData) {
  if (!definition.parameters.length) {
    return ''
  }

  const firstParam = definition.parameters[0]
  const value = data.parameters[firstParam.key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}${firstParam.unit ?? ''}`
  }
  return ''
}

const CircuitNode = memo(({ id, type, data }: NodeProps<Node<CircuitNodeData>>) => {
  const definition = useMemo(() => circuitComponentLibrary[type as keyof typeof circuitComponentLibrary], [type])
  const { setNodes } = useReactFlow()

  if (!definition) {
    return null
  }

  const handleToggle = (e: React.MouseEvent) => {
    if (type === 'switch') {
      e.stopPropagation()
      setNodes((nodes) => nodes.map((n) => {
        if (n.id === id) {
          const params = n.data.parameters as Record<string, number>
          return {
            ...n,
            data: {
              ...n.data,
              parameters: {
                ...params,
                state: params.state === 1 ? 0 : 1
              }
            }
          }
        }
        return n
      }))
    }
  }

  // 映射句柄位置以跟随旋转（仅支持 90° 步进的方向变化）
  const rotatePosition = (pos: Position, rotationDeg: number): Position => {
    const norm = ((Number.isFinite(rotationDeg) ? rotationDeg : 0) % 360 + 360) % 360
    const steps = Math.round(norm / 90) % 4
    if (steps === 0) return pos
    if (steps === 1) {
      switch (pos) {
        case Position.Top: return Position.Right
        case Position.Right: return Position.Bottom
        case Position.Bottom: return Position.Left
        case Position.Left: return Position.Top
        default: return pos
      }
    }
    if (steps === 2) {
      switch (pos) {
        case Position.Top: return Position.Bottom
        case Position.Right: return Position.Left
        case Position.Bottom: return Position.Top
        case Position.Left: return Position.Right
        default: return pos
      }
    }
    if (steps === 3) {
      switch (pos) {
        case Position.Top: return Position.Left
        case Position.Right: return Position.Top
        case Position.Bottom: return Position.Right
        case Position.Left: return Position.Bottom
        default: return pos
      }
    }
    return pos
  }

  const labelStyleForPosition = (pos: Position): React.CSSProperties => {
    switch (pos) {
      case Position.Left:
        return { left: 0, top: '50%', transform: 'translate(-120%, -50%)' }
      case Position.Right:
        return { right: 0, top: '50%', transform: 'translate(120%, -50%)' }
      case Position.Top:
        return { top: 0, left: '50%', transform: 'translate(-50%, -120%)' }
      case Position.Bottom:
        return { bottom: 0, left: '50%', transform: 'translate(-50%, 120%)' }
      default:
        return {}
    }
  }

  return (
    <div
      className={styles.node}
      style={{
        ['--node-accent' as string]: definition.accent,
        fontSize: data.fontSize ? `${data.fontSize}px` : undefined,
      }}
    >
      <div className={styles.title}>
        <span>{data.label}</span>
        <span>{formatParameter(definition, data)}</span>
      </div>
      {data.voltage !== undefined && (
        <div className={styles.voltage}>
          {data.voltage.toFixed(3)} V
        </div>
      )}
      {data.current !== undefined && (
        <div className={styles.current}>
          {data.current.toFixed(4)} A
        </div>
      )}
      {data.voltageDelta !== undefined && (type === 'vsource_dc' || type === 'vsource_ac') && (
        <div className={styles.voltageSecondary}>
          ΔV: {data.voltageDelta.toFixed(3)} V
        </div>
      )}
      <div 
        className={styles.iconCenter}
        onClick={type === 'switch' ? handleToggle : undefined}
        style={{ cursor: type === 'switch' ? 'pointer' : undefined }}
      >
        <div style={{ transform: `rotate(${data.rotation ?? 0}deg)` }}>
          <ComponentIcon type={definition.type} size={48} parameters={data.parameters} />
        </div>
      </div>
      {definition.parameters.length > 1 ? (
        <div className={styles.parameters}>
          {definition.parameters.map((parameter) => {
            const value = data.parameters[parameter.key]
            return (
              <div key={parameter.key} className={styles.parameterRow}>
                <span>{parameter.label}</span>
                <span>
                  {typeof value === 'number' && Number.isFinite(value) ? value : '—'}
                  {parameter.unit ? <span className={styles.parameterUnit}> {parameter.unit}</span> : null}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
      {definition.handles.map((handle) => (
        <div key={handle.id} className={styles.handleWrapper}>
          {(() => {
            const counts = (data as { handleCounts?: Record<string, number> }).handleCounts
            const connectedCount = counts ? counts[handle.id] ?? 0 : 0
            const hasJunction = connectedCount >= 2
            return (
              <>
                <Handle
                  id={handle.id}
                  type="source"
                  position={rotatePosition(handle.position, data.rotation ?? 0)}
                  isConnectable
                  style={{
                    background: definition.accent,
                    width: 18,
                    height: 18,
                    border: hasJunction ? '2px solid #111' : undefined,
                    boxShadow: hasJunction ? '0 0 0 3px #fff inset' : undefined,
                  }}
                />
                {/* 注册一个不可见的 target 句柄用于作为目标端的锚点，避免因缺少 target 导致边仍从旧侧出线 */}
                <Handle
                  id={handle.id}
                  type="target"
                  position={rotatePosition(handle.position, data.rotation ?? 0)}
                  isConnectable
                  style={{
                    opacity: 0,
                    width: 18,
                    height: 18,
                    pointerEvents: 'none',
                  }}
                />
              </>
            )
          })()}
          {handle.label ? (
            <span
              className={styles.handleLabel}
              style={labelStyleForPosition(rotatePosition(handle.position, data.rotation ?? 0))}
            >
              {handle.label}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}, (prev, next) => {
  const p = prev.data
  const n = next.data
  if (prev.type !== next.type) return false
  if (p.label !== n.label) return false
  if (p.rotation !== n.rotation) return false
  if (p.fontSize !== n.fontSize) return false
  if (p.voltage !== n.voltage) return false
  if (p.voltageDelta !== n.voltageDelta) return false
  if (p.current !== n.current) return false
  const pParams = p.parameters
  const nParams = n.parameters
  const pKeys = Object.keys(pParams)
  const nKeys = Object.keys(nParams)
  if (pKeys.length !== nKeys.length) return false
  for (const k of pKeys) {
    if (pParams[k] !== nParams[k]) return false
  }
  return true
})

CircuitNode.displayName = 'CircuitNode'

export default CircuitNode
