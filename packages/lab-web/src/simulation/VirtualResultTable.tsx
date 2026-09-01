import { useCallback, useEffect, useRef, useState } from 'react'

interface VirtualResultTableProps {
  entries: [string, number][]
  columns: [string, string]
}

export function VirtualResultTable({ entries, columns }: VirtualResultTableProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rowHeight = 28
  const containerHeight = 300
  const [start, setStart] = useState(0)
  const visible = Math.ceil(containerHeight / rowHeight) + 4
  const onScroll = useCallback(() => {
    const top = containerRef.current?.scrollTop ?? 0
    setStart(Math.max(0, Math.floor(top / rowHeight) - 2))
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    element.addEventListener('scroll', onScroll)
    return () => element.removeEventListener('scroll', onScroll)
  }, [onScroll])

  const slice = entries.slice(start, start + visible)

  return (
    <div className="overflow-auto" style={{ height: containerHeight }} ref={containerRef}>
      <div style={{ height: entries.length * rowHeight, position: 'relative' }}>
        <table className="w-full text-sm absolute left-0" style={{ top: start * rowHeight }}>
          <thead className="bg-slate-800 text-slate-200 sticky top-0">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{columns[0]}</th>
              <th className="px-4 py-2 text-right font-medium">{columns[1]}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50 bg-slate-900/50">
            {slice.map(([key, value]) => (
              <tr key={`${key}-${start}`} className="hover:bg-slate-800/50 transition-colors" style={{ height: rowHeight }}>
                <td className="px-4 py-2 text-slate-400">{key}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-300">
                  {typeof value === 'number' ? value.toFixed(6) : value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
