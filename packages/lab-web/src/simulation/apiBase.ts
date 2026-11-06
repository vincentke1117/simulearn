// 接口地址一律用相对路径（知帆拓展约定 zhifan-ext/1 §3）：页面在宿主里位于 /ext/<id>/ui/，
// ../api/lab 落到 /ext/<id>/api/lab；开发态网关里页面在 /circuit/，同样落到 /api/lab。
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '../api/lab'

export interface SimulationApiOptions {
  /** localStorage 键前缀：嵌入模式下按实验隔离（slp:lab:exp:<实验>:） */
  storagePrefix: string
  /** 嵌入知帆课堂时，连不上内核的提示改成学生能照做的话 */
  embedded: boolean
}

let options: SimulationApiOptions = { storagePrefix: 'slp:lab:', embedded: false }

export function configureSimulationApi(next: SimulationApiOptions) {
  options = next
}

export function simulationApiOptions(): SimulationApiOptions {
  return options
}
