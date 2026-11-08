import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KEEPALIVE_MAX_BYTES, openKernelStore, type KernelStore } from './kernelStore'

const ENDPOINT = '../api/lab/store'
const PREFIX = 'slp:lab:exp:lab-1:'

type Entries = Record<string, string | null>
type Post = { entries: Entries; keepalive: boolean }

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  } as Response
}

const okEnvelope = (data: unknown) => response(200, { status: 'ok', message: '', data })
// 内核 store 接口出错时 data 为 null（与 grid 一致）
const errorEnvelope = (status: number, message = 'x') =>
  response(status, { status: 'error', code: status >= 500 ? 'LAB_INTERNAL' : 'LAB_VALIDATION', message, data: null })

/**
 * 假内核：GET 回预读的条目，POST 记下每一批。postReply 决定每次 POST 怎么回（默认马上 200）
 */
function fakeKernel(initial: Record<string, unknown> = {}) {
  const posts: Post[] = []
  const bodies: string[] = []
  let postReply: (post: Post) => Promise<Response> = () => Promise.resolve(okEnvelope({ written: 1, removed: 0 }))
  const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!init?.method) return Promise.resolve(okEnvelope({ entries: initial }))
    bodies.push(String(init.body))
    const body = JSON.parse(String(init.body)) as { entries: Entries }
    const post = { entries: body.entries, keepalive: Boolean(init.keepalive) }
    posts.push(post)
    return postReply(post)
  })
  return {
    fetcher,
    posts,
    bodies,
    reply(next: (post: Post) => Promise<Response>) {
      postReply = next
    },
  }
}

let warn: ReturnType<typeof vi.spyOn>
let open: KernelStore[] = []

async function openStore(kernel: ReturnType<typeof fakeKernel>, debounceMs?: number) {
  const store = await openKernelStore(ENDPOINT, PREFIX, { fetcher: kernel.fetcher as typeof fetch, debounceMs })
  open.push(store)
  return store
}

beforeEach(() => {
  vi.useFakeTimers()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const store of open) store.dispose()
  open = []
  vi.useRealTimers()
  warn.mockRestore()
})

describe('openKernelStore：预读与同步读写', () => {
  it('打开时按实验前缀预读一次，之后读写都是同步的、走内存', async () => {
    const kernel = fakeKernel({
      [`${PREFIX}draft-v1`]: '{"fingerprint":"f1"}',
      [`${PREFIX}last-case`]: 'case-1-1',
      'slp:lab:exp:other:draft-v1': '别的实验',   // 内核回多了也不收
      [`${PREFIX}broken`]: 42,                     // 不是字符串的值不收
    })
    const store = await openStore(kernel)

    expect(kernel.fetcher).toHaveBeenCalledTimes(1)
    expect(kernel.fetcher.mock.calls[0][0]).toBe(`${ENDPOINT}?prefix=${encodeURIComponent(PREFIX)}`)
    expect(store.persistent).toBe(true)
    expect(store.getItem(`${PREFIX}draft-v1`)).toBe('{"fingerprint":"f1"}')
    expect(store.getItem(`${PREFIX}last-case`)).toBe('case-1-1')
    expect(store.getItem('slp:lab:exp:other:draft-v1')).toBeNull()
    expect(store.getItem(`${PREFIX}broken`)).toBeNull()

    store.setItem(`${PREFIX}last-case`, 'case-2-3')
    expect(store.getItem(`${PREFIX}last-case`)).toBe('case-2-3')
    store.removeItem(`${PREFIX}draft-v1`)
    expect(store.getItem(`${PREFIX}draft-v1`)).toBeNull()
    expect(kernel.fetcher).toHaveBeenCalledTimes(1)   // 读写都没有再碰网络（写入还在防抖里）
  })

  it('只接受本实验前缀下的键，防止串到别的实验', async () => {
    const store = await openStore(fakeKernel())
    expect(() => store.setItem('slp:lab:exp:other:draft-v1', 'x')).toThrow('不属于这个实验')
    expect(() => store.removeItem('slp:lab:exp:other:draft-v1')).toThrow('不属于这个实验')
    expect(() => store.setItem('slp:lab:last-case', 'x')).toThrow()
  })
})

