import { describe, expect, it, vi } from 'vitest';

import {
  embedQuery,
  experimentKeyPrefix,
  isEmbedHash,
  parseLoadMessage,
  projectFingerprint,
  readyMessage,
  resolveProject,
  startEmbed,
  type EmbedWindow,
} from './embed';
import type { Topology } from './types';

const topo: Topology = { meta: { baseMVA: 100, feeder: 'F1' }, nodes: [{ id: 'bus-1', type: 'Bus' }], links: [] } as Topology;

describe('embed hash', () => {
  it('recognises #/embed with and without query', () => {
    expect(isEmbedHash('#/embed')).toBe(true);
    expect(isEmbedHash('#/embed?example=ieee33')).toBe(true);
    expect(isEmbedHash('#/editor')).toBe(false);
    expect(isEmbedHash('#/embedded')).toBe(false);
    expect(isEmbedHash('')).toBe(false);
  });

  it('reads the query part', () => {
    expect(embedQuery('#/embed?example=ieee33').get('example')).toBe('ieee33');
    expect(embedQuery('#/embed').get('example')).toBeNull();
  });
});

describe('parseLoadMessage', () => {
  it('accepts a host load message', () => {
    const load = parseLoadMessage({ source: 'zhifan-host', type: 'load', experiment: 'ch12-tap-1', project: { example: 'x' } });
    expect(load).toEqual({ experiment: 'ch12-tap-1', project: { example: 'x' }, task: null });
  });

  it('ignores anything else', () => {
    expect(parseLoadMessage(null)).toBeNull();
    expect(parseLoadMessage('load')).toBeNull();
    expect(parseLoadMessage({ source: 'maic-interactive', type: 'load', experiment: 'a' })).toBeNull();
    expect(parseLoadMessage({ source: 'zhifan-host', type: 'ready', experiment: 'a' })).toBeNull();
    expect(parseLoadMessage({ source: 'zhifan-host', type: 'load', experiment: '' })).toBeNull();
    expect(parseLoadMessage({ source: 'zhifan-host', type: 'load', experiment: 42 })).toBeNull();
  });
});

describe('resolveProject', () => {
  it('accepts a built-in example reference', () => {
    expect(resolveProject({ example: 'ieee33' })).toEqual({ kind: 'example', name: 'ieee33' });
  });

  it('rejects unsafe example names', () => {
    expect(resolveProject({ example: '../secret' }).kind).toBe('error');
    expect(resolveProject({ example: 3 }).kind).toBe('error');
  });

  it('unwraps a simulearn.project/1 envelope', () => {
    const envelope = { schema: 'simulearn.project/1', kind: 'grid', name: 'ch12', app: { module: 'grid' }, payload: topo };
    const resolved = resolveProject(envelope);
    expect(resolved.kind).toBe('topology');
  });

  it('reports a missing or circuit project', () => {
    expect(resolveProject(null).kind).toBe('error');
    const circuit = { schema: 'simulearn.project/1', kind: 'circuit', app: { module: 'lab' }, payload: { nodes: [], edges: [] } };
    expect(resolveProject(circuit).kind).toBe('error');
  });
});

describe('experiment storage isolation', () => {
  it('namespaces keys per experiment and strips unsafe characters', () => {
    expect(experimentKeyPrefix('ch12-tap-1')).toBe('slp:grid:exp:ch12-tap-1:');
    expect(experimentKeyPrefix('a:b/c')).toBe('slp:grid:exp:a_b_c:');
    expect(experimentKeyPrefix('')).toBe('slp:grid:exp:_:');
  });

  it('fingerprints projects so stale drafts are not restored', () => {
    expect(projectFingerprint({ example: 'a' })).toBe(projectFingerprint({ example: 'a' }));
    expect(projectFingerprint({ example: 'a' })).not.toBe(projectFingerprint({ example: 'b' }));
  });
});

function fakeWindow(): { win: EmbedWindow; parent: { postMessage: ReturnType<typeof vi.fn> }; dispatch: (source: unknown, data: unknown) => void } {
  const listeners: Array<(event: MessageEvent) => void> = [];
  const parent = { postMessage: vi.fn() };
  const win: EmbedWindow = {
    parent,
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: (_type, listener) => listeners.splice(listeners.indexOf(listener), 1),
  };
  const dispatch = (source: unknown, data: unknown) =>
    listeners.forEach((l) => l({ source, data } as unknown as MessageEvent));
  return { win, parent, dispatch };
}

describe('startEmbed', () => {
  it('announces ready to the parent with targetOrigin "*"', () => {
    const { win, parent } = fakeWindow();
    startEmbed(win, { loadExample: vi.fn(), applyExperiment: vi.fn(), onError: vi.fn() });
    expect(parent.postMessage).toHaveBeenCalledWith(readyMessage(), '*');
  });

  it('loads an example on a host load message from the parent only', async () => {
    const { win, parent, dispatch } = fakeWindow();
    const loadExample = vi.fn().mockResolvedValue(topo);
    const applyExperiment = vi.fn();
    startEmbed(win, { loadExample, applyExperiment, onError: vi.fn() });
    const load = { source: 'zhifan-host', type: 'load', experiment: 'ch12-tap-1', project: { example: 'ieee33' } };

    dispatch({ other: true }, load); // 不是父窗口：忽略
    await Promise.resolve();
    expect(loadExample).not.toHaveBeenCalled();

    dispatch(parent, load);
    await vi.waitFor(() => expect(applyExperiment).toHaveBeenCalledTimes(1));
    expect(loadExample).toHaveBeenCalledWith('ieee33');
    expect(applyExperiment.mock.calls[0][0].experiment).toBe('ch12-tap-1');
  });

  it('reports load failures to the host', async () => {
    const { win, parent, dispatch } = fakeWindow();
    const onError = vi.fn();
    startEmbed(win, { loadExample: vi.fn().mockRejectedValue(new Error('加载示例失败 (HTTP 404)')), applyExperiment: vi.fn(), onError });
    dispatch(parent, { source: 'zhifan-host', type: 'load', experiment: 'x', project: { example: 'missing' } });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('加载示例失败 (HTTP 404)'));
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { source: 'zhifan-ext', type: 'error', message: '加载示例失败 (HTTP 404)' },
      '*',
    );
  });

  it('stays silent when not framed', () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const win = { addEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.push(l), removeEventListener: vi.fn() } as unknown as EmbedWindow & { parent: unknown };
    const postMessage = vi.fn();
    (win as unknown as { parent: unknown }).parent = win;
    (win as unknown as { postMessage: unknown }).postMessage = postMessage;
    startEmbed(win, { loadExample: vi.fn(), applyExperiment: vi.fn(), onError: vi.fn() });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
