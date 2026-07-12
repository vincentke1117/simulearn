import type {
  ApiEnvelope,
  ExampleInfo,
  N1Result,
  PfResult,
  ReconfigResult,
  ShortCircuitRequest,
  ShortCircuitResult,
  TimeseriesRequest,
  TimeseriesResult,
  Topology,
  TransientRequest,
  TransientResult,
} from './types';

export class ApiError extends Error {
  code?: string;
  path?: string[];
  httpStatus?: number;
  constructor(message: string, code?: string, path?: string[], httpStatus?: number) {
    super(message);
    this.code = code;
    this.path = path;
    this.httpStatus = httpStatus;
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok && resp.headers.get('content-type')?.includes('json') !== true) {
    throw new ApiError(`服务不可用 (HTTP ${resp.status})`, undefined, undefined, resp.status);
  }
  const envelope = (await resp.json()) as ApiEnvelope<T>;
  // 业务错误走 HTTP 422/500，封套里的 message/code/path 是学生唯一能看到的诊断信息，必须原样上抛。
  if (envelope.status !== 'ok' || envelope.data == null) {
    throw new ApiError(envelope.message || '后端返回错误', envelope.code, envelope.path, resp.status);
  }
  return envelope.data;
}

export function runPf(topology: Topology): Promise<PfResult> {
  return post<PfResult>('/api/grid/pf', topology);
}

export function runReconfiguration(topology: Topology): Promise<ReconfigResult> {
  return post<ReconfigResult>('/api/grid/reconfig', topology);
}

/** N-1：请求体就是拓扑本身（顶层，无包装）。 */
export function runN1(topology: Topology): Promise<N1Result> {
  return post<N1Result>('/api/grid/n1', topology);
}

export function runTimeseries(request: TimeseriesRequest): Promise<TimeseriesResult> {
  return post<TimeseriesResult>('/api/grid/timeseries', request);
}

export function runShortCircuit(request: ShortCircuitRequest): Promise<ShortCircuitResult> {
  return post<ShortCircuitResult>('/api/grid/shortcircuit', request);
}

export function runTransient(request: TransientRequest): Promise<TransientResult> {
  return post<TransientResult>('/api/grid/transient', request);
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
