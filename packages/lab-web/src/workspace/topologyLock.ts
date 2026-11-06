/**
 * 拓扑锁定（设计记录 D19，嵌入且没有任务时）：画布交来的变更里去掉删除。
 * 选中、拖动、改尺寸照常放行；新增元件和连线在 drop / connect 处另外拦。
 */
export function dropRemovals<T extends { type: string }>(changes: T[], locked: boolean): T[] {
  return locked ? changes.filter((change) => change.type !== 'remove') : changes
}
