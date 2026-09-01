// @vitest-environment jsdom
import { dia } from '@joint/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from './board';
import { renderInspector } from './inspector';
import { createNodeElement } from './shapes';

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
});
