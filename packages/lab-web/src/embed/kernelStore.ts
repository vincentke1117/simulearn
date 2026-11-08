/**
 * 内核镜像存储：嵌入知帆时，草稿、上次打开的案例交给内核，写进宿主给的 --data-dir（约定 zhifan-ext/1 §3）。
 * 知帆每次启动都给拓展页面另开一个随机端口，localStorage 跟着来源（含端口）走，客户端一重开就全丢了；
 * 数据目录按拓展 id 固定，重启、更新都不变。
 *
 * 页面里读这些的地方都是同步的（工作区初始化时读草稿、列表渲染时标「改过参数」），所以打开时先把本实验前缀下的
 * 全部条目预读进内存，之后读写都走内存；写入攒一小会儿成批发给内核。
 * 与 grid-web 的同名模块是同一份逻辑、同一套接口（内核两边形状一致），改一边记得对照另一边。
 */

export interface SyncStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface KernelStore extends SyncStorage {
  /** 只管以它开头的键：一个实验一份，防止串到别的实验 */
  readonly prefix: string
  /** 预读成功、改动会落到内核；false 时是纯内存（旧内核没有 store 接口、连不上），关掉页面就没了 */
  readonly persistent: boolean
  /** 立即把还没发出去的改动发给内核。keepalive：页面正在被卸掉，请求要在页面没了之后还能发完 */
  flush(options?: { keepalive?: boolean }): Promise<void>
  /** 摘掉 pagehide / visibilitychange 监听，并把剩下的改动发出去 */
  close(): Promise<void>
  /** 摘掉监听、清掉防抖和重试的定时器，之后不再自动发（不发剩下的改动）。测试收尾用，页面里不必调 */
  dispose(): void
}

export interface KernelStoreOptions {
  fetcher?: typeof fetch
  debounceMs?: number
}

// 内核那边的上限（packages/lab-backend/src/Store.jl）：单值 4 MiB、请求体 8 MiB。一批留出余量
const MAX_VALUE_BYTES = 4 * 1024 * 1024
const MAX_BATCH_BYTES = 6 * 1024 * 1024
// 浏览器对在途 keepalive 请求的请求体合计限 64 KB，超了 fetch 直接失败；留点余量，超了就退回普通请求
export const KEEPALIVE_MAX_BYTES = 60 * 1024
// 连不上或内核 5xx 时自动重试的间隔。三次都不成就不再自己重试，等下次改动或 flush
const RETRY_DELAYS_MS = [1000, 2000, 4000]

const encoder = new TextEncoder()
const byteLength = (text: string) => encoder.encode(text).length

/**
 * 孤立的代理字符（截断的 emoji 之类）JSON.stringify 会照原样转义发出去，内核按非法文本把整批拒掉（422），
 * 发之前换成 U+FFFD。tsconfig 的 lib 是 ES2020，toWellFormed 不在类型里；没有它的旧浏览器原样发
 */
const wellFormed = (text: string): string => (text as string & { toWellFormed?: () => string }).toWellFormed?.() ?? text

interface StoreEnvelope {
  status?: unknown
  data?: { entries?: unknown } | null
}

/** 发出去的一批，连同取批时每个键的版本：之后版本没变的键才是「发出去以后没再改过」 */
interface Batch {
  entries: Record<string, string | null>
  versions: Map<string, number>
}

/** 预读：只认 status 为 ok、entries 是对象的封套；别的（旧内核的 404 页面、错误封套）一律当失败 */
async function preload(fetcher: typeof fetch, endpoint: string, prefix: string): Promise<Map<string, string>> {
  const response = await fetcher(`${endpoint}?prefix=${encodeURIComponent(prefix)}`)
  if (!response.ok) throw new Error(`内核返回 ${response.status}`)
  const envelope = (await response.json()) as StoreEnvelope
  const entries = envelope?.data?.entries
  if (envelope?.status !== 'ok' || !entries || typeof entries !== 'object') throw new Error('内核回的不是存储封套')
  const memory = new Map<string, string>()
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    if (key.startsWith(prefix) && typeof value === 'string') memory.set(key, value)
  }
  return memory
}

/**
 * 打开一个实验的镜像存储。不会失败：预读不成就退回纯内存（console.warn 一次），页面照常能用，只是不能跨重启。
 * 预读不设超时：内核第一次处理请求可能要现场编译，等一会儿也比整节课的改动都存不下来强。
 */
