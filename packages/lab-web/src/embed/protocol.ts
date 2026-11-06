import type { Edge, Node } from '@xyflow/react'

import type { CircuitNodeData } from '@/types/circuit'

/**
 * 嵌入模式（知帆拓展约定 zhifan-ext/1 §4）：页面在宿主 iframe 里以 #/embed 打开，
 * 加载好后向父窗口发 ready，宿主回 load（实验 id + 算例 + 任务），每次 ready 都会重发 load。
 * 这里只放协议与存储隔离的纯逻辑，与 grid-web/src/embed.ts 同一套规则；界面怎么收起由 EmbedPage 负责。
 */

export const CONTRACT = 'zhifan-ext/1'

export type ExtMessage =
  | { source: 'zhifan-ext'; type: 'ready'; contract: string }
  | { source: 'zhifan-ext'; type: 'error'; message: string }

export const readyMessage = (): ExtMessage => ({ source: 'zhifan-ext', type: 'ready', contract: CONTRACT })
export const errorMessage = (message: string): ExtMessage => ({ source: 'zhifan-ext', type: 'error', message })

export interface LoadMessage {
  experiment: string
  project: unknown
  task: unknown
}

/** 只认宿主发来的 load；其他消息（包括格式不对的）一律返回 null，不报错。 */
export function parseLoadMessage(data: unknown): LoadMessage | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.source !== 'zhifan-host' || d.type !== 'load') return null
  if (typeof d.experiment !== 'string' || d.experiment.length === 0) return null
  return { experiment: d.experiment, project: d.project ?? null, task: d.task ?? null }
}

export type ResolvedProject =
  | { kind: 'example'; id: string }
  | { kind: 'library'; id: string }
  | { kind: 'project'; project: unknown }
  | { kind: 'error'; message: string }

/**
 * load.project 可以是 simulearn.project/1 工程文件信封，也可以是 {"example": "<内置示例 id>"}（约定 §4）。
 * {"library": "<案例库 id>"} 打开内置案例库：学生在列表里自己挑案例（project 的内容由拓展解释，宿主原样转发）
 */
export function resolveProject(project: unknown): ResolvedProject {
  if (project == null) return { kind: 'error', message: '课堂没有给出实验电路' }
  if (typeof project === 'object' && 'library' in project) {
    const id = (project as { library: unknown }).library
    return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)
      ? { kind: 'library', id }
      : { kind: 'error', message: '案例库名称无效' }
  }
  if (typeof project === 'object' && 'example' in project) {
    const id = (project as { example: unknown }).example
    return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)
      ? { kind: 'example', id }
      : { kind: 'error', message: '实验电路的示例名称无效' }
  }
  return { kind: 'project', project }
}

/** 按实验隔离本地存储（约定 §3/§4）：实验 id 来自课程包，只保留安全字符，避免拼进别的命名空间。 */
export function experimentKeyPrefix(experiment: string): string {
  const safe = experiment.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '_'
  return `slp:lab:exp:${safe}:`
}

/**
 * 课程包里的电路可能随课程更新：学生的草稿要和「它基于哪份电路」绑在一起，
 * 电路变了就不再恢复旧草稿。FNV-1a 足够区分，不需要密码学强度。
 */
export function projectFingerprint(project: unknown): string {
  const text = JSON.stringify(project) ?? ''
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 「学生改没改过电路」只看电气内容（元件、参数、连线），不看位置、旋转、字号：
 * 拖动排布不改变电路本身，不该因此留下草稿。
 */
export function circuitSignature(nodes: Node<CircuitNodeData>[], edges: Edge[]): string {
  return JSON.stringify({
    nodes: nodes
      .map((node) => ({ id: node.id, type: node.type, parameters: node.data.parameters }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map((edge) => [edge.source, edge.sourceHandle ?? '', edge.target, edge.targetHandle ?? ''].join('|'))
      .sort(),
  })
}

/** 嵌入页面与父窗口之间只需要这几样，测试里可以直接伪造。 */
export interface EmbedWindow {
  parent: { postMessage(message: unknown, targetOrigin: string): void }
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

export interface EmbedHooks<T> {
  /** 把 load.project 解析成画布能用的电路；解析不了就抛出人能看懂的错误 */
  resolve(load: LoadMessage): Promise<T>
  /** 拿到实验与它的初始电路后由界面接手（恢复草稿、上画布） */
  applyExperiment(load: LoadMessage, circuit: T): void
  onError(message: string): void
}

/**
 * 接上宿主：监听 load，并立即发 ready。返回取消监听的函数。
 * 不在 iframe 里（parent 就是自己）时不发任何消息。
 */
export function startEmbed<T>(win: EmbedWindow, hooks: EmbedHooks<T>): () => void {
  const parent = win.parent
  const inFrame = (parent as unknown) !== (win as unknown)
  // 约定 §4：页面不知道宿主界面的端口，发给宿主一律用 "*"（这些消息里没有秘密）
  const post = (message: ExtMessage) => {
    if (inFrame) parent.postMessage(message, '*')
  }

  const handle = async (load: LoadMessage) => {
    try {
      hooks.applyExperiment(load, await hooks.resolve(load))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      hooks.onError(message)
      post(errorMessage(message))
    }
  }

  const listener = (event: MessageEvent) => {
    // 只认父窗口发来的消息（约定 §4：页面只认 event.source === window.parent）
    if (event.source !== (parent as unknown)) return
    const load = parseLoadMessage(event.data)
    if (load) void handle(load)
  }

  win.addEventListener('message', listener)
  post(readyMessage())
  return () => win.removeEventListener('message', listener)
}
