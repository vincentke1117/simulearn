// N-1 开断扫描 + 转供恢复结果视图。
//
// 教学核心：
//   1. 「能供上电 ≠ 供得好」—— IEEE33 的 br-2 开断后可以完全恢复供电（失负荷 3.255 → 0 MW），
//      但恢复后 vmin = 0.746 pu 严重越限。这一行必须让学生一眼看见矛盾。
//   2. 不可恢复的（如 br-1 电源出线）要诚实展示 n_candidates_evaluated：候选联络开关全都试过了，
//      是"没有跨界联络开关"这个拓扑事实，不是"没搜"。
//   3. 后端只搜单条联络开关，且这在数学上是充分的（见表下小字）。
import { esc, fmt, fmtKw, isRestoredButViolated, n1LostLoadCell, restoreCell, N1_OUTCOME_LABEL } from './format';
import type { N1Entry, N1RestorationEntry, N1Result } from '../types';

export interface N1Hooks {
  /** 行 hover → 画布高亮对应支路（离开时传 null）；有转供条目时一并传入用于高亮联络开关。 */
  onHoverBranch(entry: N1Entry | null, restoration?: N1RestorationEntry | null): void;
}

export function renderN1(container: HTMLElement, res: N1Result, hooks: N1Hooks): void {
  const s = res.summary;
  const restoration = res.restoration;
  const restoreById = new Map((restoration ?? []).map((r) => [r.branch, r]));
  const hasRestore = restoration !== undefined && restoration.length > 0;
  container.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'result-head';
  head.innerHTML =
    `<h3>N-1 开断扫描${hasRestore ? ' + 转供恢复' : ''}</h3>` +
    `<span class="muted small">逐条断开在运支路（${s.n_branches} 条），断开后失去与平衡节点连通性的母线记为孤岛，其余做一次 AC 潮流。${
      hasRestore ? '开启转供后，对每条孤岛开断尝试闭合一条常开联络开关并重跑潮流。' : ''
    }</span>`;
  container.appendChild(head);

  const stats = document.createElement('div');
  stats.className = 'stat-grid';
  const conflicts = (restoration ?? []).filter(isRestoredButViolated);
  stats.innerHTML =
    `
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
  ` +
    (hasRestore
      ? `
    <div class="stat stat-good"><span class="stat-label">可转供恢复</span><span class="stat-value">${
      s.n_restorable ?? 0
    }</span><span class="stat-sub">不可恢复 ${s.n_unrestorable ?? 0}</span></div>
    <div class="stat ${conflicts.length ? 'stat-bad' : 'stat-good'}"><span class="stat-label">恢复后越限</span><span class="stat-value">${
      conflicts.length
    }</span><span class="stat-sub">能供上电但不合格</span></div>
  `
      : `
    <div class="stat ${s.n_ok ? 'stat-good' : ''}"><span class="stat-label">正常（收敛）</span><span class="stat-value">${
      s.n_ok
    }</span><span class="stat-sub">不收敛 ${s.n_diverged}</span></div>
  `);
  container.appendChild(stats);

  if (conflicts.length > 0) {
    const warn = document.createElement('p');
    warn.className = 'note-warn';
    const sample = conflicts[0];
    warn.innerHTML =
      `⚠ <strong>能供上电 ≠ 供得好</strong>：有 <strong>${conflicts.length}</strong> 条开断虽然可以靠联络开关<strong>完全恢复供电</strong>` +
      `（失负荷降到 0），但恢复后的运行点<strong>越限</strong>。例如 <code>${esc(sample.branch)}</code>：失负荷 ` +
      `${restoreCell(sample.lost_load_before_mw, 3)} MW → <strong>0</strong>，但闭合 <code>${sample.closed_ties
        .map((t) => esc(t))
        .join(', ')}</code> 之后 vmin = <strong>${restoreCell(sample.vmin_pu, 4)} pu</strong>` +
      `${sample.vmin_bus ? ` @ ${esc(sample.vmin_bus)}` : ''}，${sample.violation_buses.length} 条母线电压越限。` +
      `转供只保证<strong>连通</strong>，不保证<strong>合格</strong> —— 想优化恢复后的运行点，接着跑「🎯 网络重构」。`;
    container.appendChild(warn);
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table hoverable';
  table.innerHTML = hasRestore
    ? `
    <thead><tr>
      <th>断开支路</th><th>结果</th><th>失负荷 (MW)</th><th>孤岛母线</th>
      <th>可恢复？</th><th>闭合联络开关</th><th>恢复后网损 (kW)</th><th>恢复后 vmin (pu)</th>
      <th>越限</th><th>剩余失负荷 (MW)</th><th>说明</th>
    </tr></thead>
    <tbody></tbody>
  `
    : `
    <thead><tr>
      <th>断开支路</th><th>结果</th><th>失负荷 (MW)</th><th>孤岛母线</th>
      <th>网损 (kW)</th><th>最低电压 (pu)</th><th>越限母线</th>
    </tr></thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody') as HTMLElement;

  for (const entry of res.results) {
    const rest = restoreById.get(entry.branch) ?? null;
    const tr = document.createElement('tr');
    const conflict = rest !== null && isRestoredButViolated(rest);
    // row-bad（红底红字）只留给「真的供不上电」：不可恢复 / 不收敛。
    // 可恢复但恢复后越限的行由 row-conflict（橙底 + 左侧橙条）单独表达 ——
    // 两个类同时挂上时 .row-bad 的 color: var(--danger) 不会被 .row-conflict 覆盖，
    // 会得到「橙底红字」这种既不是警示也不是危险的四不像，而且完全依赖 CSS 声明顺序。
    tr.className = [
      entry.outcome !== 'ok' && !rest?.restorable ? 'row-bad' : '',
      conflict ? 'row-conflict' : '',
      entry.branch === s.worst_branch ? 'row-worst' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const outcomeLabel = N1_OUTCOME_LABEL[entry.outcome] ?? entry.outcome;
    const base = `
      <td><code>${esc(entry.branch)}</code></td>
      <td><span class="tag tag-${esc(entry.outcome)}">${esc(outcomeLabel)}</span></td>
      <td>${n1LostLoadCell(entry)}</td>
      <td>${entry.islanded_buses?.length ? `${entry.islanded_buses.length} 条` : '—'}</td>
    `;

    if (hasRestore) {
      // 无转供条目（如 outcome=ok 的开断根本没孤岛）：恢复列一律 '—'，绝不能填 0
      tr.innerHTML =
        base +
        (rest === null
          ? '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td class="muted small">无孤岛，无需转供</td>'
          : `
      <td>${
        rest.restorable
          ? `<span class="tag tag-restorable">${rest.fully_restored ? '完全恢复' : '部分恢复'}</span>`
          : '<span class="tag tag-unrestorable">不可恢复</span>'
      }</td>
      <td class="mono">${rest.closed_ties.length ? rest.closed_ties.map((t) => esc(t)).join(', ') : '—'}</td>
      <td>${rest.loss_mw === null ? '—' : fmt(rest.loss_mw * 1000, 1)}</td>
      <td>${restoreCell(rest.vmin_pu, 4)}${rest.vmin_bus ? ` <span class="muted small">@ ${esc(rest.vmin_bus)}</span>` : ''}</td>
      <td>${
        rest.violated === null
          ? '—'
          : rest.violated
            ? `<span class="tag tag-diverged">越限 ${rest.violation_buses.length}</span>`
            : '<span class="tag tag-ok">合格</span>'
      }</td>
      <td>${restoreCell(rest.lost_load_after_mw, 3)}</td>
      <td class="muted small">${
        rest.reason
          ? `${esc(rest.reason)}（${rest.n_candidates_evaluated} 条候选联络开关全部试过）`
          : conflict
            ? '供上了电，但运行点不合格 → 见上方提示'
            : ''
      }</td>
    `);
    } else {
      tr.innerHTML =
        base +
        `
      <td>${entry.loss_mw === undefined ? '—' : fmt(entry.loss_mw * 1000, 1)}</td>
      <td>${
        entry.vmin_pu === undefined
          ? '—'
          : `${fmt(entry.vmin_pu, 4)}${entry.vmin_bus ? ` @ ${esc(entry.vmin_bus)}` : ''}`
      }</td>
      <td>${entry.violation_buses === undefined ? '—' : entry.violation_buses.length}</td>
    `;
    }

    if (entry.outcome === 'diverged') {
      tr.title = '潮流不收敛：该开断下的失负荷未知（后端未给出 lost_load_mw）';
    }
    if (entry.islanded_buses?.length) {
      tr.title = `孤岛母线：${entry.islanded_buses.join(', ')}`;
    }
    if (rest && !rest.restorable && rest.reason) {
      tr.title = `${rest.reason}\n候选联络开关（${rest.n_candidates_evaluated} 条全部评估过）：${rest.candidate_ties.join(', ')}`;
    }
    tr.addEventListener('mouseenter', () => hooks.onHoverBranch(entry, rest));
    tr.addEventListener('mouseleave', () => hooks.onHoverBranch(null, null));
    tbody.appendChild(tr);
  }
  wrap.appendChild(table);
  container.appendChild(wrap);

  const tip = document.createElement('p');
  tip.className = 'muted small';
  tip.innerHTML = hasRestore
    ? '把鼠标放在表格行上：画布会把<strong style="color:#dc2626">开断的支路</strong>描红、把<strong style="color:#16a34a">闭合的联络开关</strong>描绿，恢复后仍失电的母线淡出。'
    : '把鼠标放在表格行上，画布会高亮该支路并淡出它造成的孤岛区域。';
  container.appendChild(tip);

  if (hasRestore) {
    const depth = document.createElement('p');
    depth.className = 'muted small';
    depth.innerHTML =
      `搜索深度 = ${s.max_search_depth ?? 1}（只尝试闭合<strong>单条</strong>联络开关）。这不是偷懒：删掉一条支路后，网络最多分成` +
      '「带电区」与「孤岛」两块，只有两端<strong>分跨这两块</strong>的联络开关才能把孤岛接回电源 —— 故「存在一条跨界联络开关」是恢复连通的' +
      '<strong>充要条件</strong>，更深的组合搜索找不到单条搜索找不到的解。准入判据为回路数不增（' +
      `基态回路数 n_loops_base = ${s.n_loops_base ?? 0}）。`;
    container.appendChild(depth);
  }
}