describe('openKernelStore：写入', () => {
  it('防抖合并：一段时间内的改动攒成一批，同一个键只发最后的值', async () => {
    const kernel = fakeKernel({ [`${PREFIX}old`]: 'x' })
    const store = await openStore(kernel)
    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(200)
    store.setItem(`${PREFIX}a`, '2')
    store.setItem(`${PREFIX}b`, '中文')
    await vi.advanceTimersByTimeAsync(249)
    expect(kernel.posts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(kernel.posts).toEqual([{ entries: { [`${PREFIX}a`]: '2', [`${PREFIX}b`]: '中文' }, keepalive: false }])

    // 值没变、删不存在的键：内存就是内核的镜像，不必发
    store.setItem(`${PREFIX}a`, '2')
    store.removeItem(`${PREFIX}never`)
    await vi.advanceTimersByTimeAsync(1000)
    expect(kernel.posts).toHaveLength(1)
  })

  it('删除发 null', async () => {
    const kernel = fakeKernel({ [`${PREFIX}draft-v1`]: 'd' })
    const store = await openStore(kernel)
    store.removeItem(`${PREFIX}draft-v1`)
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts).toEqual([{ entries: { [`${PREFIX}draft-v1`]: null }, keepalive: false }])
  })

  it('同一时刻只有一个写请求在路上；在路上时的新改动排到下一批，同一个键按先后落盘', async () => {
    const kernel = fakeKernel()
    const pending: ((value: Response) => void)[] = []
    kernel.reply(() => new Promise((resolve) => pending.push(resolve)))
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts).toHaveLength(1)

    store.setItem(`${PREFIX}a`, '2')
    store.setItem(`${PREFIX}b`, 'x')
    await vi.advanceTimersByTimeAsync(1000)
    expect(kernel.posts).toHaveLength(1)   // 第一批还没回来，第二批等着

    const flushed = store.flush()
    pending.shift()?.(okEnvelope({}))
    await vi.advanceTimersByTimeAsync(0)
    expect(kernel.posts.map((post) => post.entries)).toEqual([
      { [`${PREFIX}a`]: '1' },
      { [`${PREFIX}a`]: '2', [`${PREFIX}b`]: 'x' },
    ])
    pending.shift()?.(okEnvelope({}))
    await flushed
    expect(kernel.posts).toHaveLength(2)
  })

  it('flush 立即发出；keepalive 时请求体不超过 60 KB 才用 keepalive，超了退回普通请求', async () => {
    const kernel = fakeKernel()
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, 'small')
    await store.flush()
    expect(kernel.posts[0]).toEqual({ entries: { [`${PREFIX}a`]: 'small' }, keepalive: false })

    store.setItem(`${PREFIX}a`, 'still small')
    await store.flush({ keepalive: true })
    expect(kernel.posts[1].keepalive).toBe(true)

    store.setItem(`${PREFIX}a`, 'x'.repeat(KEEPALIVE_MAX_BYTES))
    await store.flush({ keepalive: true })
    expect(kernel.posts[2].keepalive).toBe(false)
    expect(kernel.posts[2].entries[`${PREFIX}a`]).toHaveLength(KEEPALIVE_MAX_BYTES)

    await store.flush({ keepalive: true })   // 没有改动就不发
    expect(kernel.posts).toHaveLength(3)
  })

  it('页面被卸掉（pagehide）或藏到后台时自己 keepalive 发出去；close 之后不再监听', async () => {
    const kernel = fakeKernel()
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(kernel.posts).toEqual([{ entries: { [`${PREFIX}a`]: '1' }, keepalive: true }])

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    store.setItem(`${PREFIX}a`, '2')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(kernel.posts[1]).toEqual({ entries: { [`${PREFIX}a`]: '2' }, keepalive: true })
    visibility.mockRestore()

    await store.close()
    store.setItem(`${PREFIX}a`, '3')   // close 之后的改动不再自动发（关的时候已经 flush 过）
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(kernel.posts).toHaveLength(2)
  })
})

