import { dia, highlighters, shapes } from '@joint/core';
import { createLink, defaultLinkElec, jgdoNamespace, styleLink } from './shapes';
import type { NodeType } from './types';

export interface BoardCallbacks {
  onSelectionChange(cell: dia.Cell | null): void;
  onGraphChanged(): void;
}

export interface Board {
  graph: dia.Graph;
  paper: dia.Paper;
  select(cell: dia.Cell | null): void;
  selection(): dia.Cell | null;
  deleteSelection(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  fitContent(): void;
  nextId(prefix: string): string;
}

const NODE_TYPES: NodeType[] = ['Bus', 'Load', 'Gen', 'DG'];

function isDevice(cell: dia.Cell | null): boolean {
  const t = cell?.get('jgdoType');
  return t === 'Load' || t === 'Gen' || t === 'DG';
}

function isBus(cell: dia.Cell | null): boolean {
  return cell?.get('jgdoType') === 'Bus';
}

export function createBoard(el: HTMLElement, callbacks: BoardCallbacks): Board {
  const graph = new dia.Graph({}, { cellNamespace: jgdoNamespace });

  const paper = new dia.Paper({
    el,
    model: graph,
    width: '100%',
    height: '100%',
    gridSize: 10,
    drawGrid: { name: 'dot', args: { color: '#dbe2ea', thickness: 1.2 } },
    background: { color: '#fbfcfe' },
    cellViewNamespace: jgdoNamespace,
    linkPinning: false,
    snapLinks: { radius: 45 },
    markAvailable: true,
    defaultConnectionPoint: { name: 'boundary' },
    defaultRouter: { name: 'manhattan', args: { padding: 20, step: 20 } },
    defaultConnector: { name: 'rounded', args: { radius: 6 } },
    defaultLink: () => createLink('Line'),
    validateConnection: (srcView, _srcMagnet, tgtView, _tgtMagnet) => {
      const src = srcView.model as dia.Cell;
      const tgt = tgtView.model as dia.Cell;
      if (src === tgt) return false;
      if (src.isLink() || tgt.isLink()) return false;
      if (isBus(src) && isBus(tgt)) return true;
      if ((isDevice(src) && isBus(tgt)) || (isBus(src) && isDevice(tgt))) return true;
      return false;
    },
  });

  let selected: dia.Cell | null = null;

  function nextIdRef(prefix: string): string {
    let max = 0;
    for (const cell of graph.getCells()) {
      const m = String(cell.id).match(new RegExp(`^${prefix}-(\\d+)$`));
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${prefix}-${max + 1}`;
  }

  function unhighlight(cell: dia.Cell) {
    const view = cell.isLink() ? paper.findViewByModel(cell) : paper.findViewByModel(cell);
    if (view) highlighters.stroke.remove(view, 'jgdo-selection');
  }

  function select(cell: dia.Cell | null) {
    if (selected && selected !== cell && selected.graph) unhighlight(selected);
    selected = cell;
    if (cell && cell.graph) {
      const view = paper.findViewByModel(cell);
      if (view) {
        const selector = cell.isLink() ? { selector: 'line' } : { selector: 'body' };
        highlighters.stroke.add(view, selector, 'jgdo-selection', {
          padding: 4,
          attrs: { stroke: '#2563eb', 'stroke-width': 2, 'stroke-dasharray': '4,3' },
        });
      }
    }
    callbacks.onSelectionChange(cell);
  }

  paper.on('cell:pointerclick', (view) => select(view.model));
  paper.on('blank:pointerclick', () => select(null));

  // 拖放后吸附到网格，保持 Simulink 式的整齐排布
  paper.on('element:pointerup', (view) => {
    const model = view.model as dia.Element;
    const p = model.position();
    model.position(Math.round(p.x / 10) * 10, Math.round(p.y / 10) * 10);
  });

  // 设备-母线 连接语义：连到母线的设备记录 bus 引用，连线本身变为"挂接线"（不导出为支路）。
  paper.on('link:connect', (linkView) => {
    const link = linkView.model as dia.Link;
    const src = link.getSourceElement();
    const tgt = link.getTargetElement();
    if (!src || !tgt) {
      link.remove();
      return;
    }
    if (isBus(src) && isBus(tgt)) {
      // 手工拖出的连线自带 UUID；换成 line-N 友好 id（JointJS 的 cell id 不可变，只能重建）
      if (!/^(line|sw|at)-\d+$/.test(String(link.id))) {
        const fresh = createLink('Line', nextIdRef(`line`));
        fresh.set('elec', link.get('elec') ?? defaultLinkElec('Line'));
        fresh.source({ id: src.id });
        fresh.target({ id: tgt.id });
        link.remove();
        graph.addCell(fresh);
        styleLink(fresh);
        select(fresh);
        return;
      }
      if (!link.get('elec')) link.set('elec', defaultLinkElec('Line'));
      if (!link.get('jgdoType')) link.set('jgdoType', 'Line');
      styleLink(link);
      select(link);
      return;
    }
    const device = isDevice(src) ? src : tgt;
    const bus = isBus(src) ? src : tgt;
    // 一个设备只挂一条母线：替换旧挂接线
    for (const other of graph.getConnectedLinks(device)) {
      if (other !== link && other.get('jgdoType') === 'attach') other.remove();
    }
    link.set('jgdoType', 'attach');
    link.set('elec', {});
    styleLink(link);
    const elec = { ...(device.get('elec') ?? {}) };
    elec.bus = String(bus.id);
    device.set('elec', elec);
    select(device);
  });

  // 挂接线被删除时清掉设备的 bus 引用
  graph.on('remove', (cell: dia.Cell) => {
    if (cell.isLink() && cell.get('jgdoType') === 'attach') {
      const srcId = cell.get('source')?.id;
      const tgtId = cell.get('target')?.id;
      for (const id of [srcId, tgtId]) {
        if (!id) continue;
        const c = graph.getCell(id);
        if (c && isDevice(c)) {
          const elec = { ...(c.get('elec') ?? {}) };
          elec.bus = '';
          c.set('elec', elec);
        }
      }
    }
    if (selected === cell) select(null);
  });

  let changeTimer: number | undefined;
  graph.on('add remove change', () => {
    window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => callbacks.onGraphChanged(), 400);
  });

  // ---- 平移与缩放 ----
  let panning: { x: number; y: number; tx: number; ty: number } | null = null;
  paper.on('blank:pointerdown', (evt) => {
    const t = paper.translate();
    panning = { x: evt.clientX ?? 0, y: evt.clientY ?? 0, tx: t.tx, ty: t.ty };
  });
  document.addEventListener('mousemove', (evt) => {
    if (!panning) return;
    paper.translate(panning.tx + evt.clientX - panning.x, panning.ty + evt.clientY - panning.y);
  });
  document.addEventListener('mouseup', () => {
    panning = null;
  });

  function zoomAt(cx: number, cy: number, factor: number) {
    const scale = paper.scale().sx;
    const next = Math.min(3, Math.max(0.2, scale * factor));
    const t = paper.translate();
    paper.translate(cx - ((cx - t.tx) * next) / scale, cy - ((cy - t.ty) * next) / scale);
    paper.scale(next, next);
  }

  el.addEventListener(
    'wheel',
    (evt) => {
      evt.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(evt.clientX - rect.left, evt.clientY - rect.top, evt.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false },
  );

  function center(): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }

  return {
    graph,
    paper,
    select,
    selection: () => selected,
    deleteSelection() {
      if (!selected) return;
      const cell = selected;
      select(null);
      // 删除设备时一并删除其挂接线（graph 的 remove 级联只删相连 link，这正是我们要的）
      cell.remove();
    },
    zoomIn: () => {
      const c = center();
      zoomAt(c.x, c.y, 1.2);
    },
    zoomOut: () => {
      const c = center();
      zoomAt(c.x, c.y, 1 / 1.2);
    },
    zoomReset: () => {
      paper.scale(1, 1);
      paper.translate(0, 0);
    },
    fitContent() {
      if (graph.getCells().length === 0) return;
      if (el.clientWidth === 0 || el.clientHeight === 0) return; // 容器隐藏时无法计算
      paper.transformToFitContent({
        padding: 40,
        minScale: 0.2,
        maxScale: 1.2,
        horizontalAlign: 'middle',
        verticalAlign: 'middle',
      });
    },
    nextId: nextIdRef,
  };
}

export { NODE_TYPES, isBus, isDevice };
