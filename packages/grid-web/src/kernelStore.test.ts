// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEEPALIVE_MAX_BYTES, RETRY_DELAYS_MS, openKernelStore, type KernelStore } from './kernelStore';

const ENDPOINT = '../api/grid/store';
const PREFIX = 'slp:grid:exp:ch12-tap-1:';
const k = (name: string) => PREFIX + name;

const okResponse = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ status: 'ok', message: 'store', data }) }) as unknown as Response;

/** 预读返回 entries，之后的写请求默认成功 */
function kernel(entries: Record<string, string> = {}) {
  const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
    init?.method === 'POST' ? okResponse({ written: 0, removed: 0 }) : okResponse({ entries }),
  );
  return fetcher;
}

/** fetcher 收到的写请求：[{entries}, keepalive] */
function posts(fetcher: ReturnType<typeof kernel>): Array<{ entries: Record<string, string | null>; keepalive: boolean }> {
  return fetcher.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => ({ ...(JSON.parse(String(init?.body)) as { entries: Record<string, string | null> }), keepalive: init?.keepalive === true }));
}

type Outcome = number | 'network';

/** 预读成功；之后第 i 个写请求按 outcomes[i] 回（HTTP 状态码，或 'network' 表示连不上），用完一律 200 */
function scripted(outcomes: Outcome[]) {
  let next = 0;
  return vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method !== 'POST') return okResponse({ entries: {} });
    const outcome = outcomes[next++] ?? 200;
    if (outcome === 'network') throw new TypeError('Failed to fetch');
    if (outcome === 200) return okResponse({ written: 1, removed: 0 });
    const code = outcome >= 500 ? 'GRID_INTERNAL' : 'GRID_VALIDATION';
    return {
      ok: false,
      status: outcome,
      json: async () => ({ status: 'error', code, message: `HTTP ${outcome}`, data: null }),
    } as unknown as Response;
  });
}

let warn: ReturnType<typeof vi.spyOn>;
// 每个测试打开的存储：收尾时摘掉它们挂在共享 jsdom window 上的 pagehide / visibilitychange 监听
const opened: KernelStore[] = [];

async function open(...args: Parameters<typeof openKernelStore>): Promise<KernelStore> {
  const store = await openKernelStore(...args);
  opened.push(store);
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const store of opened.splice(0)) store.dispose();
  vi.useRealTimers();
  warn.mockRestore();
});

