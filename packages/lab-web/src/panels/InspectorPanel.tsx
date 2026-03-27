import { useMemo } from 'react'
import { Settings2, RotateCw, Link2 } from 'lucide-react'
import type { CircuitComponentDefinition } from '@/circuit/components'
import type { CircuitNodeData } from '@/types/circuit'

export interface InspectorPanelProps {
  node: CircuitNodeData | null
  definition: CircuitComponentDefinition | null
  onParameterChange: (key: string, value: number) => void
  onRotationChange: (value: number) => void
  onFontSizeChange?: (value: number) => void
}

export function InspectorPanel({ node, definition, onParameterChange, onRotationChange, onFontSizeChange }: InspectorPanelProps) {
  const hasParameters = useMemo(() => Boolean(definition?.parameters.length), [definition])

  if (!node || !definition) {
    return (
      <aside className="w-72 bg-slate-900 border-l border-slate-800 flex flex-col h-full p-6 text-center text-slate-300 select-none">
        <div className="flex-1 flex flex-col items-center justify-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
            <Settings2 className="w-8 h-8 opacity-50" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-200">No Selection</h3>
            <p className="text-xs mt-1 text-slate-300">Select a component to edit its properties</p>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-72 bg-slate-900 border-l border-slate-800 flex flex-col h-full overflow-y-auto custom-scrollbar text-slate-200">
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center text-blue-500">
             {/* We could use the component icon here if passed or available */}
             <Settings2 className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{definition.label}</h2>
            <div className="text-xs text-slate-300 font-mono">{node.type}</div>
          </div>
        </div>
        {definition.description && (
          <p className="mt-3 text-xs text-slate-300 leading-relaxed bg-slate-800/50 p-2 rounded border border-slate-700">
            {definition.description}
          </p>
        )}
      </div>

      <div className="p-4 space-y-6">
        {/* Transform Section */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <RotateCw className="w-3 h-3" /> Transform
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs text-slate-300">Rotation</span>
              <select
                className="w-full bg-slate-800 text-slate-200 text-xs rounded-md px-2 py-1.5 border border-slate-700 focus:outline-none focus:border-blue-500 transition-colors"
                value={node.rotation ?? 0}
                onChange={(event) => onRotationChange(Number(event.target.value))}
              >
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-slate-300">Font Size (px)</span>
              <input
                className="w-full bg-slate-800 text-slate-200 text-xs rounded-md px-2 py-1.5 border border-slate-700 focus:outline-none focus:border-blue-500 transition-colors"
                type="number"
                min={8}
                max={32}
                value={node.fontSize ?? 12}
                onChange={(event) => onFontSizeChange?.(Number(event.target.value))}
              />
            </label>
          </div>
        </div>

        {/* Parameters Section */}
        {hasParameters ? (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> Parameters
            </h3>
            <div className="space-y-3">
              {definition.parameters.map((parameter) => {
                const value = node.parameters[parameter.key] ?? parameter.defaultValue ?? 0
                return (
                  <div key={parameter.key} className="space-y-1.5 group">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-100 group-hover:text-blue-300 transition-colors">
                        {parameter.label}
                      </span>
                      {parameter.unit && (
                        <span className="text-[10px] font-mono text-slate-200 bg-slate-700 px-1 rounded">
                          {parameter.unit}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        className="w-full bg-slate-800 text-slate-200 text-sm rounded-md px-3 py-2 border border-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
                        type="number"
                        min={parameter.min}
                        value={value}
                        onChange={(event) => onParameterChange(parameter.key, Number(event.target.value))}
                      />
                    </div>
                    {parameter.description && (
                      <p className="text-[10px] text-slate-300 leading-tight">
                        {parameter.description}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="p-3 rounded bg-slate-800/30 border border-slate-700 text-xs text-slate-300 text-center">
            No configurable parameters
          </div>
        )}

        {/* Handles/Connections Info */}
        {definition.handles?.length ? (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Link2 className="w-3 h-3" /> Connections
            </h3>
            <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
              {definition.handles.map((h, idx) => (
                <div 
                  key={h.id} 
                  className={`flex items-center px-3 py-2 ${
                    idx !== definition.handles!.length - 1 ? 'border-b border-slate-700' : ''
                  }`}
                >
                  <span className="w-6 h-6 rounded bg-slate-900 border border-slate-600 flex items-center justify-center text-[10px] font-mono text-slate-200 mr-3">
                    {h.label ?? h.id}
                  </span>
                  <span className="text-xs text-slate-300">{h.hint ?? 'Connect to node'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