describe('openKernelStore：失败时页面照常能用', () => {
  const failures: [string, () => Promise<Response>][] = [
    ['网络错误', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['旧内核没有 store 接口（404 页面）', () => Promise.resolve(response(404, new SyntaxError('Unexpected token')))],
    ['封套不是 ok', () => Promise.resolve(response(200, { status: 'error', code: 'LAB_INTERNAL', message: 'x', data: null }))],
    ['封套里没有 entries', () => Promise.resolve(okEnvelope({}))],
  ]

  it.each(failures)('预读失败（%s）就退回纯内存：读写照常，只 warn 一次，不往内核写', async (_name, reply) => {
    const fetcher = vi.fn(reply)
    const store = await openKernelStore(ENDPOINT, PREFIX, { fetcher: fetcher as unknown as typeof fetch })
    open.push(store)

    expect(store.persistent).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    store.setItem(`${PREFIX}draft-v1`, 'd')
    expect(store.getItem(`${PREFIX}draft-v1`)).toBe('d')
    store.removeItem(`${PREFIX}draft-v1`)
    expect(store.getItem(`${PREFIX}draft-v1`)).toBeNull()
    expect(() => store.setItem('slp:lab:exp:other:x', '1')).toThrow()
    await vi.advanceTimersByTimeAsync(1000)
    await store.flush({ keepalive: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('写入失败不抛到界面：连不上就留着，下次 flush 再发；内核拒收（4xx）就不再重发', async () => {
    const kernel = fakeKernel()
    const store = await openStore(kernel)

    kernel.reply(() => Promise.reject(new TypeError('Failed to fetch')))
    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(250)
    await expect(store.flush()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)

    kernel.reply(() => Promise.resolve(okEnvelope({})))
    await store.flush()
    expect(kernel.posts[kernel.posts.length - 1]).toEqual({ entries: { [`${PREFIX}a`]: '1' }, keepalive: false })
    const sent = kernel.posts.length

    kernel.reply(() => Promise.resolve(errorEnvelope(422, '存储已满')))
    store.setItem(`${PREFIX}b`, '2')
    await store.flush()
    expect(kernel.posts).toHaveLength(sent + 1)
    await store.flush()
    expect(kernel.posts).toHaveLength(sent + 1)
    expect(store.getItem(`${PREFIX}b`)).toBe('2')   // 内存里照旧
    expect(warn).toHaveBeenCalledTimes(1)          // 只 warn 一次，不刷屏
  })
})

describe('openKernelStore：发送前规范成合法文本', () => {
  it('孤立的代理字符换成 U+FFFD 再发（否则内核判整批非法 422）；内存里的原值不动', async () => {
    const kernel = fakeKernel()
    const store = await openStore(kernel)
    store.setItem(`${PREFIX}a`, 'x\uD800y')
    store.setItem(`${PREFIX}b`, '完整的 emoji 😀')
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts).toEqual([{ entries: { [`${PREFIX}a`]: 'x�y', [`${PREFIX}b`]: '完整的 emoji 😀' }, keepalive: false }])
    expect(kernel.bodies[0]).not.toMatch(/\\ud800/i)
    expect(store.getItem(`${PREFIX}a`)).toBe('x\uD800y')
  })
})

describe('openKernelStore：写入失败后的重试', () => {
  it('第一次 POST 502、第二次成功：退避 1 s 自动重试，最终写入的是最新值', async () => {
    const kernel = fakeKernel()
    const pending: ((value: Response) => void)[] = []
    kernel.reply(() => new Promise((resolve) => pending.push(resolve)))
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts).toHaveLength(1)
    store.setItem(`${PREFIX}a`, '2')          // 第一次还在路上时又改了
    await vi.advanceTimersByTimeAsync(300)    // 防抖到点时第一次还没回来：不另发
    expect(kernel.posts).toHaveLength(1)

    kernel.reply(() => Promise.resolve(okEnvelope({ written: 1, removed: 0 })))
    pending.shift()?.(errorEnvelope(502))
    await vi.advanceTimersByTimeAsync(999)
    expect(kernel.posts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(kernel.posts.map((post) => post.entries)).toEqual([{ [`${PREFIX}a`]: '1' }, { [`${PREFIX}a`]: '2' }])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(kernel.posts).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  const outages: [string, () => Promise<Response>][] = [
    ['内核 502', () => Promise.resolve(errorEnvelope(502))],
    ['内核 500', () => Promise.resolve(errorEnvelope(500))],
    ['网络错误', () => Promise.reject(new TypeError('Failed to fetch'))],
  ]

  it.each(outages)('%s 一直不好：按 1 s、2 s、4 s 自动重试 3 次就停，只 warn 一次；下次改动连同没发出去的一起再试', async (_name, outage) => {
    const kernel = fakeKernel()
    kernel.reply(outage)
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts).toHaveLength(1)
    for (const [delay, total] of [[1000, 2], [2000, 3], [4000, 4]]) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(kernel.posts).toHaveLength(total - 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(kernel.posts).toHaveLength(total)
    }
    await vi.advanceTimersByTimeAsync(60_000)
    expect(kernel.posts).toHaveLength(4)
    expect(kernel.posts.every((post) => post.entries[`${PREFIX}a`] === '1')).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)

    // 不再自动重试，但没发出去的键还留着：下次改动时一起发；成功一次就清零，之后再出错又能重试 3 次
    kernel.reply(() => Promise.resolve(okEnvelope({ written: 2, removed: 0 })))
    store.setItem(`${PREFIX}b`, '2')
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts[4].entries).toEqual({ [`${PREFIX}a`]: '1', [`${PREFIX}b`]: '2' })

    kernel.reply(outage)
    store.setItem(`${PREFIX}b`, '3')
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts).toHaveLength(6)
    await vi.advanceTimersByTimeAsync(1000)
    expect(kernel.posts).toHaveLength(7)
    expect(kernel.posts[6].entries).toEqual({ [`${PREFIX}b`]: '3' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it.each([400, 413, 422])('内核拒收（%i）不重试：丢掉这批只 warn，不放回待发', async (status) => {
    const kernel = fakeKernel()
    kernel.reply(() => Promise.resolve(errorEnvelope(status)))
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    await store.flush()
    await store.flush({ keepalive: true })
    expect(kernel.posts).toHaveLength(1)
    expect(store.getItem(`${PREFIX}a`)).toBe('1')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('openKernelStore：keepalive 时有请求在路上', () => {
  /** 普通写入挂着、由测试决定什么时候回；keepalive 的马上回 200 */
  function holdNormalPosts(kernel: ReturnType<typeof fakeKernel>) {
    const pending: ((value: Response) => void)[] = []
    kernel.reply((post) => (post.keepalive
      ? Promise.resolve(okEnvelope({ written: 1, removed: 0 }))
      : new Promise((resolve) => pending.push(resolve))))
    return () => pending.shift()?.(okEnvelope({ written: 1, removed: 0 }))
  }

  it('这批照发；在路上的那次回来后，这批里没再改过的键按防抖补写一次，内核最终是最新值', async () => {
    const kernel = fakeKernel()
    const answer = holdNormalPosts(kernel)
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    store.setItem(`${PREFIX}b`, 'x')
    await vi.advanceTimersByTimeAsync(250)
    expect(kernel.posts).toHaveLength(1)        // 第一批在路上

    store.setItem(`${PREFIX}a`, '2')
    await store.flush({ keepalive: true })      // 页面可能马上就没了：不等，照发
    expect(kernel.posts[1]).toEqual({ entries: { [`${PREFIX}a`]: '2' }, keepalive: true })

    answer()   // 在路上的那次（a=1）回来了：它可能比 keepalive 那批后落盘，把 a 盖回 1
    await vi.advanceTimersByTimeAsync(249)
    expect(kernel.posts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(kernel.posts[2]).toEqual({ entries: { [`${PREFIX}a`]: '2' }, keepalive: false })
    answer()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(kernel.posts).toHaveLength(3)
  })

  it('keepalive 之后又改过的键不补写旧值：照常带着新值发一次', async () => {
    const kernel = fakeKernel()
    const answer = holdNormalPosts(kernel)
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(250)
    store.setItem(`${PREFIX}a`, '2')
    await store.flush({ keepalive: true })
    store.setItem(`${PREFIX}a`, '3')            // 页面没被卸掉（比如只是切到后台又切回来），接着改

    answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(kernel.posts.map((post) => post.entries[`${PREFIX}a`])).toEqual(['1', '2', '3'])
    answer()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(kernel.posts).toHaveLength(3)
  })

  it('keepalive 那批还没回来时，普通写入等它回来再发：同一个键的旧值不会后到', async () => {
    const kernel = fakeKernel()
    const normal: ((value: Response) => void)[] = []
    const keepalive: ((value: Response) => void)[] = []
    kernel.reply((post) => new Promise((resolve) => (post.keepalive ? keepalive : normal).push(resolve)))
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(250)
    store.setItem(`${PREFIX}a`, '2')
    void store.flush({ keepalive: true })
    store.setItem(`${PREFIX}a`, '3')
    expect(kernel.posts).toHaveLength(2)

    normal.shift()?.(okEnvelope({}))
    await vi.advanceTimersByTimeAsync(1000)
    expect(kernel.posts).toHaveLength(2)        // keepalive 那批（a=2）还在路上：a=3 等着

    keepalive.shift()?.(okEnvelope({}))
    await vi.advanceTimersByTimeAsync(0)
    expect(kernel.posts[2]).toEqual({ entries: { [`${PREFIX}a`]: '3' }, keepalive: false })
    normal.shift()?.(okEnvelope({}))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(kernel.posts).toHaveLength(3)
  })
})

describe('openKernelStore：dispose', () => {
  it('摘掉监听、清掉防抖和重试的定时器，之后不再自动发；显式 flush 仍会发', async () => {
    const kernel = fakeKernel()
    kernel.reply(() => Promise.resolve(errorEnvelope(503)))
    const store = await openStore(kernel)

    store.setItem(`${PREFIX}a`, '1')
    await vi.advanceTimersByTimeAsync(250)      // 失败，1 s 后的重试已经排上
    store.setItem(`${PREFIX}b`, '2')            // 防抖也排上了
    store.dispose()

    await vi.advanceTimersByTimeAsync(60_000)
    window.dispatchEvent(new Event('pagehide'))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    visibility.mockRestore()
    store.setItem(`${PREFIX}c`, '3')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(kernel.posts).toHaveLength(1)
    expect(store.getItem(`${PREFIX}c`)).toBe('3')   // 内存里照常读写

    kernel.reply(() => Promise.resolve(okEnvelope({ written: 3, removed: 0 })))
    await store.flush()
    expect(kernel.posts[1].entries).toEqual({ [`${PREFIX}a`]: '1', [`${PREFIX}b`]: '2', [`${PREFIX}c`]: '3' })
  })
})
