import type { AnalysisMethod, CircuitProject, SweepSettings } from '@/types/circuit'
import type { CaseDemoRef } from './demo/types'

/**
 * 内置教学案例（电路案例库）。案例按教材例题改编：电路结构与参数取自例题，
 * 说明文字是我们自己写的，不搬教材原文；结构锁定（D19），学生只改参数。
 */

/** 一个核对点：用来在测试里拿真实内核核对，也在案例说明里给学生当「教材结果」对照 */
export interface CaseCheck {
  /** 学生看得懂的名字，带符号，例如「R3 两端电压 u3」 */
  label: string
  /**
   * 内核响应 data 里的取值路径，`.` 分段，数组用 1 起始下标（-1 为末位），与 contracts/ 同一规则。
   * `{X}` 换成 X 所在的网络名：X 是探针 id，或「元件 id.端子」，例如 node_voltages.{VP1}、node_voltages.{R3.p}
   */
  path: string
  /** 教材的值；rms 为 true 时是有效值（内核的交流读数是峰值，核对时除以 √2） */
  expect: number
  unit: string
  /** 绝对容差：教材答案通常只保留 3～4 位有效数字 */
  tol: number
  rms?: boolean
  /** true：教材里直接给出的数；false：教材只列了方程或只给了表达式，这个数是按教材数据算出来的 */
  fromBook: boolean
}

export interface CasePreset {
  method: AnalysisMethod
  tStop?: number
  nSamples?: number
  sweep?: Partial<Omit<SweepSettings, 'scale'>>
  /** 戴维宁等效的端口：写探针 id 或「元件 id.端子」，打开案例时换成网络名 */
  theveninPort?: { positive: string; negative: string }
  voltageDisplayMode?: 'node' | 'element'
  showBranchCurrents?: boolean
}

export interface TeachingCase {
  /** 稳定 id：草稿按它隔离，改了 id 学生的草稿就找不回来 */
  id: string
  chapter: number
  chapterTitle: string
  section: string
  /** 对应的教材例题，例如「例 4-8」 */
  source: string
  title: string
  /** 一段话：这个电路在讲什么、看哪个量 */
  summary: string
  /** 动手试试：改哪个参数、预期看到什么 */
  tryIt: string[]
  /** 和教材的差别（峰值 / 有效值、ω 换成 Hz、加了探针等），没有就省略 */
  notes?: string[]
  preset: CasePreset
  checks: CaseCheck[]
  circuit: CircuitProject
  /** 课堂演示（等效变换过程、KVL 与参考方向）的索引；逐步数据在 cases/demos/ 下按需加载 */
  demos?: CaseDemoRef[]
}

export interface CaseLibrary {
  id: string
  title: string
  subtitle: string
  cases: TeachingCase[]
}
