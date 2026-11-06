import { useCallback, useEffect, useRef, useState } from 'react'

import { runSimulationRequest } from '@/simulation/api'
import type { BuildSimulationPayloadResult } from '@/simulation/payload'
import type { SimulationPayload } from '@/types/circuit'

export type DemoResult =
  | { status: 'loading' }
  | { status: 'ok'; payload: SimulationPayload; data: unknown }
  | { status: 'error'; message: string }

/**
 * 打开演示就把各步要算的请求按顺序全发出去，结果按键缓存：课堂上点「下一步」不出现「计算中…」。
 * 用自己的 AbortController（runSimulationRequest 的 signal），不碰学生那边的「当前运行」，退出演示时只取消自己的请求。
 */
export function useDemoResults(requests: Array<{ key: string; build: BuildSimulationPayloadResult }>) {
  const [results, setResults] = useState<Record<string, DemoResult>>({})
  const generation = useRef(0)
  const requestsRef = useRef(requests)
  requestsRef.current = requests

  const run = useCallback(() => {
    const controller = new AbortController()
    const current = (generation.current += 1)
    const list = requestsRef.current
    setResults(Object.fromEntries(list.map(({ key }) => [key, { status: 'loading' } as DemoResult])))
    void (async () => {
      for (const { key, build } of list) {
        if (controller.signal.aborted || current !== generation.current) return
        let result: DemoResult
        if (!build.ok || !build.payload) {
          result = { status: 'error', message: build.errors.join('；') || '这一步的电路构造不出请求' }
        } else {
          try {
            const response = await runSimulationRequest(build.payload, { signal: controller.signal })
            result = response.status === 'ok'
              ? { status: 'ok', payload: build.payload, data: response.data }
              : { status: 'error', message: response.message ?? '内核报错' }
          } catch (err) {
            if (controller.signal.aborted) return
            result = { status: 'error', message: err instanceof Error ? err.message : String(err) }
          }
        }
        if (current !== generation.current) return
        setResults((previous) => ({ ...previous, [key]: result }))
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => run(), [run])

  return { results, retry: run }
}
