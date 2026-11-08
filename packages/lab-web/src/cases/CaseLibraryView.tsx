import { useCallback, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'

import { hasDraft } from '@/embed/circuit'
import { flushPageStorage, pageStorage } from '@/embed/storage'
import { CircuitWorkspace, type WorkspaceEmbed } from '@/workspace/CircuitWorkspace'
import { CaseGuide } from './CaseGuide'
import { presetSettings } from './checks'
import { caseCircuit, caseFingerprint } from './library'
import { caseStoragePrefix } from './meta'
import { shortMethodLabel } from '@/workspace/methodLabels'
import type { CaseLibrary, TeachingCase } from './types'

const LAST_CASE_KEY = 'last-case'

function readLastCase(prefix: string): string | null {
  try {
    return pageStorage.getItem(prefix + LAST_CASE_KEY)
  } catch {
    return null
  }
}

function writeLastCase(prefix: string, id: string | null): void {
  try {
    if (id) pageStorage.setItem(prefix + LAST_CASE_KEY, id)
    else pageStorage.removeItem(prefix + LAST_CASE_KEY)
  } catch {
    // 记不住上次的案例只是少个方便
  }
  // 嵌入时存在内核里（storage.ts）：选了案例马上发出去，学生紧接着关掉客户端也记得住
  flushPageStorage()
}

function openCase(item: TeachingCase, experimentPrefix: string, onBack: () => void): WorkspaceEmbed {
  const initial = caseCircuit(item)
  return {
    storagePrefix: caseStoragePrefix(experimentPrefix, item.id),
    fingerprint: caseFingerprint(item, initial),
    initial,
    preset: { settings: presetSettings(item.preset), theveninRefs: item.preset.theveninPort },
    guide: <CaseGuide item={item} />,
    onBack,
  }
}

/**
 * 案例库（课程包里 {"library": id}）：先列出全部案例，学生点进去做；
 * 「案例列表」回到这里。上次打开的案例记在本实验的存储里（嵌入时是内核镜像），客户端重开后直接回到它。
 */
export function CaseLibraryView({ library, experimentPrefix }: { library: CaseLibrary; experimentPrefix: string }) {
  const [selected, setSelected] = useState<string | null>(() => {
    const last = readLastCase(experimentPrefix)
    return last && library.cases.some((item) => item.id === last) ? last : null
  })

  const choose = useCallback((id: string | null) => {
    writeLastCase(experimentPrefix, id)
    setSelected(id)
  }, [experimentPrefix])

  const embed = useMemo(() => {
    const item = library.cases.find((entry) => entry.id === selected)
    return item ? openCase(item, experimentPrefix, () => choose(null)) : null
  }, [library, selected, experimentPrefix, choose])

  if (embed && selected) {
    return <CircuitWorkspace key={`${selected}:${embed.fingerprint}`} embed={embed} />
  }

  const chapters = new Map<number, TeachingCase[]>()
  for (const item of library.cases) chapters.set(item.chapter, [...(chapters.get(item.chapter) ?? []), item])

  return (
    <div className="h-full overflow-y-auto bg-slate-900 text-slate-200">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-5">
          <h1 className="text-lg font-semibold text-slate-100">{library.title}</h1>
          <p className="mt-1 text-sm text-slate-400">{library.subtitle}。点一个案例打开：电路结构固定，参数可以随便改。</p>
        </header>
        {[...chapters.entries()].map(([chapter, items]) => (
          <section key={chapter} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-300">第 {chapter} 章 {items[0].chapterTitle}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => choose(item.id)}
                    className="group flex h-full w-full items-start gap-2 rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-left transition-colors hover:border-blue-500/60 hover:bg-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        <span className="rounded bg-slate-700/80 px-1.5 py-0.5 text-slate-300">{item.source}</span>
                        <span>{shortMethodLabel(item.preset.method)}</span>
                        {hasDraft(caseStoragePrefix(experimentPrefix, item.id), caseFingerprint(item)) && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">改过参数</span>
                        )}
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-100">{item.title}</div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.summary}</p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-500 group-hover:text-blue-400" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
