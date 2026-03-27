import type { SimulationRequestPayload, SimulationResponse } from '@/types/circuit'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeout?: number } = {}) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), init.timeout ?? 15000)
  try {
    const res = await fetch(input, { ...init, signal: controller.signal })
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
  const cacheKey = 'lastSimulationResponse'
  const keyedCacheKey = `sim:${hashPayload(payload)}`
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
        let detail = ''
        try {
          const text = await response.text()
          if (text) detail = `（响应：${text.slice(0, 200)}）`
        } catch (readError) { void readError }
        throw new Error(`服务器返回错误状态：${response.status}${detail}`)
      }
      const data = (await response.json()) as SimulationResponse
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data))
        localStorage.setItem(keyedCacheKey, JSON.stringify(data))
      } catch (storageError) { void storageError }
      return data
    } catch (err) {
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
    const cached = localStorage.getItem(keyedCacheKey) || localStorage.getItem('lastSimulationResponse')
    if (cached) {
      return JSON.parse(cached) as SimulationResponse
    }
    throw new Error('无法连接后端服务：请确认 Julia 服务正在运行（默认端口 8080）')
  }
  throw new Error(msg || '仿真请求失败')
}

export function cancelSimulation() {
  if (currentController) {
    try { currentController.abort() } catch (abortError) { void abortError }
  }
}
