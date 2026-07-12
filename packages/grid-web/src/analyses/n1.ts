// N-1 开断扫描结果视图。
import { esc, fmt, fmtKw, n1LostLoadCell, N1_OUTCOME_LABEL } from './format';
import type { N1Entry, N1Result } from '../types';

export interface N1Hooks {
  /** 行 hover → 画布高亮对应支路（离开时传 null）。 */
  onHoverBranch(entry: N1Entry | null): void;
}

export function renderN1(container: HTMLElement, res: N1Result, hooks: N1Hooks): void {
  const s = res.summary;
  container.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'result-head';
  head.innerHTML = `<h3>N-1 开断扫描</h3><span class="muted small">逐条断开在运支路（${s.n_branches} 条），断开后失去与平衡节点连通性的母线记为孤岛，其余做一次 AC 潮流。</span>`;
  container.appendChild(head);

  const stats = document.createElement('div');
  stats.className = 'stat-grid';
  stats.innerHTML = `
    <div class="stat stat-bad"><span class="stat-label">最严重支路</span><span class="stat-value">${
      s.worst_branch ? esc(s.worst_branch) : '—'
    }</span><span class="stat-sub">失负荷最大</span></div>
    <div class="stat"><span class="stat-label">最大失负荷</span><span class="stat-value">${fmt(
      s.max_lost_load_mw,
      3,
    )} MW</span><span class="stat-sub">${fmtKw(s.max_lost_load_mw, 0)}</span></div>
    <div class="stat ${s.n_islanding ? 'stat-bad' : ''}"><span class="stat-label">孤岛</span><span class="stat-value">${
      s.n_islanding
    }</span><span class="stat-sub">/ ${s.n_branches} 条</span></div>
    <div class="stat ${s.n_ok ? 'stat-good' : ''}"><span class="stat-label">正常（收敛）</span><span class="stat-value">${
      s.n_ok
    }</span><span class="stat-sub">不收敛 ${s.n_diverged}</span></div>
  `;
  container.appendChild(stats);

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table hoverable';
  table.innerHTML = `
    <thead><tr>
      <th>断开支路</th><th>结果</th><th>失负荷 (MW)</th><th>孤岛母线</th>
      <th>网损 (kW)</th><th>最低电压 (pu)</th><th>越限母线</th>
    </tr></thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody') as HTMLElement;
  for (const entry of res.results) {
    const tr = document.createElement('tr');
    const bad = entry.outcome !== 'ok';
    tr.className = [
      bad ? 'row-bad' : '',
      entry.branch === s.worst_branch ? 'row-worst' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const outcomeLabel = N1_OUTCOME_LABEL[entry.outcome] ?? entry.outcome;
    tr.innerHTML = `
      <td><code>${esc(entry.branch)}</code></td>
      <td><span class="tag tag-${esc(entry.outcome)}">${esc(outcomeLabel)}</span></td>
      <td>${n1LostLoadCell(entry)}</td>
      <td>${entry.islanded_buses?.length ? `${entry.islanded_buses.length} 条` : '—'}</td>
      <td>${entry.loss_mw === undefined ? '—' : fmt(entry.loss_mw * 1000, 1)}</td>
      <td>${
        entry.vmin_pu === undefined
          ? '—'
          : `${fmt(entry.vmin_pu, 4)}${entry.vmin_bus ? ` @ ${esc(entry.vmin_bus)}` : ''}`
      }</td>
      <td>${entry.violation_buses === undefined ? '—' : entry.violation_buses.length}</td>
    `;
    if (entry.outcome === 'diverged') {
      tr.title = '潮流不收敛：该开断下的失负荷未知（后端未给出 lost_load_mw）';
    }
    if (entry.islanded_buses?.length) {
      tr.title = `孤岛母线：${entry.islanded_buses.join(', ')}`;
    }
    tr.addEventListener('mouseenter', () => hooks.onHoverBranch(entry));
    tr.addEventListener('mouseleave', () => hooks.onHoverBranch(null));
    tbody.appendChild(tr);
  }
  wrap.appendChild(table);
  container.appendChild(wrap);

  const tip = document.createElement('p');
  tip.className = 'muted small';
  tip.textContent = '把鼠标放在表格行上，画布会高亮该支路并淡出它造成的孤岛区域。';
  container.appendChild(tip);
}
