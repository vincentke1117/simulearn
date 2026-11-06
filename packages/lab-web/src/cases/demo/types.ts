import type { AnalysisMethod, CircuitProject } from '@/types/circuit'
import type { CaseCheck } from '../types'

/**
 * 案例演示（电路课老师提的需求：等效变换的过程、KVL 与参考方向）。
 * 案例 JSON 里只放轻量索引 CaseDemoRef；逐步数据放在 cases/demos/<案例 id>.<演示 id>.json，打开演示时才加载。
 * 课堂上老师点「下一步」逐步讲，不自动播放。
 */

export type DemoKind = 'steps' | 'kvl'

/** 案例 JSON 里的演示索引 */
export interface CaseDemoRef {
  id: string
  kind: DemoKind
  title: string
  summary?: string
}

/** 读数：沿用案例核对点的形状（path / expect / tol / rms），多一个 key 供讲解文字里的 {key} 引用 */
export interface DemoValue extends Omit<CaseCheck, 'fromBook'> {
  key: string
  /** 结果再加工：取倒数（外加 1 V 读电流求电阻）、取负（非关联方向的读数） */
  transform?: 'reciprocal' | 'negate'
  /** 显示的有效数字，缺省 4 */
  digits?: number
  fromBook?: boolean
}

/** 画布上的文字气泡；anchor 是元件 id 时位置相对该元件左上角（dx、dy），否则用 x、y */
export interface DemoNote {
  id: string
  text: string
  anchor?: string
  dx?: number
  dy?: number
  x?: number
  y?: number
  tone?: 'info' | 'accent' | 'warn'
}

/** 这一步要交内核算的电路：缺省就是本步的 circuit；from 指向另一步（比如独立源已经画成导线、没法单独算的那一步） */
export interface DemoCompute {
  method: AnalysisMethod
  from?: number
  theveninPort?: { positive: string; negative: string }
}

/** 一张对照表：把某个元件参数依次取几个值，每个值算一遍（例 4-8 的检流计电阻 50/100/200/500 Ω） */
export interface DemoSweepTable {
  param: { id: string; key: string; label: string; unit: string }
  values: number[]
  columns: Array<{ label: string; path: string; unit: string; digits?: number; book?: number[] }>
  /** 用哪一步的电路算；缺省本步 */
  from?: number
  method: AnalysisMethod
  caption?: string
}

export interface DemoStep {
  title: string
  /** 1～3 句讲解；{key} 换成本步读数（带单位） */
  text: string
  /** 本步画布上的电路；省略时沿用上一步的电路（「先圈出、再替换」的两拍） */
  circuit?: CircuitProject
  compute?: DemoCompute
  values?: DemoValue[]
  /** 强调的元件（发光描边） */
  highlight?: string[]
  /** 淡显的元件（置零的源、被短接的支路等） */
  dim?: string[]
  notes?: DemoNote[]
  table?: DemoSweepTable
  /** 演示画布上隐藏这些元件的端子标签（电流源的 +/− 标签和箭头规则容易打架） */
  hideHandleLabels?: string[]
}

export interface StepsDemo {
  caseId: string
  id: string
  kind: 'steps'
  title: string
  steps: DemoStep[]
}

/** KVL：一条支路只画一个电流参考箭头，沿 ref 元件的 p→n，读数取它的支路电流 */
export interface KvlBranch {
  name: string
  elements: string[]
  ref: string
}

export interface KvlLoopElement {
  id: string
  /** 绕行（按作者给的方向，约定为顺时针）时从这个端子进入元件 */
  enter: string
  /** 多端元件（受控源）必须写；两端元件可省略，取另一端 */
  exit?: string
}

export interface KvlLoop {
  id: string
  name: string
  /** 起点结点的名字（教材的叫法，例如「左下角结点」） */
  start: string
  elements: KvlLoopElement[]
  /** 走完一圈以后再给的「教材形式」（电阻项留左边、电源项移到右边） */
  textbook?: string[]
  note?: string
}

export interface KvlDemo {
  caseId: string
  id: string
  kind: 'kvl'
  title: string
  method: AnalysisMethod
  branches: KvlBranch[]
  loops: KvlLoop[]
  /** 走圈之前的讲解步（参考方向、读数与实际方向） */
  intro: Array<{ title: string; text: string; showActual?: boolean }>
}

export type CaseDemoScript = StepsDemo | KvlDemo
