import { API_BASE_URL } from '@/simulation/apiBase'
import { openKernelStore, type KernelStore, type SyncStorage } from './kernelStore'

/**
 * 页面存储（草稿、上次打开的案例）落在哪：嵌入知帆时是这个实验的内核镜像（kernelStore.ts，客户端重开也还在），
 * 没打开过镜像的时候（开发态的独立页面、单元测试）照旧是 localStorage。
 * 按键的前缀找镜像：换实验时旧工作区卸载前最后那次落盘仍然落回旧实验自己的存储，不会串到新实验里。
 */
const opening = new Map<string, Promise<KernelStore>>()
const stores: KernelStore[] = []

/**
 * 打开本实验的内核镜像。同一前缀只开一次：宿主每次 ready 都重发 load，重新预读会拿内核里的旧内容
 * 盖掉内存里还没发出去的改动
 */
export function openExperimentStore(prefix: string, open = openKernelStore): Promise<KernelStore> {
  let pending = opening.get(prefix)
  if (!pending) {
    pending = open(`${API_BASE_URL}/store`, prefix).then((store) => {
      stores.push(store)
      return store
    })
    opening.set(prefix, pending)
  }
  return pending
}

function storageFor(key: string): SyncStorage {
  if (stores.length === 0) return localStorage
  const store = stores.find((item) => key.startsWith(item.prefix))
  if (!store) throw new Error(`存储键 ${key} 不属于已打开的实验`)
  return store
}

/** 调用方照旧 try/catch：localStorage 可能被禁用，镜像对不上前缀的键会抛错 */
export const pageStorage: SyncStorage = {
  getItem: (key) => storageFor(key).getItem(key),
  setItem: (key, value) => storageFor(key).setItem(key, value),
  removeItem: (key) => storageFor(key).removeItem(key),
}

/** 把还没发给内核的改动立即发出去（localStorage 是同步写的，没有要发的） */
export function flushPageStorage(options?: { keepalive?: boolean }): void {
  for (const store of stores) void store.flush(options)
}

/** 测试用：关掉所有镜像，回到 localStorage */
export async function resetPageStorage(): Promise<void> {
  const open = [...stores]
  stores.length = 0
  opening.clear()
  await Promise.all(open.map((store) => store.close()))
}
