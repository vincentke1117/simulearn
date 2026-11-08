// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { experimentKeyPrefix, projectFingerprint, type LoadMessage } from './embed';
import { createEmbedStorage, DRAFT_KEY, readDraft, type EmbedStorageDeps } from './embedStorage';
import { openKernelStore, type KernelStore } from './kernelStore';
import type { Topology } from './types';

const ENDPOINT = '../api/grid/store';

const topo = (busId: string): Topology =>
  ({ meta: { baseMVA: 100, feeder: 'F1' }, nodes: [{ id: busId, type: 'Bus' }], links: [] }) as unknown as Topology;

const loadOf = (experiment: string, project: unknown = { example: 'ch12' }): LoadMessage => ({ experiment, project, task: null });

const okResponse = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ status: 'ok', message: '', data }) }) as unknown as Response;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * 假内核：预读（GET）可以按实验挂住，直到测试放行；写请求（POST）记下来并立即成功。
 * 草稿按 entries 预置，模拟上次打开时已经存进数据目录的内容。
 */
function fakeKernel(entries: Record<string, string> = {}) {
  const gates = new Map<string, Deferred<void>>();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (init?.method === 'POST') return okResponse({ written: 1, removed: 0 });
    const prefix = decodeURIComponent(String(input).split('?prefix=')[1] ?? '');
    await gates.get(prefix)?.promise;
    return okResponse({ entries: Object.fromEntries(Object.entries(entries).filter(([key]) => key.startsWith(prefix))) });
  });
  return {
    fetcher,
    /** 让某个实验的预读挂住，返回放行函数 */
    hold(experiment: string): () => void {
      const gate = deferred<void>();
      gates.set(experimentKeyPrefix(experiment), gate);
      return () => gate.resolve();
    },
    posts: () =>
      fetcher.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => ({
          entries: (JSON.parse(String(init?.body)) as { entries: Record<string, string | null> }).entries,
          keepalive: init?.keepalive === true,
        })),
  };
}

const opened: KernelStore[] = [];
const unbind: Array<() => void> = [];

/** 按 main.ts 的接法造依赖：activate 记下换上的存储，saveDraft 把「画布上的草稿」写进去 */
function wire(kernel: ReturnType<typeof fakeKernel>, debounceMs = 250) {
  const state = { store: null as KernelStore | null, prefix: '', canvas: null as string | null };
  const deps = {
    open: vi.fn(async (prefix: string) => {
      const store = await openKernelStore(ENDPOINT, prefix, { fetcher: kernel.fetcher, debounceMs });
      opened.push(store);
      return store;
    }),
    activate: vi.fn((store: KernelStore, prefix: string) => {
      state.store = store;
      state.prefix = prefix;
    }),
    show: vi.fn(),
    saveDraft: vi.fn(() => {
      if (state.store && state.canvas !== null) state.store.setItem(state.prefix + DRAFT_KEY, state.canvas);
    }),
  } satisfies EmbedStorageDeps;
  return { deps, state };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const off of unbind.splice(0)) off();
  for (const store of opened.splice(0)) store.dispose();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.useRealTimers();
  warn.mockRestore();
});

describe('readDraft', () => {
  const prefix = experimentKeyPrefix('ch12-tap-1');
  const storage = (value: string | null) => ({ getItem: vi.fn(() => value), setItem: vi.fn(), removeItem: vi.fn() });

  it('returns the draft only when it was made from the same project', () => {
    const draft = { fingerprint: 'f1', snapshot: 's', topology: topo('bus-9') };
    const store = storage(JSON.stringify(draft));
    expect(readDraft(store, prefix, 'f1')).toEqual(draft);
    expect(store.getItem).toHaveBeenCalledWith(prefix + DRAFT_KEY);
    expect(readDraft(store, prefix, 'f2')).toBeNull(); // 课程更新了算例：不恢复旧草稿
  });

  it.each([
    ['missing', null],
    ['corrupt', '{oops'],
    ['not an object', '42'],
    ['without snapshot', JSON.stringify({ fingerprint: 'f1', topology: topo('b') })],
    ['with an empty topology', JSON.stringify({ fingerprint: 'f1', snapshot: 's', topology: { nodes: [] } })],
  ])('ignores a %s draft', (_name, value) => {
    expect(readDraft(storage(value), prefix, 'f1')).toBeNull();
  });
});

