import type { SimulationRequestPayload, SimulationResponse } from '@/types/circuit'
import { API_BASE_URL, simulationApiOptions } from './apiBase'

/** 单次请求等太久。和网络错误分开：内核没停，重发只会让它把同一个重活再排队算一遍 */
class SimulationTimeoutError extends Error {}

// 等待上限：新电路第一次瞬态要现场生成并编译方程代码（MTK 的 RuntimeGeneratedFunctions 烤不进镜像），
// 学生的慢电脑上可能要几十秒。嵌入知帆时放宽到分钟级（约定 §3：一次请求最长 30 分钟）。
const TIMEOUT_MS = { dev: 120_000, embedded: 600_000 }

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeout: number }) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(new SimulationTimeoutError()), init.timeout)
  // 超时信号与调用方的取消信号合并——此前调用方 signal 被覆盖，取消按钮从未生效
  const signals = init.signal ? [controller.signal, init.signal] : [controller.signal]
  try {
    return await fetch(input, { ...init, signal: AbortSignal.any(signals) })
  } catch (err) {
    if (controller.signal.aborted) throw controller.signal.reason
    throw err
  } finally {
    clearTimeout(id)
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

let currentController: AbortController | null = null

/**
 * 新一次「运行」开始：取消上一次还没回来的请求。这一次的所有请求（多开关电路每个组合各发一个，同时在途）
 * 共用一个控制器——以前每个请求一发就把前一个取消掉，多开关时除最后一个外全被自己人打断再重发。
 */
export function beginSimulationRun() {
  if (currentController) {
    try { currentController.abort() } catch (abortError) { void abortError }
  }
  currentController = new AbortController()
}

function hashPayload(payload: SimulationRequestPayload): string {
  const key = payload.kind === 'control'
    ? JSON.stringify({
        kind: payload.kind,
        blocks: payload.blocks.map((block) => ({
          id: block.id,
          type: block.type,
          params: block.parameters,
        })),
        edges: payload.edges,
        outputs: payload.outputs,
        sim: payload.sim,
      })
    : payload.kind === 'mixed'
      ? JSON.stringify({
          kind: payload.kind,
          blocks: payload.blocks.map((block) => ({
            id: block.id,
            type: block.type,
            params: block.parameters,
          })),
          edges: payload.edges,
          outputs: payload.outputs,
          bridges: payload.bridges,
          circuit: {
            components: payload.circuit.components.map((component) => ({
              id: component.id,
              type: component.type,
              params: component.parameters,
              conn: component.connections,
            })),
            nets: payload.circuit.nets,
          },
          sim: payload.sim,
        })
      : JSON.stringify({
          kind: payload.kind ?? 'circuit',
          components: payload.components.map(c => ({ id: c.id, type: c.type, params: c.parameters, conn: c.connections })),
          nets: payload.nets,
          sim: payload.sim,
          method: payload.method,
          thevenin_port: payload.thevenin_port,
        })
  let h = 0
  for (let i = 0; i < key.length; i++) h = Math.imul(31, h) + key.charCodeAt(i) | 0
  return String(h)
}

/**
 * options.signal：调用方自己管取消（案例演示的预取）。不给就用模块级的「当前运行」控制器，
 * 它会被 beginSimulationRun / cancelSimulation 连带打断——演示的请求不能和学生自己的运行互相打断。
 */
export async function runSimulationRequest(
  payload: SimulationRequestPayload,
  options: { signal?: AbortSignal } = {},
): Promise<SimulationResponse> {
  const { storagePrefix, embedded } = simulationApiOptions()
  const keyedCacheKey = `${storagePrefix}sim:${hashPayload(payload)}`
  const timeout = embedded ? TIMEOUT_MS.embedded : TIMEOUT_MS.dev
  const maxRetries = 2
  let attempt = 0
  let lastError: Error | null = null
  let controller: { signal: AbortSignal }
  if (options.signal) {
    controller = { signal: options.signal }
  } else {
    currentController ??= new AbortController()
    controller = currentController
  }
  while (attempt <= maxRetries) {
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout,
        signal: controller.signal,
      })
      if (!response.ok) {
        // 业务错误现在按 HTTP 语义返回 4xx/5xx，但 body 仍是统一封套——能解析就当正常响应交给 UI
        const text = await response.text().catch(() => '')
        try {
          const envelope = JSON.parse(text) as SimulationResponse
          if (envelope && envelope.status) return envelope
        } catch (parseError) { void parseError }
        throw new Error(`服务器返回错误状态：${response.status}${text ? `（响应：${text.slice(0, 200)}）` : ''}`)
      }
      const data = (await response.json()) as SimulationResponse
      // 离线回放缓存只在开发态用：嵌入知帆时内核退出，宿主回的是 502/503 而不是网络错误，缓存永远读不到，
      // 却会占满拓展端口这个来源下 lab 和 grid 共用的 localStorage 配额，把两边的草稿都挤掉
      if (!embedded) {
        try {
          if (data.status === 'ok') localStorage.setItem(keyedCacheKey, JSON.stringify(data))
        } catch (storageError) { void storageError }
      }
      return data
    } catch (err) {
      // 学生点了取消（或开始了新一次运行）：立即退出，不重试也不回退缓存
      if (controller.signal.aborted) {
        throw new Error('仿真已取消')
      }
      if (err instanceof SimulationTimeoutError) {
        throw new Error(`仿真超过 ${Math.round(timeout / 1000)} 秒没有返回：可能是采样点太多、仿真时长太长，或者电路太大。可以减少采样点或缩短仿真时长后再试`)
      }
      lastError = err instanceof Error ? err : new Error('仿真请求失败')
      if (attempt === maxRetries) break
      const backoff = 400 * Math.pow(2, attempt)
      await sleep(backoff)
      attempt += 1
    }
  }
  const msg = lastError ? lastError.message : ''
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('TypeError') ||
    msg.includes('NetworkError') ||
    msg.includes('ERR_CONNECTION_REFUSED')
  ) {
    // 只允许同一电路（同 payload hash）的缓存回放，绝不展示别的电路的结果
    const cached = embedded ? null : localStorage.getItem(keyedCacheKey)
    if (cached) {
      const stale = JSON.parse(cached) as SimulationResponse
      return { ...stale, message: `${stale.message}（后端不可达，展示该电路最近一次缓存结果）` }
    }
    throw new Error(embedded
      ? '连不上仿真程序：请在课堂里点「重新启动」后再试'
      : '无法连接后端服务：请运行 scripts/start-all.ps1 或确认网关 8100 就绪')
  }
  throw new Error(msg || '仿真请求失败')
}

export function cancelSimulation() {
  if (currentController) {
    try { currentController.abort() } catch (abortError) { void abortError }
  }
  // 在途的请求各自拿着这个控制器，会收到取消；下一次运行换新的，不能拿已取消的去发
  currentController = null
}
