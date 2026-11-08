/**
 * 嵌入模式的存储：把页面的键值（草稿、参数、运行记录）交给内核，写进宿主给的数据目录。
 *
 * 为什么不用 localStorage：知帆客户端每次启动给拓展页面开一个随机端口，localStorage 按来源（含端口）
 * 隔离，重开客户端学生的草稿就丢了。数据目录（约定 zhifan-ext/1 §3）重启、更新都不变。
 *
 * 读取是同步的（main.ts 里到处是同步的 readStore）：打开时把这个实验前缀下的全部条目预读进内存，
 * 之后读写都走内存；写入攒成一批防抖后发给内核。
 *
 * 写入失败分两种：4xx 是内核说这批不合规（存储已满、键非法），原样重发结果一样，丢掉这批；
 * 网络错误或 5xx 可能只是一时的（内核正忙、正在重启），把这批放回待发，按 1 s、2 s、4 s 退避重试，最多 3 次。
 * 两种都只 console.warn 一次，不打断学生操作。
 */

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface KernelStore extends SyncStorage {
  /** 立即把还没发出去的修改发给内核。keepalive 用于页面关闭时（请求要能活过页面卸载）。 */
  flush(options?: { keepalive?: boolean }): Promise<void>;
  /** 预读成功才是 true；false 时只是内存存储，重开客户端不会保留 */
  readonly persistent: boolean;
  /** 摘掉它注册的 pagehide / visibilitychange 监听、清掉定时器（测试收尾用；页面里不必调用） */
  dispose(): void;
}

export interface KernelStoreOptions {
  fetcher?: typeof fetch;
  debounceMs?: number;
}

/** 浏览器对 keepalive 请求的请求体有 64 KB 的总上限，留出余量 */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;
/** 网络错误或 5xx 之后第 1、2、3 次重试前等多久；用完还失败就放下这批 */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/**
 * 孤立的代理字符（比如被截断的 emoji）编不成合法 UTF-8，内核会判整批非法（422）、一条都不写。
 * 发送前换成 U+FFFD。tsconfig 的 lib 是 ES2020，toWellFormed（ES2024）要自己声明；没有它的旧浏览器原样发。
 */
const wellFormed = (text: string): string =>
  (text as string & { toWellFormed?: () => string }).toWellFormed?.() ?? text;

interface StoreEnvelope {
  status?: string;
  message?: string;
  data?: { entries?: unknown } | null;
}

/** 一批要发的条目：值为 null 表示删除 */
type Batch = Record<string, string | null>;

type SendResult = 'ok' | 'rejected' | 'retryable';

