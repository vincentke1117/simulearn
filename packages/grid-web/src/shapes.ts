import { dia, shapes } from '@joint/core';
import type { LinkType, NodeType } from './types';

export type LinkKind = LinkType | 'attach';

// 统一制图语言：深墨描边 + 类型色仅用于图标/填充点缀，接近 Simulink 的克制感。
export const BUS_FILL = '#1e293b';
const INK = '#1f2937';
const LINE_COLOR = '#475569';
const OPEN_COLOR = '#94a3b8';
const SWITCH_INK = '#334155';
const GEN_COLOR = '#15803d';
const DG_COLOR = '#0369a1';
const LOAD_COLOR = '#d97706';

export const NODE_META: Record<NodeType, { label: string; title: string; color: string }> = {
  Bus: { label: '▬', title: '母线', color: BUS_FILL },
  Load: { label: '↓', title: '负荷', color: LOAD_COLOR },
  Gen: { label: 'G', title: '电源', color: GEN_COLOR },
  DG: { label: 'DG', title: '分布式电源', color: DG_COLOR },
};

const PORT_ATTRS = {
  r: 4.5,
  fill: '#ffffff',
  stroke: '#64748b',
  strokeWidth: 1.5,
  magnet: true,
  cursor: 'crosshair',
  class: 'jgdo-port',
};

const LABEL_BASE = {
  textAnchor: 'middle',
  fontSize: 11.5,
  fontWeight: '600',
  fill: '#334155',
  fontFamily: 'system-ui, sans-serif',
};

const RESULT_BASE = {
  textAnchor: 'middle',
  fontSize: 10.5,
  fill: '#64748b',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

export const BusShape = dia.Element.define(
  'jgdo.Bus',
  {
    size: { width: 160, height: 10 },
    attrs: {
      body: {
        x: 0, y: 0, width: 'calc(w)', height: 'calc(h)',
        fill: BUS_FILL, stroke: '#0f172a', strokeWidth: 1, rx: 2, ry: 2,
        magnet: 'passive', cursor: 'move', class: 'jgdo-body',
      },
      label: { ...LABEL_BASE, x: 'calc(0.5*w)', y: -9, textVerticalAnchor: 'bottom', text: '' },
      result: { ...RESULT_BASE, x: 'calc(0.5*w)', y: 'calc(h+7)', textVerticalAnchor: 'top', text: '' },
      portLeft: { ...PORT_ATTRS, cx: 10, cy: 'calc(0.5*h)' },
      portRight: { ...PORT_ATTRS, cx: 'calc(w-10)', cy: 'calc(0.5*h)' },
    },
  },
  {
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'text', selector: 'label' },
      { tagName: 'text', selector: 'result' },
      { tagName: 'circle', selector: 'portLeft' },
      { tagName: 'circle', selector: 'portRight' },
    ],
  },
);

// 负荷：竖引线 + 实心下箭头（电力系统习惯画法）
export const LoadShape = dia.Element.define(
  'jgdo.Load',
  {
    size: { width: 26, height: 32 },
    attrs: {
      stem: {
        d: 'M 13 0 L 13 15',
        stroke: INK, strokeWidth: 2, fill: 'none',
        pointerEvents: 'none',
      },
      body: {
        d: 'M 3 15 L 23 15 L 13 31 Z',
        fill: LOAD_COLOR, stroke: 'none',
        magnet: 'passive', cursor: 'move', class: 'jgdo-body',
      },
      label: { ...LABEL_BASE, x: 13, y: 'calc(h+6)', textVerticalAnchor: 'top', text: '' },
      result: { ...RESULT_BASE, x: 13, y: 'calc(h+21)', textVerticalAnchor: 'top', text: '' },
      portTop: { ...PORT_ATTRS, cx: 13, cy: 0 },
    },
  },
  {
    markup: [
      { tagName: 'path', selector: 'stem' },
      { tagName: 'path', selector: 'body' },
      { tagName: 'text', selector: 'label' },
      { tagName: 'text', selector: 'result' },
      { tagName: 'circle', selector: 'portTop' },
    ],
  },
);

// 电源类：IEC 风格圆形符号（G + 交流波浪）
function sourceShape(type: string, color: string, icon: string, iconSize: number, size: number) {
  return dia.Element.define(
    `jgdo.${type}`,
    {
      size: { width: size, height: size },
      attrs: {
        body: {
          cx: 'calc(0.5*w)', cy: 'calc(0.5*h)', r: 'calc(0.5*w)',
          fill: '#ffffff', stroke: INK, strokeWidth: 2,
          magnet: 'passive', cursor: 'move', class: 'jgdo-body',
        },
        icon: {
          x: 'calc(0.5*w)', y: 'calc(0.5*h-4)',
          textAnchor: 'middle', textVerticalAnchor: 'middle',
          fontSize: iconSize, fontWeight: '700', fill: color,
          fontFamily: 'Georgia, serif', text: icon,
          pointerEvents: 'none',
        },
        wave: {
          x: 'calc(0.5*w)', y: 'calc(0.5*h+9)',
          textAnchor: 'middle', textVerticalAnchor: 'middle',
          fontSize: 13, fontWeight: '700', fill: color,
          fontFamily: 'Georgia, serif', text: '∿',
          pointerEvents: 'none',
        },
        label: { ...LABEL_BASE, x: 'calc(0.5*w)', y: 'calc(h+7)', textVerticalAnchor: 'top', text: '' },
        result: { ...RESULT_BASE, x: 'calc(0.5*w)', y: 'calc(h+22)', textVerticalAnchor: 'top', text: '' },
        portTop: { ...PORT_ATTRS, cx: 'calc(0.5*w)', cy: 0 },
      },
    },
    {
      markup: [
        { tagName: 'circle', selector: 'body' },
        { tagName: 'text', selector: 'icon' },
        { tagName: 'text', selector: 'wave' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'result' },
        { tagName: 'circle', selector: 'portTop' },
      ],
    },
  );
}

