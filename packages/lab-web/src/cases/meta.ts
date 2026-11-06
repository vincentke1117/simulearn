/** 每个案例单独一份草稿：实验前缀下再按案例 id 隔离（id 只含安全字符，见 cases.test.ts） */
export function caseStoragePrefix(experimentPrefix: string, caseId: string): string {
  return `${experimentPrefix}case-${caseId}:`
}