export async function openKernelStore(endpoint: string, prefix: string, options: KernelStoreOptions = {}): Promise<KernelStore> {
  const fetcher: typeof fetch = options.fetcher ?? ((input, init) => fetch(input, init))
  const debounceMs = options.debounceMs ?? 250

  let memory = new Map<string, string>()
  let persistent = true
  try {
    memory = await preload(fetcher, endpoint, prefix)
  } catch (err) {
    persistent = false
    console.warn('读不到内核里存的进度，这次的改动只留在页面里（关掉就没了）：', err)
  }

  const dirty = new Set<string>()
  // 每个键改过几次：一批发出去之后哪些键又被改过，看版本变没变
  const versions = new Map<string, number>()
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  // 已经自动重试了几次；有一次写成功就清零
  let retries = 0
  let running: Promise<void> | null = null
  // keepalive 发出去、还没回来的请求：普通写入要等它们回来再发，免得同一个键的旧值后到、盖掉新值
  const keepaliveSends = new Set<Promise<void>>()
  let disposed = false
  let warnedWrite = false
  const warnWrite = (reason: unknown) => {
    if (warnedWrite) return
    warnedWrite = true
    console.warn('进度没能存进内核（页面里照常可用）：', reason)
  }

  const checkKey = (key: string) => {
    if (!key.startsWith(prefix)) throw new Error(`存储键 ${key} 不属于这个实验（${prefix}）`)
  }

  const cancelDebounce = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const cancelRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  const scheduleDebounce = () => {
    if (disposed) return
    cancelDebounce()
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void pump()
    }, debounceMs)
  }

  /** 连不上或内核出错后按 1 s、2 s、4 s 退避自动重试；已经排上了就不再排，三次之后不再自己重试 */
  const scheduleRetry = () => {
    if (disposed || retryTimer !== null || retries >= RETRY_DELAYS_MS.length) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      retries += 1
      void pump()
    }, RETRY_DELAYS_MS[retries])
  }

  const markDirty = (key: string) => {
    // 预读失败时不往内核写：没读到的草稿会被这次的「没有草稿」盖掉
    if (!persistent) return
    versions.set(key, (versions.get(key) ?? 0) + 1)
    dirty.add(key)
    scheduleDebounce()
  }

  /** 这批里发出去以后没再改过的键放回待发；改过的本来就在待发里（或已经带着新值发出去了）。返回放回了几个 */
  const requeue = (batch: Batch): number => {
    let count = 0
    for (const [key, version] of batch.versions) {
      if (versions.get(key) !== version || dirty.has(key)) continue
      dirty.add(key)
      count += 1
    }
    return count
  }

  /** 从脏键里取一批（请求体不超过 limit）；单值超过内核上限的发了也是整批被拒，只留在内存里 */
  const takeBatch = (limit: number): Batch => {
    const batch: Batch = { entries: {}, versions: new Map() }
    let size = 0
    for (const key of dirty) {
      const stored = memory.get(key)
      const value = stored === undefined ? null : wellFormed(stored)
      if (value !== null && byteLength(value) > MAX_VALUE_BYTES) {
        dirty.delete(key)
        warnWrite(new Error(`${key} 的内容超过 4 MiB`))
        continue
      }
      const bytes = byteLength(JSON.stringify(key)) + byteLength(JSON.stringify(value)) + 2
      if (size > 0 && size + bytes > limit) break
      batch.entries[key] = value
      batch.versions.set(key, versions.get(key) ?? 0)
      size += bytes
      dirty.delete(key)
    }
    return batch
  }

  /**
   * 发一批，不抛错。4xx（键非法、存满了）原样重发结果一样：丢掉这批，内存里照旧。
   * 连不上或 5xx：没再改过的键放回待发，排上退避重试，返回 false
   */
  const send = async (batch: Batch, keepalive: boolean): Promise<boolean> => {
    if (batch.versions.size === 0) return true
    const body = JSON.stringify({ entries: batch.entries })
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: keepalive && byteLength(body) <= KEEPALIVE_MAX_BYTES,
      })
      if (response.ok) {
        retries = 0
        if (dirty.size === 0) cancelRetry()
        return true
      }
      if (response.status >= 400 && response.status < 500) {
        warnWrite(new Error(`内核拒绝写入（${response.status}）`))
        return true
      }
      throw new Error(`内核返回 ${response.status}`)
    } catch (err) {
      requeue(batch)
      warnWrite(err)
      scheduleRetry()
      return false
    }
  }

  /** 同一时刻只有一个普通写请求在路上；在路上时新改的键排到下一批，保证同一个键按改动的先后落盘 */
  const pump = (): Promise<void> => {
    if (running) return running
    running = (async () => {
      try {
        while (dirty.size > 0) {
          if (keepaliveSends.size > 0) {
            await Promise.allSettled([...keepaliveSends])
            continue
          }
          if (!(await send(takeBatch(MAX_BATCH_BYTES), false))) break
        }
      } finally {
        running = null
      }
    })()
    return running
  }

  const sendKeepalive = (batch: Batch): Promise<void> => {
    const sending: Promise<void> = send(batch, true).then(() => {
      keepaliveSends.delete(sending)
    })
    keepaliveSends.add(sending)
    return sending
  }

  const flush = async ({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> => {
    cancelDebounce()
    if (!persistent) return
    if (!keepalive) return pump()
    if (dirty.size === 0) return
    // 页面要被卸掉了，等不到在路上的请求回来：剩下的一次发出去。可它和在路上的请求谁先落盘说不准，
    // 所以等前面的都回来后，把这批里没再改过的键放回待发、按正常防抖再写一次：页面还活着的话，内核最终是最新值
    const ahead: Promise<unknown>[] = [...keepaliveSends]
    if (running) ahead.push(running)
    const batch = takeBatch(Number.POSITIVE_INFINITY)
    const sending = sendKeepalive(batch)
    if (ahead.length > 0) {
      void Promise.allSettled(ahead).then(() => {
        if (requeue(batch) > 0) scheduleDebounce()
      })
    }
    await sending
  }

  const onPageHide = () => void flush({ keepalive: true })
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void flush({ keepalive: true })
  }
  if (persistent) {
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
  }

  const dispose = () => {
    disposed = true
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibility)
    cancelDebounce()
    cancelRetry()
  }

  return {
    prefix,
    persistent,
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      checkKey(key)
      const text = String(value)
      if (memory.get(key) === text) return
      memory.set(key, text)
      markDirty(key)
    },
    removeItem: (key) => {
      checkKey(key)
      // 预读拿到的是这个前缀下的全部条目：内存里没有，内核里也没有，不必发
      if (!memory.has(key)) return
      memory.delete(key)
      markDirty(key)
    },
    flush,
    close: async () => {
      dispose()
      await flush()
    },
    dispose,
  }
}
