import type { ApiEnvelope, ExampleInfo, PfResult, ReconfigResult, Topology } from './types';

export class ApiError extends Error {
  code?: string;
  path?: string[];
  constructor(message: string, code?: string, path?: string[]) {
    super(message);
    this.code = code;
    this.path = path;
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok && resp.headers.get('content-type')?.includes('json') !== true) {
    throw new ApiError(`服务不可用 (HTTP ${resp.status})`);
  }
  const envelope = (await resp.json()) as ApiEnvelope<T>;
  if (envelope.status !== 'ok' || envelope.data == null) {
    throw new ApiError(envelope.message || '后端返回错误', envelope.code, envelope.path);
  }
  return envelope.data;
}

export function runPf(topology: Topology): Promise<PfResult> {
  return post<PfResult>('/api/grid/pf', topology);
}

export function runReconfiguration(topology: Topology): Promise<ReconfigResult> {
  return post<ReconfigResult>('/api/grid/reconfig', topology);
}

export async function fetchExamples(): Promise<ExampleInfo[]> {
  const resp = await fetch('/api/grid/examples');
  if (!resp.ok) return [];
  return (await resp.json()) as ExampleInfo[];
}

export async function fetchExample(name: string): Promise<Topology> {
  const resp = await fetch(`/api/grid/examples/${encodeURIComponent(name)}`);
  if (!resp.ok) throw new ApiError(`加载示例失败 (HTTP ${resp.status})`);
  return (await resp.json()) as Topology;
}
