import type {
  ApiEnvelope,
  ExampleInfo,
  N1Request,
  N1Result,
  OpfResult,
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

/**
 * 接口地址一律相对页面（知帆拓展约定 zhifan-ext/1 §3）：页面在宿主里位于 /ext/<id>/ui/，
 * 写死以 / 开头的地址会绕过宿主的 /ext/<id>/ 前缀。'../api/grid/' 在三种部署下都落对：
 *   宿主 /ext/<id>/ui/ → /ext/<id>/api/grid/…；开发网关 /grid/ → /api/grid/…；Vite 开发服务器 / → /api/grid/…
 */
export const API_BASE = '../api/grid/';
export const apiUrl = (path: string): string => API_BASE + path;

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
  return post<PfResult>(apiUrl('pf'), topology);
}

export function runReconfiguration(topology: Topology): Promise<ReconfigResult> {
  return post<ReconfigResult>(apiUrl('reconfig'), topology);
}

/** 最优潮流 / 经济调度：请求体就是拓扑本身（顶层，无包装，与 /n1 的裸拓扑形式一致）。 */
export function runOpf(topology: Topology): Promise<OpfResult> {
  return post<OpfResult>(apiUrl('opf'), topology);
}

/**
 * N-1：请求体 {topology, restore}。restore=true 时响应多出 restoration 数组。
 * ⚠️ 不要带 max_ties —— 后端已删除该字段，带上直接 422。
 */
export function runN1(request: N1Request): Promise<N1Result> {
  return post<N1Result>(apiUrl('n1'), request);
}

export function runTimeseries(request: TimeseriesRequest): Promise<TimeseriesResult> {
  return post<TimeseriesResult>(apiUrl('timeseries'), request);
}

export function runShortCircuit(request: ShortCircuitRequest): Promise<ShortCircuitResult> {
  return post<ShortCircuitResult>(apiUrl('shortcircuit'), request);
}

export function runTransient(request: TransientRequest): Promise<TransientResult> {
  return post<TransientResult>(apiUrl('transient'), request);
}

export async function fetchExamples(): Promise<ExampleInfo[]> {
  const resp = await fetch(apiUrl('examples'));
  if (!resp.ok) return [];
  return (await resp.json()) as ExampleInfo[];
}

export async function fetchExample(name: string): Promise<Topology> {
  const resp = await fetch(apiUrl(`examples/${encodeURIComponent(name)}`));
  if (!resp.ok) throw new ApiError(`加载示例失败 (HTTP ${resp.status})`);
  return (await resp.json()) as Topology;
}
