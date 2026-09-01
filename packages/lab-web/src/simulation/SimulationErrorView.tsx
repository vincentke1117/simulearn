import { Activity } from 'lucide-react'
import type { SimulationErrorInfo } from '@/types/circuit'

interface SimulationErrorViewProps {
  error: SimulationErrorInfo
}

export function SimulationErrorView({ error }: SimulationErrorViewProps) {
  return (
    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-3">
      <Activity className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h4 className="font-semibold">仿真错误</h4>
          {error.code && (
            <code className="rounded bg-red-500/20 px-1.5 py-0.5 font-mono text-[11px] text-red-300">
              {error.code}
            </code>
          )}
        </div>
        <p className="break-words">{error.message}</p>
        {error.data && Object.keys(error.data).length > 0 && (
          <dl className="mt-2 space-y-0.5 text-[11px] text-red-300/80">
            {Object.entries(error.data).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="font-mono">{key}</dt>
                <dd className="font-mono">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}
