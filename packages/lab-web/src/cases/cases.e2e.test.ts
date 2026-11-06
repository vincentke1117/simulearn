import { describe, expect, it } from 'vitest'

import type { SimulationResponse } from '@/types/circuit'
import { evaluateChecks } from './checks'
import { QIU_CASES, casePayload } from './library'

/**
 * 案例库逐个对着真实内核核对教材答案：页面同一套代码构造请求 → 内核 → 按核对点取值比较。
 * 需要 lab 内核在 127.0.0.1:8080 上跑着，所以不进离线门禁。
 * 跑法：LAB_E2E=1 npx vitest run src/cases/cases.e2e.test.ts（只跑一个：再加 CASE=<案例 id>）
 */
const BACKEND = 'http://127.0.0.1:8080/simulate'
const TOKEN = process.env.SIMULEARN_TOKEN ?? 'simulearn-dev'
const ONLY = process.env.CASE

describe.runIf(process.env.LAB_E2E === '1')('案例库 × 真实内核', () => {
  const cases = ONLY ? QIU_CASES.filter((item) => item.id === ONLY) : QIU_CASES
  it.each(cases.map((item) => [item.id, item] as const))('%s', async (_, item) => {
    const build = casePayload(item)
    expect(build.errors).toEqual([])
    const res = await fetch(BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zhifan-Ext-Token': TOKEN },
      body: JSON.stringify(build.payload),
    })
    const envelope = (await res.json()) as SimulationResponse
    if (envelope.status !== 'ok') throw new Error(`${item.id}：内核报错 ${envelope.code ?? ''} ${envelope.message ?? ''}`)
    const outcomes = evaluateChecks(item.checks, build.payload!, envelope.data)
    for (const outcome of outcomes) {
      const { check } = outcome
      console.log(`[${item.id}] ${outcome.ok ? '✓' : '✗'} ${check.label}：教材 ${check.expect} ${check.unit}，内核 ${outcome.actual ?? outcome.reason}`)
    }
    expect(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.check.label)).toEqual([])
  }, 120_000)
})
