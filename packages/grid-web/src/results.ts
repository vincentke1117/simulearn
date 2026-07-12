import { dia, highlighters } from '@joint/core';
import type { Board } from './board';
import { esc, heatColor, heatDomain, isIdealSourceRow } from './analyses/format';
import { BUS_FILL, styleLink } from './shapes';
import type { N1Entry, PfResult, ReconfigResult, ShortCircuitResult } from './types';

const fmt = (v: number, digits = 3) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

/** 把潮流结果着色/标注到画布：母线电压、支路潮流与负载率、开断状态。 */
export function paintResults(board: Board, pf: PfResult): void {
  const busById = new Map(pf.buses.map((b) => [b.id, b]));
  const branchById = new Map(pf.branches.map((b) => [b.id, b]));

  for (const el of board.graph.getElements()) {
    if (el.get('jgdoType') !== 'Bus') continue;
    const res = busById.get(String(el.id));
    if (!res) continue;
    const fill = res.violation ? '#dc2626' : res.vm_pu < res.vmin_pu + 0.02 ? '#d97706' : '#16a34a';
    el.attr('body/fill', fill);
    el.attr('result/text', `${fmt(res.vm_pu, 4)} pu ∠${fmt(res.va_deg, 2)}°`);
    el.attr('result/fill', res.violation ? '#dc2626' : '#475569');
  }

  for (const link of board.graph.getLinks()) {
    const kind = link.get('jgdoType');
    if (kind !== 'Line' && kind !== 'Switch') continue;
    const res = branchById.get(String(link.id));
    if (!res) continue;
    if (res.status === 'OPEN') {
      link.attr('line/stroke', '#94a3b8');
      link.attr('line/strokeDasharray', '6,4');
      continue;
    }
    const color = res.overloaded ? '#dc2626' : res.loading_pct > 80 ? '#d97706' : '#2563eb';
    const width = 2 + Math.min(Math.abs(res.loading_pct), 120) / 35;
    link.attr('line/stroke', color);
    link.attr('line/strokeWidth', width);
    link.attr('line/strokeDasharray', 'none');
    // 有功方向：正 = from→to，负 = 反向
    const forward = res.p_mw >= 0;
    link.attr('line/targetMarker', forward ? { type: 'path', d: 'M 10 -5 0 0 10 5 Z', fill: color } : { type: 'none' });
    link.attr('line/sourceMarker', forward ? { type: 'none' } : { type: 'path', d: 'M 10 -5 0 0 10 5 Z', fill: color });

    const labels = link.labels().filter((l) => (l as { attrs?: { box?: unknown } }).attrs?.box !== undefined);
    labels.push({
      position: 0.4,
      attrs: {
        text: {
          text: `${fmt(Math.abs(res.p_mw), 3)} MW · ${fmt(res.loading_pct, 0)}%`,
          fontSize: 10.5,
          fill: color,
          fontFamily: 'ui-monospace, monospace',
        },
        rect: { fill: '#f8fafc', fillOpacity: 0.9 },
      },
    });
    link.labels(labels);
  }
}

/** 清除画布上的结果着色，恢复元件默认外观。 */
export function clearPaintedResults(board: Board): void {
  for (const el of board.graph.getElements()) {
    const view = board.paper.findViewByModel(el);
    if (view) highlighters.stroke.remove(view, CONTINGENCY_HL);
    if (el.get('jgdoType') === 'Bus') {
      el.attr('body/fill', BUS_FILL);
      el.attr('body/opacity', 1);
      el.attr('result/text', '');
      el.attr('result/fill', '#64748b');
    } else {
      el.attr('result/text', '');
    }
  }
  for (const link of board.graph.getLinks()) {
    const view = board.paper.findViewByModel(link);
    if (view) highlighters.stroke.remove(view, CONTINGENCY_HL);
    const kind = link.get('jgdoType');
    if (kind === 'Line' || kind === 'Switch' || kind === 'attach') styleLink(link as dia.Link);
  }
}

/** 短路计算：按 I_f 给母线做热力着色。理想电源（slack 约定）灰显且不参与定标。 */
export function paintShortCircuit(board: Board, sc: ShortCircuitResult, slackBusId: string | null): void {
  const domain = heatDomain(sc.results, slackBusId);
  const byBus = new Map(sc.results.map((r) => [r.bus, r]));
  for (const el of board.graph.getElements()) {
    if (el.get('jgdoType') !== 'Bus') continue;
    const row = byBus.get(String(el.id));
    if (!row) continue;
    const ideal = isIdealSourceRow(row, slackBusId);
    el.attr('body/fill', ideal ? '#cbd5e1' : heatColor(row.i_f_ka, domain));
    el.attr('result/text', ideal ? '理想电源（∞ 短路容量）' : `${fmt(row.i_f_ka, 2)} kA · ${fmt(row.s_sc_mva, 0)} MVA`);
    el.attr('result/fill', ideal ? '#94a3b8' : '#475569');
  }
}

const CONTINGENCY_HL = 'jgdo-contingency';

/** N-1 表格行 hover：高亮被断开的支路，并淡出它造成的孤岛母线。 */
export function highlightContingency(board: Board, entry: N1Entry | null): void {
  for (const cell of board.graph.getCells()) {
    const view = board.paper.findViewByModel(cell);
    if (view) highlighters.stroke.remove(view, CONTINGENCY_HL);
    if (cell.isElement() && cell.get('jgdoType') === 'Bus') cell.attr('body/opacity', 1);
  }
  if (!entry) return;

  const link = board.graph.getCell(entry.branch);
  if (link && link.isLink()) {
    const view = board.paper.findViewByModel(link);
    if (view) {
      highlighters.stroke.add(view, { selector: 'line' }, CONTINGENCY_HL, {
        padding: 5,
        attrs: { stroke: '#dc2626', 'stroke-width': 3, 'stroke-dasharray': '4,3' },
      });
    }
  }
  for (const busId of entry.islanded_buses ?? []) {
    const bus = board.graph.getCell(busId);
    if (bus && bus.isElement()) bus.attr('body/opacity', 0.25);
  }
}