export async function openKernelStore(
  endpoint: string,
  prefix: string,
  options: KernelStoreOptions = {},
): Promise<KernelStore> {
  // 不直接存 fetch 本身：脱离 window 调用会报 Illegal invocation
  const fetcher: typeof fetch = options.fetcher ?? ((input, init) => fetch(input, init));
  const debounceMs = options.debounceMs ?? 250;
  const memory = new Map<string, string>();
  const dirty = new Set<string>();
  // 在路上的写请求。平时最多一个；页面关闭时的 keepalive 请求可能和它同时在路上（见 flush）
  const inflight = new Set<Promise<void>>();
  let persistent = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 计时器此刻等的是退避重试（不是防抖）：期间的新修改跟着那次重试一起发，不提前打扰内核
  let retryPending = false;
  // 连续几次网络错误 / 5xx：决定下一次重试前等多久，以及还重不重试
  let failures = 0;
  let writeWarned = false;

  try {
    const resp = await fetcher(`${endpoint}?prefix=${encodeURIComponent(prefix)}`, { cache: 'no-store' });
    const envelope = (await resp.json()) as StoreEnvelope;
    const entries = envelope?.data?.entries;
    if (!resp.ok || envelope?.status !== 'ok' || typeof entries !== 'object' || entries === null) {
      throw new Error(envelope?.message || `HTTP ${resp.status}`);
    }
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof value === 'string' && key.startsWith(prefix)) memory.set(key, value);
    }
    persistent = true;
  } catch (err) {
    // 旧版内核没有 store、内核没起来：页面照常能用，只是修改留不过这一次打开。
    // 这时也不往内核写：没读到的草稿会被这次的「没有草稿」盖掉（markDirty 只在 persistent 时记账）
    console.warn('内核存储不可用，本次的修改只保存在页面内存里，重新打开后不会保留', err);
  }

  const assertKey = (key: string) => {
    // 只接受本实验前缀下的键，防止串写到别的实验
    if (!key.startsWith(prefix)) throw new Error(`存储键 ${key} 不在 ${prefix} 之下`);
  };

  /** 取出全部脏键当前的值（内存里没有了就是删除），清空脏集合 */
  const takeBatch = (): Batch => {
    const entries: Batch = {};
    for (const key of dirty) {
      const value = memory.get(key);
      entries[key] = value === undefined ? null : wellFormed(value);
    }
    dirty.clear();
    return entries;
  };

  /**
   * 把一批的键放回待发。值在下次取批时从内存现读，所以：这批之后没再改过的键原样重发；
   * 改过的键本来就已经在 dirty 里、带的是新值，再加一遍是空操作——结果正是「只补发没再改过的键」。
   */
  const requeue = (entries: Batch) => {
    for (const key of Object.keys(entries)) dirty.add(key);
  };

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    retryPending = false;
  };

  const warnWrite = (err: unknown) => {
    // 写入失败不打断学生操作，也不刷屏：整个页面只提示一次
    if (!writeWarned) console.warn('修改没能保存到内核存储', err);
    writeWarned = true;
  };

  const post = async (entries: Batch, keepalive: boolean): Promise<SendResult> => {
    try {
      const resp = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
        keepalive,
      });
      if (resp.ok) return 'ok';
      let message = `HTTP ${resp.status}`;
      try {
        message = ((await resp.json()) as StoreEnvelope).message || message;
      } catch {
        /* 不是封套：用状态码 */
      }
      warnWrite(new Error(message));
      // 4xx 是这批本身不合规；其余（5xx 等）当作内核一时出错
      return resp.status >= 400 && resp.status < 500 ? 'rejected' : 'retryable';
    } catch (err) {
      warnWrite(err);
      return 'retryable';
    }
  };

  // schedule / scheduleRetry 在定时器回调里才调 drain（下面定义），那时它早已赋值。
  // 新的修改不被退避压住（与 lab 一致）：照常防抖后发出，放回待发的键跟着一起走，顶替掉原定的重试
  const schedule = () => {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    retryPending = false;
    timer = setTimeout(() => {
      timer = undefined;
      void drain();
    }, debounceMs);
  };

  const scheduleRetry = (delayMs: number) => {
    if (disposed) return;
    clearTimer();
    retryPending = true;
    timer = setTimeout(() => {
      timer = undefined;
      retryPending = false;
      void drain();
    }, delayMs);
  };

  /**
   * 发一批并处理结果（与 lab 一致）：4xx 丢掉这批，不重试；网络错误或 5xx 放回待发，按 1 s、2 s、4 s 退避重试。
   * 重试用完也不丢：键一直留在待发里，由下次修改、flush 或 pagehide 带出去；重试次数只在写成功时清零。
   */
  const send = async (entries: Batch, keepalive: boolean): Promise<void> => {
    const result = await post(entries, keepalive);
    if (result === 'ok') {
      failures = 0;
    } else if (result === 'retryable') {
      requeue(entries);
      if (failures < RETRY_DELAYS_MS.length) {
        scheduleRetry(RETRY_DELAYS_MS[failures]);
        failures += 1;
      }
    }
  };

  const track = (request: Promise<void>): Promise<void> => {
    const tracked: Promise<void> = request.finally(() => inflight.delete(tracked));
    inflight.add(tracked);
    return tracked;
  };

  /** 前面的写请求都回来了才发下一批：新脏键排到下一批，保证同一键的写入顺序 */
  const drain = async (): Promise<void> => {
    while (inflight.size > 0) await Promise.all(inflight);
    // 排在在途请求后面等着的这次发送：要是那次刚失败、排上了退避重试，就交给重试定时器，不立刻重发
    if (retryPending) return;
    if (dirty.size === 0) return;
    await track(send(takeBatch(), false));
  };

  const markDirty = (key: string) => {
    if (!persistent) return;
    dirty.add(key);
    schedule();
  };

  const flush = async (flushOptions: { keepalive?: boolean } = {}): Promise<void> => {
    clearTimer();
    if (!flushOptions.keepalive) return drain();
    if (dirty.size === 0) return;
    // 页面正在关闭：等不到在路上的那批回来，这批直接发。keepalive 请求体超过上限时浏览器会直接拒发，
    // 那就退回普通请求（页面卸载时可能被取消，但总比一定发不出去强）
    const entries = takeBatch();
    const earlier = [...inflight];
    const request = track(send(entries, utf8Bytes(JSON.stringify({ entries })) <= KEEPALIVE_MAX_BYTES));
    if (earlier.length > 0) {
      // 两批同时在路上，内核可能先写这批、后写那批更旧的值。页面要是还活着（只是被藏到后台），
      // 等那批回来后把这批的键再按防抖写一次，内核最终是最新值（后续的写会先等这批也回来）
      void Promise.all(earlier).then(() => {
        requeue(entries);
        schedule();
      });
    }
    return request;
  };

  const onPageHide = () => void flush({ keepalive: true });
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void flush({ keepalive: true });
  };
  const listening = persistent && typeof window !== 'undefined';
  if (listening) {
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    get persistent() {
      return persistent;
    },
    getItem(key) {
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      assertKey(key);
      if (memory.get(key) === value) return;
      memory.set(key, value);
      markDirty(key);
    },
    removeItem(key) {
      assertKey(key);
      if (!memory.has(key)) return;
      memory.delete(key);
      markDirty(key);
    },
    flush,
    dispose() {
      disposed = true;
      clearTimer();
      if (listening) {
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    },
  };
}