describe('openKernelStore: 预读与同步读写', () => {
  it('preloads the experiment prefix and reads synchronously from memory', async () => {
    const fetcher = kernel({ [k('embed-draft-v2')]: '{"a":1}', 'slp:grid:exp:other:x': 'leak' });
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${ENDPOINT}?prefix=${encodeURIComponent(PREFIX)}`);
    expect(store.persistent).toBe(true);
    expect(store.getItem(k('embed-draft-v2'))).toBe('{"a":1}');
    expect(store.getItem('slp:grid:exp:other:x')).toBeNull(); // 别的实验的条目不收
    expect(store.getItem(k('missing'))).toBeNull();

    store.setItem(k('analysis-v1'), 'opf');
    expect(store.getItem(k('analysis-v1'))).toBe('opf'); // 写完立刻能读，不等内核
    expect(posts(fetcher)).toHaveLength(0);
  });

  it('only accepts keys under its own prefix', async () => {
    const store = await open(ENDPOINT, PREFIX, { fetcher: kernel() });
    expect(() => store.setItem('slp:grid:exp:other:draft', 'x')).toThrow();
    expect(() => store.removeItem('slp:grid:draft-v1')).toThrow();
    expect(store.getItem('slp:grid:exp:other:draft')).toBeNull();
  });
});

describe('openKernelStore: 写入', () => {
  it('debounces changes into one batch with the latest values', async () => {
    const fetcher = kernel();
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    await vi.advanceTimersByTimeAsync(200);
    store.setItem(k('b'), '2');
    store.setItem(k('a'), '3');
    await vi.advanceTimersByTimeAsync(200);
    expect(posts(fetcher)).toHaveLength(0); // 每次修改都重新计时
    await vi.advanceTimersByTimeAsync(60);
    expect(posts(fetcher)).toEqual([{ entries: { [k('a')]: '3', [k('b')]: '2' }, keepalive: false }]);
    expect(String(fetcher.mock.calls[1][0])).toBe(ENDPOINT);
  });

  it('skips writes that change nothing', async () => {
    const fetcher = kernel({ [k('a')]: '1' });
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    store.setItem(k('a'), '1');
    store.removeItem(k('never-written'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts(fetcher)).toHaveLength(0);
  });

  it('sends null for removed keys', async () => {
    const fetcher = kernel({ [k('embed-draft-v2')]: 'old' });
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    store.removeItem(k('embed-draft-v2'));
    expect(store.getItem(k('embed-draft-v2'))).toBeNull();
    await store.flush();
    expect(posts(fetcher)).toEqual([{ entries: { [k('embed-draft-v2')]: null }, keepalive: false }]);
  });

  it('keeps one write in flight and queues later changes behind it, preserving order', async () => {
    let release: (() => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== 'POST') return okResponse({ entries: {} });
      if (!release) await new Promise<void>((resolve) => (release = resolve)); // 第一批挂住
      return okResponse({ written: 1, removed: 0 });
    });
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });

    store.setItem(k('a'), '1');
    await vi.advanceTimersByTimeAsync(250);
    expect(posts(fetcher)).toHaveLength(1);

    store.setItem(k('a'), '2');
    store.setItem(k('b'), 'x');
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts(fetcher)).toHaveLength(1); // 前一批没回来，不发第二批

    release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher)).toEqual([
      { entries: { [k('a')]: '1' }, keepalive: false },
      { entries: { [k('a')]: '2', [k('b')]: 'x' }, keepalive: false },
    ]);
  });

  it('flush() sends immediately and waits for the write in flight first', async () => {
    let release: (() => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== 'POST') return okResponse({ entries: {} });
      if (!release) await new Promise<void>((resolve) => (release = resolve));
      return okResponse({ written: 1, removed: 0 });
    });
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 10_000 });
    store.setItem(k('a'), '1');
    const first = store.flush(); // 不等防抖
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher)).toHaveLength(1);

    store.setItem(k('a'), '2');
    let secondDone = false;
    const second = store.flush().then(() => (secondDone = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher)).toHaveLength(1);
    expect(secondDone).toBe(false);

    release?.();
    await Promise.all([first, second]);
    expect(posts(fetcher).map((p) => p.entries)).toEqual([{ [k('a')]: '1' }, { [k('a')]: '2' }]);
  });

  it('does not throw to the page when a write fails', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== 'POST') return okResponse({ entries: {} });
      throw new TypeError('Failed to fetch');
    });
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    store.setItem(k('a'), '1');
    await expect(store.flush()).resolves.toBeUndefined();
    // 422（比如存储已满）同样只记一笔
    fetcher.mockImplementation(async () =>
      ({ ok: false, status: 422, json: async () => ({ status: 'error', code: 'GRID_VALIDATION', message: '存储已满', data: null }) }) as unknown as Response,
    );
    store.setItem(k('a'), '2');
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.getItem(k('a'))).toBe('2');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('openKernelStore: 页面关闭', () => {
  it('flushes with keepalive when the body is small enough', async () => {
    const fetcher = kernel();
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    store.setItem(k('embed-draft-v2'), 'x'.repeat(1000));
    await store.flush({ keepalive: true });
    expect(posts(fetcher).map((p) => p.keepalive)).toEqual([true]);
  });

  it('falls back to a normal request above the keepalive limit, measured in UTF-8 bytes', async () => {
    const fetcher = kernel();
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    // 2.5 万个汉字：JS 长度 2.5 万，UTF-8 是 7.5 万字节，超过 60 KB
    const chinese = '中'.repeat(25_000);
    expect(chinese.length).toBeLessThan(KEEPALIVE_MAX_BYTES);
    store.setItem(k('embed-draft-v2'), chinese);
    await store.flush({ keepalive: true });
    expect(posts(fetcher).map((p) => p.keepalive)).toEqual([false]);
    expect(posts(fetcher)[0].entries[k('embed-draft-v2')]).toBe(chinese);
  });

  it('does not send anything when nothing changed', async () => {
    const fetcher = kernel({ [k('a')]: '1' });
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    await store.flush({ keepalive: true });
    await store.flush();
    expect(posts(fetcher)).toHaveLength(0);
  });

  it('flushes on pagehide and when the page becomes hidden', async () => {
    const fetcher = kernel();
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 10_000 });
    store.setItem(k('a'), '1');
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher)).toEqual([{ entries: { [k('a')]: '1' }, keepalive: true }]);

    store.setItem(k('a'), '2');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher)[1]).toEqual({ entries: { [k('a')]: '2' }, keepalive: true });
    // 防抖计时已被 flush 取消，不会再发一次
    await vi.advanceTimersByTimeAsync(20_000);
    expect(posts(fetcher)).toHaveLength(2);
  });
});

describe('openKernelStore: 内核没有存储（旧版本 / 没起来）', () => {
  const failures: Array<[string, () => Promise<Response>]> = [
    ['an old kernel without the route', async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('not json'); } }) as unknown as Response],
    ['a network error', async () => { throw new TypeError('Failed to fetch'); }],
    ['an error envelope', async () => ({ ok: false, status: 500, json: async () => ({ status: 'error', code: 'GRID_INTERNAL', message: 'boom', data: null }) }) as unknown as Response],
    ['an ok envelope without entries', async () => okResponse(null)],
  ];

  it.each(failures)('falls back to memory on %s and warns once', async (_name, respond) => {
    const fetcher = vi.fn<typeof fetch>(respond);
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    expect(store.persistent).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    store.setItem(k('a'), '1'); // 页面照常能用
    expect(store.getItem(k('a'))).toBe('1');
    store.removeItem(k('a'));
    expect(store.getItem(k('a'))).toBeNull();
    store.setItem(k('b'), '2');
    await vi.advanceTimersByTimeAsync(1000);
    await store.flush({ keepalive: true });
    await store.flush();
    expect(fetcher).toHaveBeenCalledTimes(1); // 只有那次预读
    expect(warn).toHaveBeenCalledTimes(1);
    expect(() => store.setItem('slp:grid:exp:other:a', 'x')).toThrow(); // 前缀校验照旧
  });
});

describe('openKernelStore: 发送前的文本规范化', () => {
  it('replaces lone surrogates so the kernel does not reject the whole batch', async () => {
    const fetcher = kernel();
    const store = await open(ENDPOINT, PREFIX, { fetcher });
    store.setItem(k('a'), 'x\uD83Dy'); // 被截断的 emoji：只剩高位代理
    store.setItem(k('b'), '完整 😀');
    store.removeItem(k('b'));
    store.setItem(k('c'), '完整 😀');
    await store.flush();
    const body = String(fetcher.mock.calls[1][1]?.body);
    expect(body.toLowerCase()).not.toContain('\\ud83d'); // 不再有编不成 UTF-8 的转义
    expect(posts(fetcher)[0].entries).toEqual({ [k('a')]: 'x�y', [k('b')]: null, [k('c')]: '完整 😀' });
    expect(store.getItem(k('a'))).toBe('x\uD83Dy'); // 页面自己读到的仍是原值
  });
});

describe('openKernelStore: 写入失败与重试', () => {
  it('retries after a 502 and the retry carries the latest value', async () => {
    const fetcher = scripted([502]);
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    store.setItem(k('b'), 'keep');
    await vi.advanceTimersByTimeAsync(250);
    expect(posts(fetcher)).toHaveLength(1); // 502
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] - 1);
    expect(posts(fetcher)).toHaveLength(1); // 退避期间不发
    await vi.advanceTimersByTimeAsync(1);
    expect(posts(fetcher)).toEqual([
      { entries: { [k('a')]: '1', [k('b')]: 'keep' }, keepalive: false },
      { entries: { [k('a')]: '1', [k('b')]: 'keep' }, keepalive: false },
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts(fetcher)).toHaveLength(2); // 成功之后不再发
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a change during the backoff goes out after the normal debounce, carrying the requeued keys', async () => {
    const fetcher = scripted([502]);
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    store.setItem(k('b'), 'keep');
    await vi.advanceTimersByTimeAsync(250);
    expect(posts(fetcher)).toHaveLength(1); // 502

    store.setItem(k('a'), '2'); // 等重试期间又改了：照常 250 ms 后发，不被退避压住（与 lab 一致）
    await vi.advanceTimersByTimeAsync(249);
    expect(posts(fetcher)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(posts(fetcher)).toEqual([
      { entries: { [k('a')]: '1', [k('b')]: 'keep' }, keepalive: false },
      { entries: { [k('a')]: '2', [k('b')]: 'keep' }, keepalive: false },
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts(fetcher)).toHaveLength(2); // 成功之后不再发
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('backs off 1 s, 2 s, 4 s on network errors and 5xx, then keeps the keys pending for the next write', async () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
    const fetcher = scripted([503, 'network', 500, 'network']);
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    await vi.advanceTimersByTimeAsync(250);
    expect(posts(fetcher)).toHaveLength(1);
    for (const [i, delay] of RETRY_DELAYS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(posts(fetcher)).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(posts(fetcher)).toHaveLength(i + 2);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts(fetcher)).toHaveLength(4); // 首发 + 3 次重试，之后不再自动重试
    expect(posts(fetcher).every((p) => p.entries[k('a')] === '1')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1); // 只提示一次，不抛到界面
    expect(store.getItem(k('a'))).toBe('1');

    // 键没丢：下一次修改把它一起带出去（与 lab 一致）
    store.setItem(k('b'), '2');
    await vi.advanceTimersByTimeAsync(250);
    expect(posts(fetcher)[4]).toEqual({ entries: { [k('a')]: '1', [k('b')]: '2' }, keepalive: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts(fetcher)).toHaveLength(5);
  });

  it('a debounce that fired while a write was in flight waits for the backoff when that write fails', async () => {
    let release: ((ok: boolean) => void) | undefined;
    let first = true;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== 'POST') return okResponse({ entries: {} });
      if (first) {
        first = false;
        const ok = await new Promise<boolean>((resolve) => (release = resolve)); // 第一批挂住，之后按 502 回
        if (!ok) return { ok: false, status: 502, json: async () => ({ status: 'error', code: 'GRID_INTERNAL', message: 'HTTP 502', data: null }) } as unknown as Response;
      }
      return okResponse({ written: 1, removed: 0 });
    });
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    await vi.advanceTimersByTimeAsync(250); // 第一批发出，挂着
    store.setItem(k('b'), '2');
    await vi.advanceTimersByTimeAsync(250); // 防抖到点，排在在途请求后面
    expect(posts(fetcher)).toHaveLength(1);

    release?.(false); // 在途那批 502
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher)).toHaveLength(1); // 不是 0 ms 就重发
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(posts(fetcher)).toEqual([
      { entries: { [k('a')]: '1' }, keepalive: false },
      { entries: { [k('a')]: '1', [k('b')]: '2' }, keepalive: false },
    ]);
  });

  it('does not retry 4xx (storage full, invalid key) and drops that batch', async () => {
    const fetcher = scripted([422, 413]);
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), 'too big');
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts(fetcher)).toHaveLength(1);

    store.setItem(k('b'), 'x');
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts(fetcher).map((p) => p.entries)).toEqual([{ [k('a')]: 'too big' }, { [k('b')]: 'x' }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('flush() resolves after one attempt instead of waiting through the backoff', async () => {
    const fetcher = scripted(['network']);
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 10_000 });
    store.setItem(k('a'), '1');
    await expect(store.flush()).resolves.toBeUndefined();
    expect(posts(fetcher)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(posts(fetcher).map((p) => p.entries)).toEqual([{ [k('a')]: '1' }, { [k('a')]: '1' }]);
  });

  it('retries a failed keepalive flush with a normal request if the page is still alive', async () => {
    const fetcher = scripted(['network']);
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 10_000 });
    store.setItem(k('a'), '1');
    await store.flush({ keepalive: true });
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(posts(fetcher)).toEqual([
      { entries: { [k('a')]: '1' }, keepalive: true },
      { entries: { [k('a')]: '1' }, keepalive: false },
    ]);
  });
});

describe('openKernelStore: 页面关闭时有写请求在路上', () => {
  /** 第一个写请求挂住，直到调用 release()；之后的写请求立即成功 */
  function holdFirstWrite() {
    let release: (() => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== 'POST') return okResponse({ entries: {} });
      if (!release) await new Promise<void>((resolve) => (release = resolve));
      return okResponse({ written: 1, removed: 0 });
    });
    return { fetcher, release: () => release?.() };
  }

  it('sends the keepalive batch right away, then rewrites it after the earlier write returns', async () => {
    const { fetcher, release } = holdFirstWrite();
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    await vi.advanceTimersByTimeAsync(250); // 第一批在路上

    store.setItem(k('a'), '2');
    store.setItem(k('b'), 'x');
    await store.flush({ keepalive: true }); // 页面可能马上没了：不等前一批
    expect(posts(fetcher)).toEqual([
      { entries: { [k('a')]: '1' }, keepalive: false },
      { entries: { [k('a')]: '2', [k('b')]: 'x' }, keepalive: true },
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(posts(fetcher)).toHaveLength(2); // 前一批没回来之前不补写

    // 内核可能先写了 keepalive 这批、后写前一批的旧值 a=1：前一批回来后按正常防抖再写一次
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(posts(fetcher)[2]).toEqual({ entries: { [k('a')]: '2', [k('b')]: 'x' }, keepalive: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(posts(fetcher)).toHaveLength(3);
  });

  it('keys changed after the keepalive flush go out with their newest value', async () => {
    const { fetcher, release } = holdFirstWrite();
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    await vi.advanceTimersByTimeAsync(250);
    store.setItem(k('a'), '2');
    store.setItem(k('b'), 'x');
    await store.flush({ keepalive: true });

    store.setItem(k('b'), 'y'); // 页面其实还活着（只是被藏到后台又切回来），又改了 b
    await vi.advanceTimersByTimeAsync(10_000);
    expect(posts(fetcher)).toHaveLength(2); // 仍然等前一批回来

    release();
    await vi.advanceTimersByTimeAsync(10_000);
    const sent = posts(fetcher);
    expect(sent[sent.length - 1]).toEqual({ entries: { [k('a')]: '2', [k('b')]: 'y' }, keepalive: false });
    // 按发出的先后合并：每个键最后一次写入都是最新值
    const finalValues: Record<string, string | null> = {};
    for (const p of sent) Object.assign(finalValues, p.entries);
    expect(finalValues).toEqual({ [k('a')]: '2', [k('b')]: 'y' });
  });

  it('later writes wait for a keepalive request that is still in flight', async () => {
    let releaseKeepalive: (() => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== 'POST') return okResponse({ entries: {} });
      if (init.keepalive) await new Promise<void>((resolve) => (releaseKeepalive = resolve));
      return okResponse({ written: 1, removed: 0 });
    });
    const store = await open(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    void store.flush({ keepalive: true }); // 页面被藏到后台
    await vi.advanceTimersByTimeAsync(0);
    store.setItem(k('a'), '2'); // 又切回来改了
    await vi.advanceTimersByTimeAsync(5_000);
    expect(posts(fetcher)).toHaveLength(1); // 不和 keepalive 那批抢先后

    releaseKeepalive?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher).map((p) => p.entries)).toEqual([{ [k('a')]: '1' }, { [k('a')]: '2' }]);
  });
});

describe('openKernelStore: dispose', () => {
  it('removes its page listeners and clears pending timers', async () => {
    const fetcher = kernel();
    const store = await openKernelStore(ENDPOINT, PREFIX, { fetcher, debounceMs: 250 });
    store.setItem(k('a'), '1');
    store.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(posts(fetcher)).toHaveLength(0);
    expect(store.getItem(k('a'))).toBe('1');
  });
});
