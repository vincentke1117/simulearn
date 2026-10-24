// @vitest-environment jsdom
// 第十二章调压实验（教材例 12-3）：变压器分接头、电容组在前端的校验与导入导出往返。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { dia } from '@joint/core';
import { describe, expect, it } from 'vitest';

import type { Board } from './board';
import { jgdoNamespace } from './shapes';
import { exportTopology, importTopology } from './topologyio';
import type { Topology } from './types';
import { validateTopology } from './validation';

// jsdom 环境下 import.meta.url 不是 file: URL，按包目录（vitest 的 cwd）定位后端示例
const example = (name: string): Topology =>
  JSON.parse(readFileSync(resolve(process.cwd(), `../grid-backend/examples/${name}.json`), 'utf8')) as Topology;

const errors = (topo: Topology) => validateTopology(topo).filter((i) => i.level === 'error').map((i) => i.message);

function edit(mutate: (t: Topology) => void): Topology {
  const topo = example('ch12_tap_max');
  mutate(topo);
  return topo;
}

describe('ch12 validation', () => {
  it('accepts both textbook cases as shipped', () => {
    expect(errors(example('ch12_tap_max'))).toEqual([]);
    expect(errors(example('ch12_tap_min'))).toEqual([]);
  });

  it('requires the transformer to start at the high-voltage bus', () => {
    const reversed = edit((t) => {
      const link = t.links[0];
      [link.from, link.to] = [link.to, link.from];
    });
    expect(errors(reversed).join('；')).toContain('起点必须是高压侧母线');
  });

  it('rejects tap positions outside ±tap_steps', () => {
    expect(errors(edit((t) => (t.links[0].tap_pos = 3))).join('；')).toContain('挡位必须在');
    expect(errors(edit((t) => (t.links[0].tap_pos = 0.5))).join('；')).toContain('挡位必须在');
  });

  it('rejects a plain line between different voltage levels', () => {
    expect(errors(edit((t) => (t.links[0].type = 'Line'))).join('；')).toContain('不同电压等级');
  });

  it('bounds the capacitor groups switched in', () => {
    const cap = (t: Topology) => t.nodes.find((n) => n.type === 'Capacitor')!;
    expect(errors(edit((t) => (cap(t).in_service = 5))).join('；')).toContain('投入组数必须在 0 到 4 之间');
    expect(errors(edit((t) => (cap(t).in_service = 4)))).toEqual([]);
  });
});

describe('ch12 import → export round trip', () => {
  function fakeBoard(): Board {
    const graph = new dia.Graph({}, { cellNamespace: jgdoNamespace });
    return { graph, select: () => {}, fitContent: () => {} } as unknown as Board;
  }

  it('keeps the tap settings and capacitor groups (no silent reset to tap 0)', () => {
    const source = edit((t) => {
      t.links[0].tap_pos = -1;
      t.nodes.find((n) => n.type === 'Capacitor')!.in_service = 2;
    });
    const board = fakeBoard();
    importTopology(board, source);
    const back = exportTopology(board, { baseMVA: source.meta.baseMVA, feeder: source.meta.feeder });

    const t1 = back.links.find((l) => l.id === 'T1')!;
    expect(t1.type).toBe('Transformer');
    expect([t1.from, t1.to]).toEqual(['bus-hv', 'bus-lv']);
    expect({ hv: t1.hv_kv, lv: t1.lv_kv, step: t1.tap_step_pct, steps: t1.tap_steps, pos: t1.tap_pos }).toEqual({
      hv: 110, lv: 6.3, step: 2.5, steps: 2, pos: -1,
    });
    expect({ r: t1.r_ohm, x: t1.x_ohm }).toEqual({ r: 2.44, x: 40 });

    const cap = back.nodes.find((n) => n.id === 'cap-1')!;
    expect(cap.type).toBe('Capacitor');
    expect({ bus: cap.bus, q: cap.q_unit_kvar, groups: cap.groups, on: cap.in_service }).toEqual({
      bus: 'bus-lv', q: 2000, groups: 4, on: 2,
    });

    expect(back.nodes.find((n) => n.id === 'bus-lv')!.kv).toBe(6);
    expect(errors(back)).toEqual([]);
  });
});
