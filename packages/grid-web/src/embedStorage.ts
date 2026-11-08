/**
 * 嵌入模式（知帆拓展）里「实验 ↔ 存储」的接线，从 main.ts 提出来便于在 jsdom 里测：
 *  - 每个实验的内核存储只打开一次；
 *  - 先等它预读完，再换上它、读草稿、上画布（画布不会先画初始算例再跳成草稿）；
 *  - 宿主连发几次 load 时以最后一次为准；
 *  - 页面关闭前先同步存一次草稿，再用 keepalive 请求把还没发出去的修改送给内核。
 * 换存储之后读参数、画画布这些界面上的事由 main.ts 注入。
 */

import { experimentKeyPrefix, projectFingerprint, type LoadMessage } from './embed';
import type { KernelStore, SyncStorage } from './kernelStore';
import type { Topology } from './types';

/** 草稿在实验前缀下的键名（键全名是 slp:grid:exp:<实验>:embed-draft-v2） */
export const DRAFT_KEY = 'embed-draft-v2';

/** 存下来的草稿：它基于哪份算例（指纹）、算例刚上画布时的电气签名、学生改过的拓扑 */
export interface SavedDraft {
  fingerprint: string;
  snapshot: string;
  topology: Topology;
}

/** 读出与当前算例指纹一致的草稿；没有、损坏、算例已经换了都返回 null（用初始算例） */
export function readDraft(storage: SyncStorage, prefix: string, fingerprint: string): SavedDraft | null {
  let saved: { fingerprint?: unknown; snapshot?: unknown; topology?: Topology } | null = null;
  try {
    saved = JSON.parse(storage.getItem(prefix + DRAFT_KEY) ?? 'null');
  } catch {
    return null;
  }
  if (saved?.fingerprint === fingerprint && typeof saved.snapshot === 'string' && saved.topology?.nodes?.length) {
    return { fingerprint, snapshot: saved.snapshot, topology: saved.topology };
  }
  return null;
}

export interface EmbedStorageDeps {
  /** 打开一个实验前缀的存储（main.ts 里是 openKernelStore(apiUrl('store'), prefix)） */
  open(prefix: string): Promise<KernelStore>;
  /** 存储预读完、且确认是最后一次 load：换上这个存储，读出存过的参数 */
  activate(store: KernelStore, prefix: string): void;
  /** 上画布：draft 不为 null 时恢复上次的修改，否则画课程给的初始算例 */
  show(load: LoadMessage, topology: Topology, fingerprint: string, draft: SavedDraft | null): void;
  /** 把画布当前状态同步写成草稿（画布改动有 400 ms 防抖，页面关闭时等不到它） */
  saveDraft(): void;
}

export interface EmbedStorage {
  /** 宿主发来 load、算例也取到之后调用（startEmbed 的 applyExperiment 钩子） */
  applyExperiment(load: LoadMessage, topology: Topology): Promise<void>;
  /** 页面要关了：同步存草稿，再用 keepalive 把还没发出去的修改送给内核 */
  saveBeforeLeaving(): void;
  /**
   * 在 pagehide / visibilitychange(hidden) 上挂 saveBeforeLeaving，返回摘掉监听的函数。
   * 要在打开任何存储之前挂：存储自己也监听这两个事件（只 flush），排在它前面，
   * 最后一次改动和之前没发出去的修改才会合成一个请求发出去。
   */
  bindPageLeave(win: Pick<Window, 'addEventListener' | 'removeEventListener'>, doc: Document): () => void;
}

export function createEmbedStorage(deps: EmbedStorageDeps): EmbedStorage {
  // 每个实验的存储只打开一次：宿主每次 ready 都会重发 load，重新预读可能读到还没写进内核的旧值
  const stores = new Map<string, Promise<KernelStore>>();
  let latestLoad = 0;
  let active: KernelStore | null = null;

  const storeFor = (prefix: string): Promise<KernelStore> => {
    let store = stores.get(prefix);
    if (!store) {
      store = deps.open(prefix);
      stores.set(prefix, store);
    }
    return store;
  };

  const applyExperiment = async (load: LoadMessage, topology: Topology): Promise<void> => {
    const seq = ++latestLoad;
    const prefix = experimentKeyPrefix(load.experiment);
    // 先把这个实验存过的东西预读进来，再读草稿、上画布：顺序和原来「收到 load → 读草稿 → 画」一致
    const store = await storeFor(prefix);
    // 预读期间宿主又发来一次 load：以最后一次为准
    if (seq !== latestLoad) return;
    active = store;
    deps.activate(store, prefix);
    const fingerprint = projectFingerprint(load.project);
    deps.show(load, topology, fingerprint, readDraft(store, prefix, fingerprint));
  };

  const saveBeforeLeaving = () => {
    if (!active) return;
    deps.saveDraft();
    void active.flush({ keepalive: true });
  };

  const bindPageLeave: EmbedStorage['bindPageLeave'] = (win, doc) => {
    const onPageHide = () => saveBeforeLeaving();
    const onVisibilityChange = () => {
      if (doc.visibilityState === 'hidden') saveBeforeLeaving();
    };
    win.addEventListener('pagehide', onPageHide);
    doc.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      win.removeEventListener('pagehide', onPageHide);
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    };
  };

  return { applyExperiment, saveBeforeLeaving, bindPageLeave };
}
