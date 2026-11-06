import { describe, expect, it } from 'vitest'

import type { SimulationResponse } from '@/types/circuit'
import { evaluateValue, stepRequest, tableRequests } from './demoPayload'
import type { CaseDemoScript, StepsDemo } from './types'

/**
 * 演示逐步对着真实内核核对：每一步带 expect 的读数、对照表每一行的教材值。
 * 跑法：LAB_E2E=1 npx vitest run src/cases/demo/demos.e2e.test.ts（只跑一个：DEMO=<案例 id>.<演示 id>）
 */
const BACKEND = 'http://127.0.0.1:8080/simulate'
const TOKEN = process.env.SIMULEARN_TOKEN ?? 'simulearn-dev'
const ONLY = process.env.DEMO

const modules = import.meta.glob<{ default: CaseDemoScript }>('../demos/*.json', { eager: true })
const scripts = Object.values(modules)
  .map((module) => module.default)
  .filter((script): script is StepsDemo => script.kind === 'steps')
  .filter((script) => !ONLY || `${script.caseId}.${script.id}` === ONLY)

async function post(payload: unknown): Promise<SimulationResponse> {
  const res = await fetch(BACKEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Zhifan-Ext-Token': TOKEN },
    body: JSON.stringify(payload),
  })
  return (await res.json()) as SimulationResponse
}

describe.runIf(process.env.LAB_E2E === '1')('演示 × 真实内核', () => {
  it.each(scripts.map((script) => [`${script.caseId}.${script.id}`, script] as const))('%s', async (name, script) => {
    const failures: string[] = []
    for (let index = 0; index < script.steps.length; index += 1) {
      const step = script.steps[index]
      const build = stepRequest(script, index)
      if (build) {
        const envelope = await post(build.payload)
        if (envelope.status !== 'ok') {
          failures.push(`第 ${index + 1} 步内核报错：${envelope.message}`)
        } else {
          for (const value of step.values ?? []) {
            const outcome = evaluateValue(value, build.payload!, envelope.data)
            console.log(`[${name}] 第 ${index + 1} 步 ${outcome.ok ? '✓' : '✗'} ${value.label}：期望 ${value.expect ?? '—'}，内核 ${outcome.actual ?? outcome.reason}`)
            if (!outcome.ok) failures.push(`第 ${index + 1} 步 ${value.label}`)
          }
        }
      }
      const table = step.table
      if (table) {
        const builds = tableRequests(script, index)
        for (let row = 0; row < builds.length; row += 1) {
          const envelope = await post(builds[row].payload)
          if (envelope.status !== 'ok') {
            failures.push(`第 ${index + 1} 步表第 ${row + 1} 行内核报错：${envelope.message}`)
            continue
          }
          for (const column of table.columns) {
            const outcome = evaluateValue({ path: column.path }, builds[row].payload!, envelope.data)
            const book = column.book?.[row]
            console.log(`[${name}] 第 ${index + 1} 步表 ${table.param.label}=${table.values[row]}：内核 ${outcome.actual}，教材 ${book ?? '—'}`)
            // 教材数据常有截断：表里的教材值只要求差在 0.2% 以内
            if (outcome.actual === undefined || (book !== undefined && Math.abs(outcome.actual - book) > Math.abs(book) * 2e-3)) {
              failures.push(`第 ${index + 1} 步表 ${table.param.label}=${table.values[row]}`)
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  }, 300_000)
})
