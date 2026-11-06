import { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { CaseLibrary } from '@/cases/types'
import { configureSimulationApi } from '@/simulation/apiBase'
import { CircuitWorkspace, type WorkspaceEmbed } from '@/workspace/CircuitWorkspace'
import { resolveEmbedTarget, type EmbedTarget } from './circuit'
import {
  circuitSignature,
  errorMessage,
  experimentKeyPrefix,
  projectFingerprint,
  startEmbed,
  type EmbedWindow,
  type LoadMessage,
} from './protocol'

// 案例库页只在课程包写了 {"library": …} 时才用到
const CaseLibraryView = lazy(() => import('@/cases/CaseLibraryView').then((module) => ({ default: module.CaseLibraryView })))

type Experiment =
  | ({ kind: 'circuit'; experiment: string } & WorkspaceEmbed)
  | { kind: 'library'; experiment: string; storagePrefix: string; library: CaseLibrary }

/**
 * #/embed：知帆课堂里的电路实验（约定 §4）。只留实验需要的界面，拓扑锁定（D19）。
 * 课程包的 project 可以是单个电路，也可以是 {"library": id}：先进案例列表，学生自己挑。
 * 不经宿主直接打开 #/embed?example=<内置示例 id> 或 #/embed?library=<案例库 id> 时用它调试。
 */
export default function EmbedPage() {
  const [experiment, setExperiment] = useState<Experiment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [params] = useSearchParams()
  const debugExample = params.get('example')
  const debugLibrary = params.get('library')

  useEffect(() => {
    const apply = (load: LoadMessage, target: EmbedTarget) => {
      const storagePrefix = experimentKeyPrefix(load.experiment)
      configureSimulationApi({ storagePrefix, embedded: true })
      // 电路实验还不会判分（simulearn.task/1 只在 grid 做了）。课程包要是配了 task，宿主会一直等成绩，
      // 学生只能「先跳过」——电路照常打开，但把原因同时告诉页面和宿主，课程作者一眼能看到
      if (load.task != null) {
        const message = '电路实验暂不支持判分任务：请在课程包里去掉这个实验的 task（电路照常可以做，但不会有成绩）'
        setError(message)
        if (window.parent !== window) window.parent.postMessage(errorMessage(message), '*')
      } else {
        setError(null)
      }
      if (target.kind === 'library') {
        // 宿主每次 ready 都重发 load：同一实验、同一案例库就保持原对象，学生正在做的案例不被打回列表
        setExperiment((current) =>
          current?.kind === 'library' && current.experiment === load.experiment && current.library.id === target.library.id
            ? current
            : { kind: 'library', experiment: load.experiment, storagePrefix, library: target.library })
        return
      }
      const circuit = target.circuit
      // 指纹同时盖住课程给的引用和解析出来的电路：{"example": id} 本身不随拓展版本变，
      // 内置示例改了版，旧草稿也不该再恢复
      const fingerprint = projectFingerprint({ project: load.project, circuit: circuitSignature(circuit.nodes, circuit.edges) })
      // 同一实验、同一份电路重发 load 时保持原对象：换新对象会让画布按 embed 变化重新适配视图，冲掉学生调好的缩放
      setExperiment((current) =>
        current?.kind === 'circuit' && current.experiment === load.experiment && current.fingerprint === fingerprint
          ? current
          : { kind: 'circuit', experiment: load.experiment, storagePrefix, fingerprint, initial: circuit })
    }
    const stop = startEmbed(window as unknown as EmbedWindow, { resolve: resolveEmbedTarget, applyExperiment: apply, onError: setError })
    const debugProject = debugLibrary ? { library: debugLibrary } : debugExample ? { example: debugExample } : null
    if (debugProject && window.parent === window) {
      const load: LoadMessage = { experiment: `debug-${debugLibrary ?? debugExample}`, project: debugProject, task: null }
      resolveEmbedTarget(load).then((target) => apply(load, target)).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }
    return stop
  }, [debugExample, debugLibrary])

  return (
    <div className="h-screen w-full bg-slate-900 overflow-hidden flex flex-col">
      {error && (
        <div role="alert" className="px-4 py-2 text-sm text-red-300 bg-red-500/10 border-b border-red-500/30">
          {error}
        </div>
      )}
      {experiment?.kind === 'library' ? (
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="p-4 text-sm text-slate-400">正在打开案例库…</div>}>
            <CaseLibraryView key={experiment.experiment} library={experiment.library} experimentPrefix={experiment.storagePrefix} />
          </Suspense>
        </div>
      ) : experiment ? (
        // 宿主每次 ready 都会重发 load：同一实验、同一份电路就不重建画布，免得学生的改动被冲掉
        <div className="flex-1 min-h-0">
          <CircuitWorkspace key={`${experiment.experiment}:${experiment.fingerprint}`} embed={experiment} />
        </div>
      ) : (
        !error && <div className="m-auto text-sm text-slate-400">正在等待课堂发来实验电路…</div>
      )}
    </div>
  )
}