export const GenShape = sourceShape('Gen', GEN_COLOR, 'G', 17, 46);
export const DgShape = sourceShape('DG', DG_COLOR, 'DG', 12, 42);

export const jgdoNamespace = {
  ...shapes,
  jgdo: { Bus: BusShape, Gen: GenShape, DG: DgShape, Load: LoadShape },
};

export function defaultElec(type: NodeType): Record<string, unknown> {
  switch (type) {
    case 'Bus':
      return { kv: 10.5, is_slack: false, vm_pu: 1.0, va_deg: 0.0, vmin_pu: 0.95, vmax_pu: 1.05 };
    case 'Load':
      return { bus: '', p_kw: 500, q_kvar: 200 };
    case 'Gen':
      return { bus: '', p_kw: 1000, p_max_kw: 2000, p_min_kw: 0, q_kvar: 0, q_max_kvar: 800, q_min_kvar: -800, status: 1 };
    case 'DG':
      return { bus: '', p_kw: 200, p_max_kw: 400, p_min_kw: 0, q_kvar: 0, q_max_kvar: 150, q_min_kvar: -150, status: 1 };
  }
}

export function defaultLinkElec(kind: LinkType): Record<string, unknown> {
  if (kind === 'Switch') {
    return { r_ohm: 0.001, x_ohm: 0.003, rate_mva: 10, status: 'CLOSED', switchable: true };
  }
  return { r_ohm: 0.1, x_ohm: 0.3, rate_mva: 10, status: 'CLOSED', switchable: false };
}

export function createNodeElement(type: NodeType, id: string, name?: string): dia.Element {
  const Ctor = { Bus: BusShape, Gen: GenShape, DG: DgShape, Load: LoadShape }[type];
  const el = new Ctor({ id });
  el.set('jgdoType', type);
  el.set('elec', defaultElec(type));
  el.attr('label/text', name ?? id);
  return el;
}

export function createLink(kind: LinkType, id?: string): dia.Link {
  const link = new shapes.standard.Link(id ? { id } : {});
  link.set('jgdoType', kind);
  link.set('elec', defaultLinkElec(kind));
  styleLink(link);
  return link;
}

/** 依据 kind + status 恢复连线的基础外观（含正交路由；也用于清除结果着色）。 */
export function styleLink(link: dia.Link): void {
  const kind = link.get('jgdoType') as LinkKind;
  if (kind === 'attach') {
    link.router('normal');
    link.connector('normal');
    link.attr({
      line: {
        stroke: '#a8b3c2', strokeWidth: 1.3, strokeDasharray: '2,4',
        sourceMarker: { type: 'none' }, targetMarker: { type: 'none' },
      },
    });
    link.labels([]);
    return;
  }

  link.router('manhattan', { padding: 20, step: 20 });
  link.connector('rounded', { radius: 6 });

  const elec = (link.get('elec') ?? {}) as Record<string, unknown>;
  const closed = (elec.status ?? 'CLOSED') === 'CLOSED';
  link.attr({
    line: {
      stroke: closed ? LINE_COLOR : OPEN_COLOR,
      strokeWidth: 2,
      strokeDasharray: closed ? 'none' : '5,4',
      strokeLinejoin: 'round',
      sourceMarker: { type: 'none' },
      targetMarker: { type: 'none' },
    },
  });

  const labels: dia.Link.Label[] = [];
  if (kind === 'Switch') {
    // 开关刀闸标记：闭合 = 实心方块；断开 = 空心方块 + 斜杠（隔离刀闸意象）
    labels.push({
      position: 0.5,
      markup: [
        { tagName: 'rect', selector: 'box' },
        { tagName: 'text', selector: 'txt' },
      ],
      attrs: {
        box: {
          width: 14, height: 14, x: -7, y: -7, rx: 2, ry: 2,
          fill: closed ? SWITCH_INK : '#ffffff', stroke: SWITCH_INK, strokeWidth: 1.5,
        },
        txt: {
          text: closed ? '' : '╱', fontSize: 12, fontWeight: '700',
          fill: SWITCH_INK, textAnchor: 'middle', textVerticalAnchor: 'middle',
        },
      },
    });
  }
  link.labels(labels);
}
