// 零依赖 SVG 折线图（grid-web 是 vanilla，不引入 plotly/chart.js）。
// 支持：多序列、nice 刻度、坐标轴/网格、图例、hover 十字线读数、竖直标注线、双 y 轴。
// 刻度与映射函数是纯函数，单测在 chart.test.ts。

import { esc } from './analyses/format';

const NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------- 纯函数

/** Heckbert "nice numbers"：把一个区间跨度收敛到 1/2/5×10^k。 */
export function niceNum(range: number, round: boolean): number {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice: number;
  if (round) {
    nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  } else {
    nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  }
  return nice * Math.pow(10, exp);
}

export interface TickScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/** 浮点毛刺清理：按步长的量级四舍五入。 */
function snap(value: number, step: number): number {
  const decimals = Math.min(12, Math.max(0, -Math.floor(Math.log10(step)) + 3));
  return Number(value.toFixed(decimals));
}

/** 给定数据范围返回 nice 刻度（含扩展后的轴端点）。count 是目标刻度数（>=2）。 */
export function niceTicks(min: number, max: number, count = 5): TickScale {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi - lo < 1e-12) {
    // 常数序列（例如 ω(t) 恒为 1.0 pu）：围绕该值撑开一个可读的窗口
    const pad = Math.abs(hi) > 1e-9 ? Math.abs(hi) * 0.05 : 0.5;
    lo -= pad;
    hi += pad;
  }
  const target = Math.max(2, Math.floor(count));
  const step = niceNum((hi - lo) / (target - 1), true);
  const niceMin = snap(Math.floor(lo / step) * step, step);
  const niceMax = snap(Math.ceil(hi / step) * step, step);
  const n = Math.max(1, Math.round((niceMax - niceMin) / step));
  const ticks: number[] = [];
  for (let i = 0; i <= n; i += 1) ticks.push(snap(niceMin + i * step, step));
  return { min: niceMin, max: niceMax, step, ticks };
}

/** 数据域 → 像素域的线性映射（纯函数，退化域返回中点）。 */
export function makeScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-15) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** 数组极值；空数组返回 [0, 1]，非有限值忽略。 */
export function extent(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  return [lo, hi];
}

/** 按刻度步长决定小数位；极大/极小值退化为科学计数。 */
export function formatTick(value: number, step: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  // 与 fmtSci 同阈值：理想电源那种 4.6e5 的数不能把刻度栏撑爆
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-4)) return value.toExponential(1);
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(Math.abs(step) || 1))));
  return value.toFixed(decimals);
}

// ---------------------------------------------------------------- 渲染

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: Array<{ x: number; y: number }>;
  axis?: 'left' | 'right';
  dashed?: boolean;
  unit?: string;
  digits?: number;
}

export interface ChartMarker {
  x: number;
  label: string;
  color?: string;
}

export interface ChartOptions {
  series: ChartSeries[];
  markers?: ChartMarker[];
  xLabel?: string;
  yLabelLeft?: string;
  yLabelRight?: string;
  height?: number;
  xUnit?: string;
  xDigits?: number;
}

const GRID = '#e2e8f0';
const AXIS = '#94a3b8';
const TEXT = '#475569';
const MONO = 'ui-monospace, SFMono-Regular, monospace';

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** 在容器内绘制一张图；容器宽度变化时自动重绘。返回销毁函数。 */
export function mountChart(container: HTMLElement, opts: ChartOptions): () => void {
  let lastWidth = -1;
  const draw = () => {
    const width = Math.max(280, container.clientWidth || 560);
    lastWidth = width;
    container.innerHTML = '';
    container.appendChild(buildChart(width, opts));
  };
  draw();
  const ro = new ResizeObserver(() => {
    const width = Math.max(280, container.clientWidth || 560);
    if (Math.abs(width - lastWidth) > 2) draw();
  });
  ro.observe(container);
  return () => ro.disconnect();
}