/** 短路表格行 hover：描一圈选中的母线。 */
export function highlightBus(board: Board, busId: string | null): void {
  for (const el of board.graph.getElements()) {
    const view = board.paper.findViewByModel(el);
    if (view) highlighters.stroke.remove(view, CONTINGENCY_HL);
  }
  if (!busId) return;
  const bus = board.graph.getCell(busId);
  if (!bus || !bus.isElement()) return;
  const view = board.paper.findViewByModel(bus);
  if (view) {
    highlighters.stroke.add(view, { selector: 'body' }, CONTINGENCY_HL, {
      padding: 5,
      attrs: { stroke: '#0f172a', 'stroke-width': 2.5 },
    });
  }
}

export function renderPfPanel(container: HTMLElement, pf: PfResult): void {
  const s = pf.summary;
  const violations = s.violation_buses.length;
  const overloads = s.overloaded_branches.length;
  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><span class="stat-label">网损</span><span class="stat-value">${fmt(s.loss_mw * 1000, 1)} kW</span></div>
      <div class="stat"><span class="stat-label">最低电压</span><span class="stat-value">${fmt(s.vmin_pu, 4)} pu</span><span class="stat-sub">@ ${esc(s.vmin_bus)}</span></div>
      <div class="stat ${violations ? 'stat-bad' : 'stat-good'}"><span class="stat-label">电压越限</span><span class="stat-value">${violations}</span></div>
      <div class="stat ${overloads ? 'stat-bad' : 'stat-good'}"><span class="stat-label">支路过载</span><span class="stat-value">${overloads}</span></div>
    </div>
    <p class="muted small">求解 ${fmt(s.solve_time_s, 3)} s · ${esc(s.termination_status)}</p>
    <details>
      <summary>节点电压（${pf.buses.length}）</summary>
      <table><thead><tr><th>母线</th><th>Vm (pu)</th><th>Va (°)</th></tr></thead><tbody>
        ${pf.buses
          .map(
            (b) =>
              `<tr class="${b.violation ? 'row-bad' : ''}"><td>${esc(b.id)}</td><td>${fmt(b.vm_pu, 4)}</td><td>${fmt(b.va_deg, 2)}</td></tr>`,
          )
          .join('')}
      </tbody></table>
    </details>
    <details>
      <summary>支路潮流（${pf.branches.length}）</summary>
      <table><thead><tr><th>支路</th><th>P (MW)</th><th>负载率</th></tr></thead><tbody>
        ${pf.branches
          .map(
            (b) =>
              `<tr class="${b.overloaded ? 'row-bad' : ''}"><td>${esc(b.id)}${b.status === 'OPEN' ? ' <span class="muted">(断开)</span>' : ''}</td><td>${fmt(b.p_mw, 3)}</td><td>${fmt(b.loading_pct, 1)}%</td></tr>`,
          )
          .join('')}
      </tbody></table>
    </details>
  `;
}

export function renderReconfigPanel(
  container: HTMLElement,
  rc: ReconfigResult,
  currentStatus: Map<string, string>,
  onApply: () => void,
): void {
  const s = rc.summary;
  const changed = rc.switch_schedule.filter((sw) => currentStatus.get(sw.id) !== sw.status);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><span class="stat-label">重构前网损</span><span class="stat-value">${fmt(s.loss_before_mw * 1000, 1)} kW</span></div>
      <div class="stat"><span class="stat-label">重构后网损</span><span class="stat-value">${fmt(s.loss_after_mw * 1000, 1)} kW</span></div>
      <div class="stat stat-good"><span class="stat-label">降损</span><span class="stat-value">${fmt(s.improvement_pct, 1)}%</span></div>
      <div class="stat"><span class="stat-label">状态变化</span><span class="stat-value">${changed.length}</span></div>
    </div>
    <details open>
      <summary>开关方案（${rc.switch_schedule.length}）</summary>
      <table><thead><tr><th>支路</th><th>状态</th></tr></thead><tbody>
        ${rc.switch_schedule
          .map((sw) => {
            const isChanged = currentStatus.get(sw.id) !== sw.status;
            return `<tr class="${isChanged ? 'row-changed' : ''}"><td>${esc(sw.id)}</td><td>${sw.status === 'CLOSED' ? '闭合' : '断开'}${isChanged ? ' ←' : ''}</td></tr>`;
          })
          .join('')}
      </tbody></table>
    </details>
    <details>
      <summary>DG 出力（${rc.dg_dispatch.length}）</summary>
      <table><thead><tr><th>机组</th><th>P (MW)</th><th>Q (MVar)</th></tr></thead><tbody>
        ${rc.dg_dispatch.map((g) => `<tr><td>${esc(g.id)}</td><td>${fmt(g.p_mw, 3)}</td><td>${fmt(g.q_mvar, 3)}</td></tr>`).join('')}
      </tbody></table>
    </details>
  `;
  const applyBtn = document.createElement('button');
  applyBtn.className = 'primary';
  applyBtn.textContent = `应用开关方案到画布（${changed.length} 处变化）`;
  applyBtn.addEventListener('click', onApply);
  wrapper.appendChild(applyBtn);
  container.innerHTML = '';
  container.appendChild(wrapper);
}
