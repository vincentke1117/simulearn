import { unwrapProjectFile } from './envelope';
import type { Topology } from './types';

/**
 * 嵌入模式（知帆拓展约定 zhifan-ext/1 §4）：页面在宿主 iframe 里以 #/embed 打开，
 * 加载好后向父窗口发 ready，宿主回 load（实验 id + 算例 + 任务），每次 ready 都会重发 load。
 * 这里只放协议与存储隔离的纯逻辑；界面怎么收起由 main.ts 负责。
 */

export const CONTRACT = 'zhifan-ext/1';

export function isEmbedHash(hash: string): boolean {
  return hash === '#/embed' || hash.startsWith('#/embed?') || hash.startsWith('#/embed/');
}

/** #/embed?example=ieee33 → URLSearchParams（直接打开内置算例，便于不经宿主调试） */
export function embedQuery(hash: string): URLSearchParams {
  const i = hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
}

export type ExtMessage =
  | { source: 'zhifan-ext'; type: 'ready'; contract: string }
  | { source: 'zhifan-ext'; type: 'error'; message: string };

export const readyMessage = (): ExtMessage => ({ source: 'zhifan-ext', type: 'ready', contract: CONTRACT });
export const errorMessage = (message: string): ExtMessage => ({ source: 'zhifan-ext', type: 'error', message });

export interface LoadMessage {
  experiment: string;
  project: unknown;
  task: unknown;
}

/** 只认宿主发来的 load；其他消息（包括格式不对的）一律返回 null，不报错。 */
export function parseLoadMessage(data: unknown): LoadMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.source !== 'zhifan-host' || d.type !== 'load') return null;
  if (typeof d.experiment !== 'string' || d.experiment.length === 0) return null;
  return { experiment: d.experiment, project: d.project ?? null, task: d.task ?? null };
}

export type ResolvedProject =
  | { kind: 'example'; name: string }
  | { kind: 'topology'; topology: Topology }
  | { kind: 'error'; message: string };

/** load.project 可以是 simulearn.project/1 工程文件信封，也可以是 {"example": "<内置算例名>"}（约定 §4） */
export function resolveProject(project: unknown): ResolvedProject {
  if (project == null) return { kind: 'error', message: '宿主没有给出实验算例' };
  if (typeof project === 'object' && 'example' in project) {
    const name = (project as { example: unknown }).example;
    return typeof name === 'string' && /^[A-Za-z0-9_-]+$/.test(name)
      ? { kind: 'example', name }
      : { kind: 'error', message: '实验算例名称无效' };
  }
  const unwrapped = unwrapProjectFile(project);
  return unwrapped.ok ? { kind: 'topology', topology: unwrapped.topology } : { kind: 'error', message: unwrapped.error };
}

/** 按实验隔离本地存储（约定 §3/§4）：实验 id 来自课程包，只保留安全字符，避免拼进别的命名空间。 */
export function experimentKeyPrefix(experiment: string): string {
  const safe = experiment.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '_';
  return `slp:grid:exp:${safe}:`;
}

/**
 * 课程包里的算例可能随课程更新：学生的草稿要和「它基于哪份算例」绑在一起，
 * 算例变了就不再恢复旧草稿。FNV-1a 足够区分，不需要密码学强度。
 */
export function projectFingerprint(project: unknown): string {
  const text = JSON.stringify(project) ?? '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 「学生改没改过算例」只看电气内容，不看元件位置：
 * 点一下元件就会吸附到网格、改动坐标，拖动排布也不改变算例本身。
 */
export function layoutFreeSignature(topology: Topology): string {
  const nodes = (topology.nodes ?? []).map((node) => {
    const rest: Record<string, unknown> = { ...node };
    delete rest.loc;
    return rest;
  });
  return JSON.stringify({ ...topology, nodes });
}

/** 嵌入页面与父窗口之间只需要这几样，测试里可以直接伪造。 */
export interface EmbedWindow {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface EmbedHooks {
  loadExample(name: string): Promise<Topology>;
  /** 拿到实验与它的初始算例后由界面接手（恢复草稿、上画布、提示） */
  applyExperiment(load: LoadMessage, topology: Topology): void;
  onError(message: string): void;
}

/**
 * 接上宿主：监听 load，并立即发 ready。返回取消监听的函数。
 * 不在 iframe 里（parent 就是自己）时不发任何消息。
 */
export function startEmbed(win: EmbedWindow, hooks: EmbedHooks): () => void {
  const parent = win.parent;
  const inFrame = (parent as unknown) !== (win as unknown);
  // 约定 §4：页面不知道宿主界面的端口，发给宿主一律用 "*"（这些消息里没有秘密）
  const post = (message: ExtMessage) => {
    if (inFrame) parent.postMessage(message, '*');
  };

  const handle = async (load: LoadMessage) => {
    try {
      const resolved = resolveProject(load.project);
      if (resolved.kind === 'error') throw new Error(resolved.message);
      const topology = resolved.kind === 'example' ? await hooks.loadExample(resolved.name) : resolved.topology;
      hooks.applyExperiment(load, topology);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      hooks.onError(message);
      post(errorMessage(message));
    }
  };

  const listener = (event: MessageEvent) => {
    // 只认父窗口发来的消息（约定 §4：页面只认 event.source === window.parent）
    if (event.source !== (parent as unknown)) return;
    const load = parseLoadMessage(event.data);
    if (load) void handle(load);
  };

  win.addEventListener('message', listener);
  post(readyMessage());
  return () => win.removeEventListener('message', listener);
}
