import type { CaseDemoScript } from './types'

// 演示数据按需加载：每个演示单独一个 chunk，案例库首屏不背这些逐步电路
const scripts = import.meta.glob<{ default: unknown }>('../demos/*.json')

export function demoScriptKey(caseId: string, demoId: string): string {
  return `../demos/${caseId}.${demoId}.json`
}

export async function loadDemoScript(caseId: string, demoId: string): Promise<CaseDemoScript> {
  const load = scripts[demoScriptKey(caseId, demoId)]
  if (!load) throw new Error(`没有找到演示 ${caseId} / ${demoId}`)
  const module = await load()
  return module.default as CaseDemoScript
}

/** 全部演示数据的键（测试用：每个案例索引里的演示都要有数据文件，反之亦然） */
export function allDemoScriptKeys(): string[] {
  return Object.keys(scripts)
}
