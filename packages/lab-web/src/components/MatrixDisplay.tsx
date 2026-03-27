import type { FC } from 'react'

export interface MatrixDisplayProps {
  label: string
  data: number[][]
  rowLabels?: string[]
  columnLabels?: string[]
}

export const MatrixDisplay: FC<MatrixDisplayProps> = ({ label, data, rowLabels, columnLabels }) => {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50">
      <h5 className="bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 border-b border-slate-700">
        {label}
      </h5>
      <div className="overflow-x-auto p-2">
        <table className="w-full text-right text-xs border-collapse">
          {columnLabels && (
            <thead>
              <tr>
                <th className="p-2"></th>
                {columnLabels.map((label, j) => (
                  <th key={j} className="p-2 font-mono text-slate-400 font-medium border-b border-slate-700/50">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                {rowLabels && (
                  <td className="p-2 font-mono text-slate-400 font-medium border-r border-slate-700/50 text-left">
                    {rowLabels[i]}
                  </td>
                )}
                {row.map((val, j) => (
                  <td key={j} className="p-2 font-mono text-slate-200">
                    {typeof val === 'number' ? val.toFixed(4) : val}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const VectorDisplay: FC<{ label: string; data: number[]; labels?: string[] }> = ({ label, data, labels }) => {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50">
      <h5 className="bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 border-b border-slate-700">
        {label}
      </h5>
      <div className="p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {data.map((val, i) => (
          <div key={i} className="flex items-center justify-between gap-2 rounded bg-slate-900/50 px-2 py-1.5 border border-slate-700/50">
            <span className="font-mono text-xs text-blue-400 font-medium">
              {labels?.[i] ?? `v${i}`}
            </span>
            <span className="font-mono text-xs text-slate-200">
              {val.toFixed(6)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
