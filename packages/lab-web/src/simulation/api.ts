import type { SimulationRequestPayload, SimulationResponse } from '@/types/circuit'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/lab'

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeout?: number } = {}) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), init.timeout ?? 15000)
  // 超时信号与调用方的取消信号合并——此前调用方 signal 被覆盖，取消按钮从未生效
  const signals = init.signal ? [controller.signal, init.signal] : [controller.signal]
  try {
    const res = await fetch(input, { ...init, signal: AbortSignal.any(signals) })
    return res
  } finally {
    clearTimeout(id)
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

let currentController: AbortController | null = null

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

export async function runSimulationRequest(payload: SimulationRequestPayload): Promise<SimulationResponse> {
  const keyedCacheKey = `slp:lab:sim:${hashPayload(payload)}`
  const maxRetries = 2
  let attempt = 0
  let lastError: Error | null = null
  if (currentController) {
    try { currentController.abort() } catch (abortError) { void abortError }
  }
  currentController = new AbortController()
  while (attempt <= maxRetries) {
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 15000,
        signal: currentController.signal,
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
      try {
        if (data.status === 'ok') localStorage.setItem(keyedCacheKey, JSON.stringify(data))
      } catch (storageError) { void storageError }
      return data
    } catch (err) {
      // 用户主动取消（或被新请求顶替）：立即退出，不重试也不回退缓存
      if (currentController?.signal.aborted) {
        throw new Error('仿真已取消')
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
    const cached = localStorage.getItem(keyedCacheKey)
    if (cached) {
      const stale = JSON.parse(cached) as SimulationResponse
      return { ...stale, message: `${stale.message}（后端不可达，展示该电路最近一次缓存结果）` }
    }
    throw new Error('无法连接后端服务：请运行 scripts/start-all.ps1 或确认网关 8100 就绪')
  }
  throw new Error(msg || '仿真请求失败')
}

export function cancelSimulation() {
  if (currentController) {
    try { currentController.abort() } catch (abortError) { void abortError }
  }
}