describe('createEmbedStorage: 预读与 load 的先后', () => {
  it('does not read the draft or draw before the preload resolves', async () => {
    const project = { example: 'ch12' };
    const fingerprint = projectFingerprint(project);
    const prefix = experimentKeyPrefix('ch12-tap-1');
    const saved = { fingerprint, snapshot: 'base', topology: topo('bus-draft') };
    const kernel = fakeKernel({ [prefix + DRAFT_KEY]: JSON.stringify(saved) });
    const release = kernel.hold('ch12-tap-1');
    const { deps } = wire(kernel);
    const embed = createEmbedStorage(deps);

    const applied = embed.applyExperiment(loadOf('ch12-tap-1', project), topo('bus-initial'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.open).toHaveBeenCalledWith(prefix);
    expect(deps.activate).not.toHaveBeenCalled(); // 没换存储、没读参数
    expect(deps.show).not.toHaveBeenCalled(); // 没读草稿、没上画布

    release();
    await applied;
    expect(deps.activate).toHaveBeenCalledTimes(1);
    expect(deps.show).toHaveBeenCalledTimes(1);
    // 先换存储，再按指纹恢复草稿上画布
    expect(deps.activate.mock.invocationCallOrder[0]).toBeLessThan(deps.show.mock.invocationCallOrder[0]);
    expect(deps.show).toHaveBeenCalledWith(loadOf('ch12-tap-1', project), topo('bus-initial'), fingerprint, saved);
  });

  it('draws the initial project when there is no draft for it', async () => {
    const kernel = fakeKernel();
    const { deps } = wire(kernel);
    const embed = createEmbedStorage(deps);
    await embed.applyExperiment(loadOf('ch12-tap-1'), topo('bus-initial'));
    expect(deps.show).toHaveBeenCalledWith(loadOf('ch12-tap-1'), topo('bus-initial'), projectFingerprint({ example: 'ch12' }), null);
  });

  it.each([
    ['the later preload resolves first', ['b', 'a']],
    ['the earlier preload resolves first', ['a', 'b']],
  ])('uses the last load when %s', async (_name, order) => {
    const kernel = fakeKernel();
    const releases: Record<string, () => void> = { a: kernel.hold('exp-a'), b: kernel.hold('exp-b') };
    const { deps, state } = wire(kernel);
    const embed = createEmbedStorage(deps);

    const first = embed.applyExperiment(loadOf('exp-a'), topo('bus-a'));
    const second = embed.applyExperiment(loadOf('exp-b'), topo('bus-b'));
    for (const name of order) {
      releases[name]();
      await vi.advanceTimersByTimeAsync(0);
    }
    await Promise.all([first, second]);

    expect(deps.activate).toHaveBeenCalledTimes(1);
    expect(state.prefix).toBe(experimentKeyPrefix('exp-b'));
    expect(deps.show).toHaveBeenCalledTimes(1);
    expect(deps.show.mock.calls[0][0]).toEqual(loadOf('exp-b'));
    expect(deps.show.mock.calls[0][1]).toEqual(topo('bus-b'));
  });

  it('opens each experiment store once even though the host resends load on every ready', async () => {
    const kernel = fakeKernel();
    const release = kernel.hold('exp-a');
    const { deps } = wire(kernel);
    const embed = createEmbedStorage(deps);

    const first = embed.applyExperiment(loadOf('exp-a', { example: 'v1' }), topo('bus-1'));
    const second = embed.applyExperiment(loadOf('exp-a', { example: 'v2' }), topo('bus-2'));
    release();
    await Promise.all([first, second]);
    await embed.applyExperiment(loadOf('exp-a', { example: 'v3' }), topo('bus-3'));

    expect(deps.open).toHaveBeenCalledTimes(1);
    expect(kernel.fetcher.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(1); // 只预读一次
    expect(deps.show.mock.calls.map((call) => call[1])).toEqual([topo('bus-2'), topo('bus-3')]);
  });
});

describe('createEmbedStorage: 离开页面时的保存', () => {
  async function openExperiment() {
    const kernel = fakeKernel();
    const { deps, state } = wire(kernel, 250);
    const embed = createEmbedStorage(deps);
    // 和 main.ts 一样：先挂离开页面的监听，再打开存储（存储自己也监听同样的事件）
    unbind.push(embed.bindPageLeave(window, document));
    await embed.applyExperiment(loadOf('ch12-tap-1'), topo('bus-1'));
    return { kernel, deps, state, key: experimentKeyPrefix('ch12-tap-1') + DRAFT_KEY };
  }

  const leavePage = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  };

  it('puts the last saveDraft value into a single keepalive request on unload', async () => {
    const { kernel, deps, state, key } = await openExperiment();
    state.canvas = 'v1';
    deps.saveDraft(); // 画布防抖后的正常保存
    await vi.advanceTimersByTimeAsync(250);
    expect(kernel.posts()).toEqual([{ entries: { [key]: 'v1' }, keepalive: false }]);

    state.canvas = 'v2';
    deps.saveDraft(); // 存进了存储，但写入防抖还没到
    state.canvas = 'v3'; // 画布刚改，400 ms 的画布防抖还没触发 saveDraft
    leavePage();
    await vi.advanceTimersByTimeAsync(0);

    const unload = kernel.posts().slice(1);
    expect(unload).toEqual([{ entries: { [key]: 'v3' }, keepalive: true }]); // 一次卸载只发一个写请求
    await vi.advanceTimersByTimeAsync(10_000);
    expect(kernel.posts()).toHaveLength(2); // 之后也不再补发
  });

  it('does not write anything when the page leaves before any experiment is loaded', () => {
    const deps: EmbedStorageDeps = { open: vi.fn(), activate: vi.fn(), show: vi.fn(), saveDraft: vi.fn() };
    const embed = createEmbedStorage(deps);
    unbind.push(embed.bindPageLeave(window, document));
    leavePage();
    expect(deps.saveDraft).not.toHaveBeenCalled();
  });

  it('stops listening after unbinding', async () => {
    const { kernel, deps, state } = await openExperiment();
    for (const off of unbind.splice(0)) off();
    state.canvas = 'v9';
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.saveDraft).not.toHaveBeenCalled();
    expect(kernel.posts()).toHaveLength(0);
  });
});
