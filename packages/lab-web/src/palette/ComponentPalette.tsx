import { useCallback, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { Search, Grid } from 'lucide-react'

import { DND_COMPONENT_MIME, type CircuitComponentDefinition, type CircuitComponentType } from '@/circuit/components'
import { ComponentIcon } from '@/circuit/icons'

export interface ComponentPaletteProps {
  components: CircuitComponentDefinition<CircuitComponentType>[]
}

type PaletteSectionKey = 'electrical' | 'control' | 'bridge'

interface PaletteSection {
  key: PaletteSectionKey
  title: string
  items: CircuitComponentDefinition<CircuitComponentType>[]
}

const BRIDGE_COMPONENT_TYPES = new Set<CircuitComponentType>([
  'voltage_sensor',
  'current_sensor',
  'controlled_voltage_source',
  'controlled_current_source',
])

function getSectionKey(type: CircuitComponentType): PaletteSectionKey {
  if (type.startsWith('control_')) return 'control'
  if (BRIDGE_COMPONENT_TYPES.has(type)) return 'bridge'
  return 'electrical'
}

export function ComponentPalette({ components }: ComponentPaletteProps) {
  const [keyword, setKeyword] = useState('')

  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, component: CircuitComponentDefinition) => {
    const data = JSON.stringify({ type: component.type })
    event.dataTransfer.setData(
      DND_COMPONENT_MIME,
      data,
    )
    event.dataTransfer.effectAllowed = 'copy'
  }, [])

  const sections = useMemo<PaletteSection[]>(() => {
    const query = keyword.trim().toLowerCase()
    const filtered = query.length > 0
      ? components.filter((component) => {
          const haystack = `${component.label} ${component.prefix} ${component.type}`.toLowerCase()
          return haystack.includes(query)
        })
      : components

    const grouped: Record<PaletteSectionKey, CircuitComponentDefinition<CircuitComponentType>[]> = {
      electrical: [],
      control: [],
      bridge: [],
    }

    for (const component of filtered) {
      grouped[getSectionKey(component.type)].push(component)
    }

    const sections: PaletteSection[] = [
      { key: 'electrical', title: '电气元件', items: grouped.electrical },
      { key: 'control', title: '控制元件', items: grouped.control },
      { key: 'bridge', title: '桥接元件', items: grouped.bridge },
    ]

    return sections.filter((section) => section.items.length > 0)
  }, [components, keyword])

  return (
    <aside className="w-72 min-w-72 !bg-slate-900 border-r border-slate-700 flex flex-col h-full select-none text-slate-200">
      <div className="p-3 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-100 mb-2 flex items-center gap-2">
          <Grid className="w-3.5 h-3.5 text-blue-400" />
          电路元件
        </h2>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="搜索元件..."
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="w-full !bg-slate-800 !text-slate-100 !text-xs rounded-lg pl-8 pr-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500 transition-all placeholder:!text-slate-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
        {sections.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-6 text-center text-xs text-slate-300">
            未找到匹配的元件
          </div>
        ) : null}

        {sections.map((section) => (
          <section key={section.key} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[11px] font-semibold text-slate-300 tracking-wide">{section.title}</h3>
              <span className="text-[10px] text-slate-400">{section.items.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {section.items.map((component) => (
                <div
                  key={component.type}
                  className="flex items-center gap-3 p-3 rounded-xl !bg-slate-800 border border-slate-700 hover:!bg-slate-700 hover:border-blue-500/50 transition-all cursor-grab active:cursor-grabbing group"
                  draggable
                  title={component.description}
                  onDragStart={(event) => handleDragStart(event, component)}
                >
                  <div
                    className="w-10 h-10 rounded-lg !bg-slate-900 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform"
                    style={{ color: component.accent || '#38bdf8' }}
                  >
                    <ComponentIcon type={component.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-100 truncate">{component.label}</div>
                    <div className="text-[10px] text-slate-300 truncate">{component.prefix}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}