function buildChart(width: number, opts: ChartOptions): HTMLElement {
  const height = opts.height ?? 260;
  const hasRight = opts.series.some((s) => s.axis === 'right');
  const m = { top: 16, right: hasRight ? 62 : 18, bottom: 34, left: 62 };
  const plotW = Math.max(40, width - m.left - m.right);
  const plotH = Math.max(40, height - m.top - m.bottom);

  const left = opts.series.filter((s) => s.axis !== 'right');
  const right = opts.series.filter((s) => s.axis === 'right');
  const xs = opts.series.flatMap((s) => s.points.map((p) => p.x));
  const markerXs = (opts.markers ?? []).map((mk) => mk.x);
  const xTicks = niceTicks(...extent([...xs, ...markerXs]), 6);
  const lTicks = niceTicks(...extent(left.flatMap((s) => s.points.map((p) => p.y))), 5);
  const rTicks = niceTicks(...extent(right.flatMap((s) => s.points.map((p) => p.y))), 5);

  const sx = makeScale(xTicks.min, xTicks.max, m.left, m.left + plotW);
  const syL = makeScale(lTicks.min, lTicks.max, m.top + plotH, m.top);
  const syR = makeScale(rTicks.min, rTicks.max, m.top + plotH, m.top);
  const yOf = (s: ChartSeries) => (s.axis === 'right' ? syR : syL);

  const wrap = document.createElement('div');
  wrap.className = 'chart';

  // 图例
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  for (const s of opts.series) {
    const item = document.createElement('span');
    item.className = 'chart-legend-item';
    // 系列 label 里含机组/母线 id（来自用户 json），必须转义
    item.innerHTML = `<i style="background:${s.color};${s.dashed ? 'opacity:.65' : ''}"></i>${esc(s.label)}${
      s.axis === 'right' ? ' <em>(右轴)</em>' : ''
    }`;
    legend.appendChild(item);
  }
  if (opts.series.length > 0) wrap.appendChild(legend);

  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart-svg' }) as SVGSVGElement;

  // 网格 + x 轴刻度
  for (const t of xTicks.ticks) {
    const x = sx(t);
    svg.appendChild(el('line', { x1: x, y1: m.top, x2: x, y2: m.top + plotH, stroke: GRID, 'stroke-width': 1 }));
    const label = el('text', {
      x,
      y: m.top + plotH + 15,
      'text-anchor': 'middle',
      'font-size': 10,
      fill: TEXT,
      'font-family': MONO,
    });
    label.textContent = formatTick(t, xTicks.step);
    svg.appendChild(label);
  }
  // y 轴（左）
  for (const t of lTicks.ticks) {
    const y = syL(t);
    svg.appendChild(el('line', { x1: m.left, y1: y, x2: m.left + plotW, y2: y, stroke: GRID, 'stroke-width': 1 }));
    const label = el('text', {
      x: m.left - 7,
      y: y + 3.5,
      'text-anchor': 'end',
      'font-size': 10,
      fill: TEXT,
      'font-family': MONO,
    });
    label.textContent = formatTick(t, lTicks.step);
    svg.appendChild(label);
  }
  // y 轴（右）
  if (hasRight) {
    for (const t of rTicks.ticks) {
      const y = syR(t);
      const label = el('text', {
        x: m.left + plotW + 7,
        y: y + 3.5,
        'text-anchor': 'start',
        'font-size': 10,
        fill: right[0]?.color ?? TEXT,
        'font-family': MONO,
      });
      label.textContent = formatTick(t, rTicks.step);
      svg.appendChild(label);
    }
  }

  // 轴线
  svg.appendChild(el('line', { x1: m.left, y1: m.top, x2: m.left, y2: m.top + plotH, stroke: AXIS, 'stroke-width': 1 }));
  svg.appendChild(
    el('line', { x1: m.left, y1: m.top + plotH, x2: m.left + plotW, y2: m.top + plotH, stroke: AXIS, 'stroke-width': 1 }),
  );

  // 轴标题
  if (opts.xLabel) {
    const t = el('text', {
      x: m.left + plotW / 2,
      y: height - 2,
      'text-anchor': 'middle',
      'font-size': 10.5,
      fill: TEXT,
    });
    t.textContent = opts.xLabel;
    svg.appendChild(t);
  }
  if (opts.yLabelLeft) {
    const t = el('text', {
      x: 11,
      y: m.top + plotH / 2,
      'text-anchor': 'middle',
      'font-size': 10.5,
      fill: left[0]?.color ?? TEXT,
      transform: `rotate(-90 11 ${m.top + plotH / 2})`,
    });
    t.textContent = opts.yLabelLeft;
    svg.appendChild(t);
  }
  if (opts.yLabelRight && hasRight) {
    const t = el('text', {
      x: width - 8,
      y: m.top + plotH / 2,
      'text-anchor': 'middle',
      'font-size': 10.5,
      fill: right[0]?.color ?? TEXT,
      transform: `rotate(90 ${width - 8} ${m.top + plotH / 2})`,
    });
    t.textContent = opts.yLabelRight;
    svg.appendChild(t);
  }

  // 竖直标注线（暂态：t_fault / t_clear）
  // 标注常常挨得很近（故障 0.10s / 切除 0.25s），同一行会叠字：按各行已占用的右边界换行。
  const labelRowRight: number[] = [];
  for (const mk of opts.markers ?? []) {
    if (!Number.isFinite(mk.x)) continue;
    const x = sx(mk.x);
    const color = mk.color ?? '#dc2626';
    svg.appendChild(
      el('line', {
        x1: x,
        y1: m.top,
        x2: x,
        y2: m.top + plotH,
        stroke: color,
        'stroke-width': 1.2,
        'stroke-dasharray': '5,4',
      }),
    );
    const labelX = x + 3;
    const labelWidth = mk.label.length * 6.6 + 4; // 10px 等宽字体的保守估算
    let row = labelRowRight.findIndex((right) => labelX >= right);
    if (row === -1) row = labelRowRight.length;
    labelRowRight[row] = labelX + labelWidth;
    const label = el('text', {
      x: labelX,
      y: m.top + 10 + row * 13,
      'font-size': 10,
      fill: color,
      'font-family': MONO,
    });
    label.textContent = mk.label;
    svg.appendChild(label);
  }

  // 折线
  for (const s of opts.series) {
    if (s.points.length === 0) continue;
    const y = yOf(s);
    const d = s.points
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)},${y(p.y).toFixed(2)}`)
      .join(' ');
    svg.appendChild(
      el('path', {
        d,
        fill: 'none',
        stroke: s.color,
        'stroke-width': 1.8,
        'stroke-linejoin': 'round',
        ...(s.dashed ? { 'stroke-dasharray': '5,3' } : {}),
      }),
    );
    // 点数少时画数据点，方便读离散算例（时序潮流常常只有几个点）
    if (s.points.length <= 32) {
      for (const p of s.points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        svg.appendChild(el('circle', { cx: sx(p.x), cy: y(p.y), r: 2.6, fill: s.color }));
      }
    }
  }

  // hover 十字线
  const hover = el('g', { visibility: 'hidden' }) as SVGGElement;
  const vline = el('line', { x1: 0, y1: m.top, x2: 0, y2: m.top + plotH, stroke: '#64748b', 'stroke-width': 1 });
  hover.appendChild(vline);
  const dots = opts.series.map((s) => {
    const c = el('circle', { cx: 0, cy: 0, r: 3.6, fill: '#fff', stroke: s.color, 'stroke-width': 2 });
    hover.appendChild(c);
    return c;
  });
  svg.appendChild(hover);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;

  const overlay = el('rect', {
    x: m.left,
    y: m.top,
    width: plotW,
    height: plotH,
    fill: 'transparent',
    cursor: 'crosshair',
  });
  overlay.addEventListener('mousemove', (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = (evt as MouseEvent).clientX - rect.left;
    const scale = rect.width / width || 1;
    const xData = xTicks.min + ((px / scale - m.left) / plotW) * (xTicks.max - xTicks.min);
    hover.setAttribute('visibility', 'visible');
    const rows: string[] = [];
    let xShown = xData;
    opts.series.forEach((s, i) => {
      if (s.points.length === 0) {
        dots[i].setAttribute('visibility', 'hidden');
        return;
      }
      let best = s.points[0];
      for (const p of s.points) {
        if (Math.abs(p.x - xData) < Math.abs(best.x - xData)) best = p;
      }
      if (i === 0) xShown = best.x;
      dots[i].setAttribute('visibility', 'visible');
      dots[i].setAttribute('cx', String(sx(best.x)));
      dots[i].setAttribute('cy', String(yOf(s)(best.y)));
      const digits = s.digits ?? 3;
      rows.push(
        `<span><i style="background:${s.color}"></i>${esc(s.label)}</span><b>${best.y.toFixed(digits)}${
          s.unit ? ` ${s.unit}` : ''
        }</b>`,
      );
    });
    const xPix = sx(xShown);
    vline.setAttribute('x1', String(xPix));
    vline.setAttribute('x2', String(xPix));
    tip.hidden = false;
    tip.innerHTML =
      `<div class="chart-tip-x">${opts.xLabel ? `${opts.xLabel.split(' ')[0]} = ` : ''}${xShown.toFixed(
        opts.xDigits ?? 3,
      )}${opts.xUnit ? ` ${opts.xUnit}` : ''}</div>` + rows.map((r) => `<div class="chart-tip-row">${r}</div>`).join('');
    const tipLeft = Math.min(Math.max(8, xPix * scale + 12), rect.width - 150);
    tip.style.left = `${tipLeft}px`;
    tip.style.top = `${m.top + 6}px`;
  });
  overlay.addEventListener('mouseleave', () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  svg.appendChild(overlay);

  wrap.appendChild(svg);
  wrap.appendChild(tip);
  return wrap;
}
