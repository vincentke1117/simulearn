// 最优潮流 / 经济调度结果视图。
//
// 教学核心（这一屏要把它讲清楚）：
//   1. 未顶限（binding=false）的机组是**边际机组**，它在定价：其边际成本 dC/dP = 2·c2·P + c1
//      恰好等于所在母线的 LMP。表格里把这两个数字并排放，并高亮"相等"这件事。
//   2. 顶限机组（at_pmin / at_pmax）退出定价：它想多发/少发也发不了，边际成本与 LMP 不再相等。
//   3. 径向馈线上 LMP 从电源侧向末端递增，差值就是边际网损分量 —— "电在远处更贵"。
import {
  bindingLabel,
  esc,
  fmt,
  fmtYuan,
  isDefaultCostCurve,
  lmpColor,
  lmpDomain,
  marginalMatchesLmp,
  type LmpDomain,
} from './format';
import type { OpfResult } from '../types';

export function opfLmpDomain(res: OpfResult): LmpDomain | null {
  return lmpDomain(res.buses.map((b) => b.lmp_yuan_per_mwh));
}

export function renderOpf(container: HTMLElement, res: OpfResult, domain: LmpDomain | null): void {
  const s = res.summary;
  const lmpByBus = new Map(res.buses.map((b) => [b.id, b.lmp_yuan_per_mwh]));
  const marginalGens = res.gens.filter((g) => !g.binding);
  const bindingGens = res.gens.filter((g) => g.binding);
  container.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'result-head';
  head.innerHTML =
    '<h3>最优潮流 / 经济调度（AC-OPF）</h3>' +
    '<span class="muted small">目标：min Σ (c₂·P² + c₁·P + c₀)，约束为 AC 潮流方程 + 机组出力上下限 + 母线电压上下限。' +
    'LMP = 该母线有功平衡约束的对偶变量（多发 1 MWh 负荷的系统成本增量）。</span>';
  container.appendChild(head);

  const stats = document.createElement('div');
  stats.className = 'stat-grid';
  const solved = s.termination_status === 'LOCALLY_SOLVED' || s.termination_status === 'OPTIMAL';
  stats.innerHTML = `
    <div class="stat"><span class="stat-label">总发电成本</span><span class="stat-value">${fmtYuan(
      s.cost_total_yuan_per_h,
    )} 元/h</span><span class="stat-sub">${res.gens.length} 台机组</span></div>
    <div class="stat ${solved ? 'stat-good' : 'stat-bad'}"><span class="stat-label">终止状态</span><span class="stat-value">${esc(
      s.termination_status,
    )}</span><span class="stat-sub">求解 ${fmt(s.solve_time_s, 3)} s</span></div>
    <div class="stat"><span class="stat-label">总发电 / 总负荷</span><span class="stat-value">${fmt(
      s.gen_total_mw,
      3,
    )} / ${fmt(s.load_total_mw, 3)} MW</span><span class="stat-sub">网损 ${fmt(s.loss_mw * 1000, 1)} kW</span></div>
    <div class="stat"><span class="stat-label">LMP 区间</span><span class="stat-value">${fmtYuan(
      s.lmp_min_yuan_per_mwh,
      4,
    )} → ${fmtYuan(s.lmp_max_yuan_per_mwh, 4)}</span><span class="stat-sub">最便宜 ${esc(
      s.lmp_min_bus,
    )} · 最贵 ${esc(s.lmp_max_bus)}（元/MWh）</span></div>
  `;
  container.appendChild(stats);

  // ---- LMP 色标图例（退化时说清楚为什么不上色）
  const legend = document.createElement('div');
  if (domain && !domain.flat) {
    legend.className = 'heat-legend';
    legend.innerHTML = `
      <span class="muted small">画布母线着色（LMP）</span>
      <span class="heat-bar"></span>
      <span class="small mono">${fmtYuan(domain.lo, 4)}</span>
      <span class="muted small">→</span>
      <span class="small mono">${fmtYuan(domain.hi, 4)} 元/MWh</span>
      <span class="muted small">极差 ${fmtYuan(domain.hi - domain.lo, 4)} 元/MWh（${(domain.rel * 100).toFixed(
        2,
      )}%）：径向馈线上末端更贵，差值就是边际网损分量。</span>
    `;
  } else {
    legend.className = 'note-flat';
    legend.innerHTML = domain
      ? `全网 LMP 实质相等（${fmtYuan(domain.lo, 4)} → ${fmtYuan(domain.hi, 4)} 元/MWh，相对极差 ${(
          domain.rel * 100
        ).toFixed(4)}%）：无阻塞、网损可忽略 ⇒ 等微增率成立，各机组边际成本被拉平到同一个值。<strong>色标已退化</strong>，画布母线统一中性灰 —— 这里不存在值得上色的价差。`
      : '没有可用的 LMP 数据，画布不做电价着色。';
  }
  container.appendChild(legend);

  // ---- 机组表：边际机组 vs 顶限机组
  const genWrap = document.createElement('div');
  genWrap.className = 'table-scroll';
  const genTable = document.createElement('table');
  genTable.className = 'data-table';
  genTable.innerHTML = `
    <thead><tr>
      <th>机组</th><th>母线</th><th>P (MW)</th><th>Q (MVar)</th><th>出力区间 [Pmin, Pmax]</th>
      <th>c₂</th><th>c₁</th><th>c₀</th>
      <th>成本 (元/h)</th><th>边际成本 (元/MWh)</th><th>母线 LMP (元/MWh)</th><th>是否顶限</th>
    </tr></thead>
    <tbody></tbody>
  `;
  const gbody = genTable.querySelector('tbody') as HTMLElement;
  for (const g of res.gens) {
    const lmp = lmpByBus.get(g.bus);
    const pricing = !g.binding && marginalMatchesLmp(g.marginal_cost_yuan_per_mwh, lmp);
    const defaulted = isDefaultCostCurve(g);
    const tr = document.createElement('tr');
    tr.className = [g.binding ? 'row-binding' : pricing ? 'row-marginal' : '', defaulted ? 'row-defaulted' : '']
      .filter(Boolean)
      .join(' ');
    tr.innerHTML = `
      <td><code>${esc(g.id)}</code>${
        defaulted
          ? ' <span class="tag tag-defaulted" title="该机组没有填写成本系数，后端按默认 c₂=0, c₁=1, c₀=0 处理：它的价格不是真实成本，由此得到的调度/定价结论不成立">默认成本</span>'
          : ''
      }</td>
      <td><code>${esc(g.bus)}</code></td>
      <td>${fmt(g.pg_mw, 3)}</td>
      <td>${fmt(g.qg_mvar, 3)}</td>
      <td class="mono small">[${fmt(g.pmin_mw, 1)}, ${fmt(g.pmax_mw, 1)}]</td>
      <td class="mono small${defaulted ? ' cell-defaulted' : ''}">${fmt(g.cost_c2, 4)}</td>
      <td class="mono small${defaulted ? ' cell-defaulted' : ''}">${fmt(g.cost_c1, 4)}</td>
      <td class="mono small${defaulted ? ' cell-defaulted' : ''}">${fmt(g.cost_c0, 2)}</td>
      <td>${fmtYuan(g.cost_yuan_per_h)}</td>
      <td class="${pricing ? 'cell-pricing' : ''}">${fmtYuan(g.marginal_cost_yuan_per_mwh, 4)}${
        pricing ? ' <span class="eq-mark" title="边际机组：边际成本 = 所在母线 LMP，它在定价">＝</span>' : ''
      }</td>
      <td class="${pricing ? 'cell-pricing' : ''}">${fmtYuan(lmp, 4)}</td>
      <td>${
        g.binding
          ? `<span class="tag tag-binding">${esc(bindingLabel(g))}</span>`
          : '<span class="tag tag-marginal">边际机组（定价）</span>'
      }</td>
    `;
    gbody.appendChild(tr);
  }
  genWrap.appendChild(genTable);

  const genHead = document.createElement('h4');
  genHead.className = 'sub-head';
  genHead.textContent = `机组出力与定价（${res.gens.length}）`;
  container.appendChild(genHead);

  // 「默认成本」告警：后端对没填成本系数的机组硬编码 c₂=0, c₁=1, c₀=0。
  // 只给一台机填成本，是学生最常撞的路径 —— 剩下那台白捡 1 元/MWh 的边际成本（通常全网最便宜），
  // 被优先顶到 Pmax，然后这张表会把这个幻觉包装成一份权威的经济调度结论。必须先拦一句。
  const defaulted = res.gens.filter(isDefaultCostCurve);
  if (defaulted.length > 0) {
    const warn = document.createElement('p');
    warn.className = 'note-warn';
    warn.innerHTML =
      defaulted.length === res.gens.length
        ? `⚠ <strong>全部 ${res.gens.length} 台机组都没有成本系数</strong>，后端按默认 <code>c₂=0, c₁=1, c₀=0</code> 处理：` +
          '各机组成本曲线完全相同，<strong>LMP 的绝对值是归一化出来的假数</strong>（≈1 元/MWh），' +
          '只有母线之间的<strong>相对差</strong>（边际网损分量）有教学意义。想看真正的经济调度，请在检查器「发电成本」里给机组填成本曲线。'
        : `⚠ <strong>机组 ${defaulted
            .map((g) => `<code>${esc(g.id)}</code>`)
            .join('、')} 没有成本系数</strong>，后端按默认 <code>c₂=0, c₁=1, c₀=0</code> 处理 —— ` +
          '它们的边际成本恒为 <strong>1 元/MWh</strong>，通常是全网最便宜，会被优先顶到 Pmax。' +
          '<strong>下面这张表里它们的价格是假的</strong>，由此得到的"谁在定价、谁顶限"的结论不成立。请给所有机组填写成本曲线后重跑。';
    container.appendChild(warn);
  }

  container.appendChild(genWrap);

  const note = document.createElement('p');
  note.className = 'note-teach';
  note.innerHTML =
    `<strong>怎么读这张表：</strong>未顶限的 <strong>${marginalGens.length}</strong> 台机组是<strong>边际机组</strong>，` +
    '它们的边际成本 dC/dP = 2·c₂·P + c₁ <strong>等于所在母线的 LMP</strong>（表中标 <span class="eq-mark">＝</span> 并高亮的两格）——' +
    '系统再多要 1 MWh，就由它们多发，所以它们在定价。' +
    (bindingGens.length
      ? `顶限的 <strong>${bindingGens.length}</strong> 台（${bindingGens
          .map((g) => `<code>${esc(g.id)}</code> ${esc(bindingLabel(g))}`)
          .join('、')}）已经卡在出力边界上，想再增/减出力也不行，<strong>不参与定价</strong>，其边际成本与 LMP 不相等。`
      : '本例没有顶限机组，因此所有机组共同定价（无阻塞时它们的边际成本会被拉平到同一个值 —— 等微增率准则）。');
  container.appendChild(note);

  // ---- 母线表
  const busHead = document.createElement('h4');
  busHead.className = 'sub-head';
  busHead.textContent = `母线电压与节点电价（${res.buses.length}）`;
  container.appendChild(busHead);

  const busWrap = document.createElement('div');
  busWrap.className = 'table-scroll';
  const busTable = document.createElement('table');
  busTable.className = 'data-table';
  busTable.innerHTML = `
    <thead><tr>
      <th></th><th>母线</th><th>Vm (pu)</th><th>Va (°)</th><th>LMP (元/MWh)</th><th>电压区间</th><th>越限</th>
    </tr></thead>
    <tbody></tbody>
  `;
  const bbody = busTable.querySelector('tbody') as HTMLElement;
  for (const b of res.buses) {
    const tr = document.createElement('tr');
    tr.className = b.violation ? 'row-bad' : '';
    tr.innerHTML = `
      <td><span class="swatch" style="background:${lmpColor(b.lmp_yuan_per_mwh, domain)}"></span></td>
      <td><code>${esc(b.id)}</code></td>
      <td>${fmt(b.vm_pu, 4)}</td>
      <td>${fmt(b.va_deg, 3)}</td>
      <td class="mono">${fmtYuan(b.lmp_yuan_per_mwh, 4)}</td>
      <td class="muted small mono">[${fmt(b.vmin_pu, 2)}, ${b.vmax_pu === null ? '—' : fmt(b.vmax_pu, 2)}]</td>
      <td>${b.violation ? `<span class="tag tag-diverged">${esc(b.violation)}</span>` : '—'}</td>
    `;
    bbody.appendChild(tr);
  }
  busWrap.appendChild(busTable);
  container.appendChild(busWrap);

  const tail = document.createElement('p');
  tail.className = 'muted small';
  tail.textContent =
    '支路潮流方向与负载率已画在画布上（与 AC 潮流同一套着色）；母线颜色表示 LMP，越红越贵。';
  container.appendChild(tail);
}
