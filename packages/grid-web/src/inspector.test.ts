// @vitest-environment jsdom
import { dia } from '@joint/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from './board';
import { renderInspector } from './inspector';
import { createLink, createNodeElement } from './shapes';

let host: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.appendChild(host);
});

function mountedBus(id: string, name: string): { board: Board; cell: dia.Element } {
  const graph = new dia.Graph();
  const cell = createNodeElement('Bus', id, name);
  graph.addCell(cell);
  return { board: { graph } as unknown as Board, cell };
}

describe('renderInspector', () => {
  it('renders the normal inspector header', () => {
    const { board, cell } = mountedBus('bus-1', '主母线');

    renderInspector(host, board, cell, { onChanged: vi.fn(), onDelete: vi.fn() });

    expect(host.querySelector('.inspector-head .chip')?.textContent).toBe('母线');
    expect(host.querySelector('.inspector-head code')?.textContent).toBe('bus-1');
    expect((host.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('主母线');
  });

  it('renders imported cell ids as inert inspector text', () => {
    const id = 'x</code><img data-xss-probe src=x><code>';
    const { board, cell } = mountedBus(id, '攻击载荷');

    renderInspector(host, board, cell, { onChanged: vi.fn(), onDelete: vi.fn() });

    expect(host.querySelector('[data-xss-probe]')).toBeNull();
    expect(host.querySelector('.inspector-head code')?.textContent).toBe(id);
  });

  // 嵌入模式锁定拓扑时学生只调参数。把变压器改成线路后，草稿不再带变压器字段；重开后改回变压器，
  // 会按母线电压重填额定电压、挡位归 0，而且不留痕迹（第十二章算例的低压侧额定 6.3 kV 会变成母线的 6 kV）
  it('锁定拓扑时支路「类型」不能改，其余参数照常可改', () => {
    const graph = new dia.Graph();
    const link = createLink('Transformer', 'tr-1');
    graph.addCell(link);
    const board = { graph } as unknown as Board;

    renderInspector(host, board, link, { onChanged: vi.fn(), onDelete: vi.fn(), canDelete: false });
    const selects = [...host.querySelectorAll('select')];
    const kindSelect = selects.find((el) => [...el.options].some((o) => o.value === 'Transformer'));
    expect(kindSelect?.disabled).toBe(true);
    const numberInputs = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(numberInputs.length).toBeGreaterThan(0);
    expect(numberInputs.every((el) => !el.disabled)).toBe(true);

    renderInspector(host, board, link, { onChanged: vi.fn(), onDelete: vi.fn() });
    const unlocked = [...host.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Transformer'));
    expect(unlocked?.disabled).toBe(false);
  });
});
