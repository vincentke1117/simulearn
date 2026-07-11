import type { Topology } from './types';

// 统一工程文件信封 v1（simulearn.project/1）——与 lab-web 的 workspace/project.ts 保持同构。
export const PROJECT_SCHEMA = 'simulearn.project/1';

export interface ProjectEnvelope {
  schema: typeof PROJECT_SCHEMA;
  kind: 'grid' | 'circuit' | 'control' | 'mixed';
  name: string;
  app: { module: 'grid' | 'lab' };
  createdAt: string;
  payload: unknown;
}

export function wrapGridProject(name: string, payload: Topology): ProjectEnvelope {
  return {
    schema: PROJECT_SCHEMA,
    kind: 'grid',
    name,
    app: { module: 'grid' },
    createdAt: new Date().toISOString(),
    payload,
  };
}

type UnwrapResult = { ok: true; topology: Topology } | { ok: false; error: string };

/** 接受信封或裸拓扑（示例/旧文件），grid 之外的工程给出指路错误。 */
export function unwrapProjectFile(parsed: unknown): UnwrapResult {
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: '文件格式不正确' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schema === PROJECT_SCHEMA) {
    if (obj.kind !== 'grid') {
      return { ok: false, error: '这是电路实验室的工程文件，请回到首页进入「电路实验室」打开' };
    }
    return unwrapProjectFile(obj.payload);
  }
  if (!Array.isArray(obj.nodes)) {
    return { ok: false, error: '文件中没有拓扑节点（nodes）' };
  }
  return { ok: true, topology: parsed as Topology };
}
