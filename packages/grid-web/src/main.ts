import './style.css';
import { dia } from '@joint/core';
import {
  ApiError,
  fetchExample,
  fetchExamples,
  runN1,
  runOpf,
  runPf,
  runReconfiguration,
  runShortCircuit,
  runTimeseries,
  runTransient,
} from './api';
import { createBoard } from './board';
import { renderInspector } from './inspector';
import {
  clearPaintedResults,
  highlightBus,
  highlightContingency,
  paintLmp,
  paintResults,
  paintShortCircuit,
  renderPfPanel,
  renderReconfigPanel,
} from './results';
import { esc } from './analyses/format';
import { renderN1 } from './analyses/n1';
import { opfLmpDomain, renderOpf } from './analyses/opf';
import { renderShortCircuit } from './analyses/shortcircuit';
import { renderTimeseries } from './analyses/timeseries';
import { renderTransient } from './analyses/transient';
import { parseLoadScale, parseShortCircuitParams, parseTransientParams, typicalDayScale } from './analyses/params';
import { createNodeElement, NODE_META, styleLink } from './shapes';
import { exportTopology, importTopology, shouldBeSlack } from './topologyio';
import type { AnalysisKind, NodeType, ReconfigResult, Topology } from './types';
import { isDynamicMachine, validateForAnalysis, validateTopology } from './validation';
import { unwrapProjectFile, wrapGridProject } from './envelope';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const DRAFT_KEY = 'slp:grid:draft-v1';
const HISTORY_KEY = 'slp:grid:history-v1';
const ANALYSIS_KEY = 'slp:grid:analysis-v1';
const PARAMS_KEY = 'slp:grid:params-v1';
const ID_PREFIX: Record<NodeType, string> = { Bus: 'bus', Load: 'load', Gen: 'gen', DG: 'dg' };

const ANALYSIS_META: Record<AnalysisKind, { title: string; running: string; hint: string }> = {
  pf: { title: 'AC 潮流', running: 'AC 潮流计算中…', hint: '无需额外参数：直接对当前拓扑求解一次 AC 潮流。' },
  opf: {
    title: '最优潮流 / 经济调度',
    running: '最优潮流求解中（AC-OPF）…',
    hint: '',
  },
  reconfig: {
    title: '网络重构 + DG 优化',
    running: '重构优化中（MINLP 求解，可能需要几十秒）…',
    hint: '无需额外参数：在可开断支路上搜索降损最优的辐射状运行方式。',
  },
  n1: { title: 'N-1 开断扫描', running: 'N-1 扫描中…', hint: '' },
  timeseries: { title: '时序潮流', running: '时序潮流计算中…', hint: '' },
  transient: { title: '暂态稳定', running: '暂态仿真中…', hint: '' },
  shortcircuit: { title: '短路计算', running: '短路计算中…', hint: '' },
};

// ---------------------------------------------------------------- 基础设施

function toast(message: string, kind: 'info' | 'success' | 'error' = 'info', ms = 4200): void {
  const box = document.createElement('div');
  box.className = `toast toast-${kind}`;
  box.textContent = message;
  $('#toast-container').appendChild(box);
  setTimeout(() => box.remove(), ms);
}

interface HistoryEntry {
  ts: string;
  kind: string;
  text: string;
}

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function pushHistory(kind: string, text: string): void {
  const entries = loadHistory();
  entries.unshift({ ts: new Date().toLocaleString(), kind, text });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 15)));
  renderHistory();
}

function renderHistory(): void {
  const list = $('#history-list');
  const entries = loadHistory();
  list.innerHTML = entries.length
    ? entries
        .map(
          // 记录文本里含母线/支路 id（用户可控），必须转义
          (e) =>
            `<li><strong>${esc(e.kind)}</strong> <span class="muted small">${esc(e.ts)}</span><br />${esc(e.text)}</li>`,
        )
        .join('')
    : '<li class="muted">暂无运行记录。</li>';
}

// ---------------------------------------------------------------- 画布与检查器

const board = createBoard($('#canvas'), {
  onSelectionChange(cell) {
    renderInspector($('#inspector-body'), board, cell, {
      onChanged: () => saveDraft(),
      onDelete: () => board.deleteSelection(),
    });
  },
  onGraphChanged() {
    saveDraft();
    $('#canvas-hint').style.display = board.graph.getCells().length ? 'none' : 'block';
    // 学生改了图，参数条里的母线/支路下拉要跟着变
    if (booted) renderParamBar();
  },
});

let booted = false;

function currentMeta(): { baseMVA: number; feeder: string } {
  return { baseMVA: Number(($('#base-mva') as HTMLInputElement).value) || 100, feeder: 'F1' };
}

function saveDraft(): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(exportTopology(board, currentMeta())));
  } catch {
    /* 配额满等情况不致命 */
  }
}

function loadTopology(topo: Topology, source: string): void {
  importTopology(board, topo);
  if (topo.meta?.baseMVA) ($('#base-mva') as HTMLInputElement).value = String(topo.meta.baseMVA);
  clearPaintedResults(board);
  showEmpty();

  // 带动态机组的算例（如 smib）默认切到暂态稳定，并把故障母线预置成机端母线
  const machine = (topo.nodes ?? []).find((n) => (n.type === 'Gen' || n.type === 'DG') && isDynamicMachine(n));
  if (machine) {
    const busId = String(machine.bus ?? '');
    if (busId) paramValues['tr-bus'] = busId;
    setAnalysis('transient');
    toast(`${source} 含动态机组（H/X'd），已切换到「暂态稳定」分析`, 'info', 5000);
  } else if (analysis === 'transient') {
    // 反向也要切：analysis 会从 localStorage 恢复成 transient，此时加载一个没有动态机组的
    // 算例（如 ieee33），点运行只会被前置校验拦下，学生不知道发生了什么。
    setAnalysis('pf');
    toast(`${source} 没有动态机组（缺 H/X'd），已回落到「AC 潮流」分析`, 'info', 5000);
  } else {
    renderParamBar();
  }
  toast(`已加载 ${source}：${topo.nodes?.length ?? 0} 个节点，${topo.links?.length ?? 0} 条支路`, 'success');
}

// ---------------------------------------------------------------- 视图路由（首页 / 编辑器）

function inEditor(): boolean {
  return location.hash.startsWith('#/editor');
}

function route(): void {
  const editor = inEditor();
  ($('#home-view') as HTMLElement).hidden = editor;
  ($('#editor-view') as HTMLElement).hidden = !editor;
  if (editor) {
    // 容器刚从 hidden 恢复，等一帧再适配画布
    requestAnimationFrame(() => board.fitContent());
  }
}

function gotoEditor(): void {
  location.hash = '#/editor';
}

async function renderExampleCards(): Promise<void> {
  const container = $('#example-cards');
  try {
    const examples = await fetchExamples();
    if (examples.length === 0) {
      container.innerHTML = '<p class="muted">未发现内置算例（服务未启动？）</p>';
      return;
    }
    const cards = await Promise.all(
      examples.map(async (ex) => {
        let scale = '';
        try {
          const topo = await fetchExample(ex.name);
          const buses = (topo.nodes ?? []).filter((n) => n.type === 'Bus').length;
          scale = `${buses} 母线 · ${(topo.links ?? []).length} 支路`;
        } catch {
          /* 规模信息可选 */
        }
        return { ...ex, scale };
      }),
    );
    container.innerHTML = '';
    for (const ex of cards) {
      const card = document.createElement('button');
      card.className = 'example-card';
      card.innerHTML = `
        <span class="card-name">${esc(ex.name)}</span>
        <span class="card-desc">${esc(ex.description || ex.feeder || '')}</span>
        <span class="card-meta">${esc(ex.scale)}<span class="card-open">打开 →</span></span>
      `;
      card.addEventListener('click', async () => {
        try {
          gotoEditor();
          loadTopology(await fetchExample(ex.name), `示例 ${ex.name}`);
          saveDraft();
        } catch (err) {
          reportError('加载示例失败', err);
        }
      });
      container.appendChild(card);
    }
  } catch {
    container.innerHTML = '<p class="muted">算例加载失败。</p>';
  }
}

function bindHome(): void {
  $('#home-new').addEventListener('click', () => {
    board.select(null);
    board.graph.clear();
    board.zoomReset();
    saveDraft();
    gotoEditor();
  });
  $('#home-continue').addEventListener('click', gotoEditor);
  $('#home-import').addEventListener('click', () => ($('#file-input') as HTMLInputElement).click());
  $('#btn-home').addEventListener('click', () => {
    location.hash = '';
  });
  window.addEventListener('hashchange', route);
}

// ---------------------------------------------------------------- 元件面板

function renderPalette(): void {
  const palette = $('#palette');
  palette.innerHTML = '<h2>元件库</h2>';
  (Object.keys(NODE_META) as NodeType[]).forEach((type) => {
    const meta = NODE_META[type];
    const item = document.createElement('button');
    item.className = 'palette-item';
    item.innerHTML = `<span class="palette-icon" style="color:${meta.color}">${meta.label}</span><span>${meta.title}</span>`;
    item.title = `点击添加${meta.title}`;
    item.addEventListener('click', () => addNode(type));
    palette.appendChild(item);
  });
  const tip = document.createElement('p');
  tip.className = 'muted small';
  tip.innerHTML = '连线：从母线边缘拖到另一条母线。<br/>挂接：从设备拖到母线。<br/>线路/开关类型在检查器中切换。';
  palette.appendChild(tip);
}

let dropCount = 0;
function addNode(type: NodeType): void {
  const id = board.nextId(ID_PREFIX[type]);
  const el = createNodeElement(type, id);
  const rect = $('#canvas').getBoundingClientRect();
  const local = board.paper.clientToLocalPoint({
    x: rect.left + rect.width / 2 + (dropCount % 3) * 190 - 190,
    y: rect.top + rect.height / 2 + Math.floor(dropCount / 3) * 110 - 110,
  });
  dropCount += 1;
  el.position(local.x, local.y);
  if (type === 'Bus' && shouldBeSlack(board)) {
    const elec = { ...(el.get('elec') as Record<string, unknown>) };
    elec.is_slack = true;
    el.set('elec', elec);
    el.attr('label/text', `${id} ★`);
  }
  board.graph.addCell(el);
  board.select(el);
}

// ---------------------------------------------------------------- 分析类型与参数条

let analysis: AnalysisKind = 'pf';
const paramValues: Record<string, string> = {};
let findCct = false;
// 转供恢复默认开：不开的话 N-1 只会告诉你「32 条全孤岛」，信息量近乎为零。
let n1Restore = true;
let disposeView: (() => void) | null = null;

function loadParams(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '{}') as Record<string, string>;
    Object.assign(paramValues, saved);
    findCct = saved.__find_cct === '1';
    if (saved.__n1_restore !== undefined) n1Restore = saved.__n1_restore === '1';
  } catch {
    /* 损坏则用默认值 */
  }
  const kind = localStorage.getItem(ANALYSIS_KEY) as AnalysisKind | null;
  if (kind && kind in ANALYSIS_META) analysis = kind;
}

function saveParams(): void {
  try {
    localStorage.setItem(
      PARAMS_KEY,
      JSON.stringify({ ...paramValues, __find_cct: findCct ? '1' : '0', __n1_restore: n1Restore ? '1' : '0' }),
    );
    localStorage.setItem(ANALYSIS_KEY, analysis);
  } catch {
    /* 配额满不致命 */
  }
}

const pv = (key: string, fallback: string) => (paramValues[key] !== undefined ? paramValues[key] : fallback);

function topologyOptions(): { buses: string[]; branches: string[]; slack: string | null } {
  const topo = exportTopology(board, currentMeta());
  const buses = topo.nodes.filter((n) => n.type === 'Bus').map((n) => n.id);
  const branches = topo.links.map((l) => l.id);
  const slack = topo.nodes.find((n) => n.type === 'Bus' && n.is_slack)?.id ?? null;
  return { buses, branches, slack };
}

function optionList(values: string[], selected: string, emptyLabel?: string): string {
  const head = emptyLabel !== undefined ? `<option value="">${esc(emptyLabel)}</option>` : '';
  return (
    head +
    values
      // v 是画布里的母线/支路 id：可能来自导入的 json，直插 innerHTML 会被注入
      .map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`)
      .join('')
  );
}

/** 参数条随分析类型切换；下拉里的母线/支路选项从当前画布拓扑动态生成。 */
function renderParamBar(): void {
  const bar = $('#param-bar');
  const { buses, branches } = topologyOptions();
  bar.innerHTML = '';

  if (analysis === 'pf' || analysis === 'reconfig') {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;

  if (analysis === 'opf') {
    // OPF 没有请求级参数：成本曲线是机组自身的属性，在检查器的「发电成本」分节里填。
    bar.innerHTML = `
      <span class="param-title">经济调度</span>
      <span class="param-hint muted small">无需额外参数。发电成本 C(P) = c₂·P² + c₁·P + c₀ 在<strong>检查器 → 选中电源/DG → 「发电成本」</strong>里填；
      留空则按后端默认 c₂=0, c₁=1, c₀=0（各机组同一条成本曲线，经济调度会退化成"随便怎么分摊都一样"）。</span>
    `;
  } else if (analysis === 'n1') {
    bar.innerHTML = `
      <span class="param-title">N-1 参数</span>
      <label class="param param-bool"><input id="n1-restore" type="checkbox" ${
        n1Restore ? 'checked' : ''
      } /> 尝试转供恢复</label>
      <span class="param-hint muted small">勾选后：对每条造成孤岛的开断，尝试闭合<strong>一条</strong>常开联络开关把孤岛接回电源并重跑潮流，
      给出恢复后的网损 / 最低电压 / 是否越限 / 剩余失负荷。不勾选则只做基础开断扫描。</span>
    `;
  } else if (analysis === 'shortcircuit') {
    bar.innerHTML = `
      <span class="param-title">短路参数</span>
      <label class="param"><span class="param-name">故障母线</span>
        <select id="sc-bus">${optionList(buses, pv('sc-bus', ''), '全网扫描（逐母线）')}</select>
      </label>
      <label class="param"><span class="param-name">过渡电阻 z<sub>f</sub> (pu)</span>
        <input id="sc-zf" type="number" step="any" min="0" value="${pv('sc-zf', '0')}" />
      </label>
      <span class="param-hint muted small">z<sub>f</sub> = 0 即金属性短路；平衡节点按理想电源建模，其结果非物理真值。</span>
    `;
  } else if (analysis === 'timeseries') {
    bar.innerHTML = `
      <span class="param-title">时序参数</span>
      <label class="param param-wide"><span class="param-name">负荷倍数序列（1–96 点，正数，逗号/空格分隔）</span>
        <input id="ts-scale" type="text" value="${pv('ts-scale', '0.5, 0.8, 1.0, 1.2')}" />
      </label>
      <button id="ts-typical" class="ghost-btn" type="button">填入典型日 24 点</button>
      <span class="param-hint muted small" id="ts-count"></span>
    `;
  } else if (analysis === 'transient') {
    bar.innerHTML = `
      <span class="param-title">暂态参数</span>
      <label class="param"><span class="param-name">故障母线</span>
        <select id="tr-bus">${optionList(buses, pv('tr-bus', buses[buses.length - 1] ?? ''), '请选择…')}</select>
      </label>
      <label class="param"><span class="param-name">t<sub>fault</sub> (s)</span>
        <input id="tr-tfault" type="number" step="any" min="0" value="${pv('tr-tfault', '0.1')}" />
      </label>
      <label class="param"><span class="param-name">t<sub>clear</sub> (s)</span>
        <input id="tr-tclear" type="number" step="any" min="0" value="${pv('tr-tclear', '0.25')}" />
      </label>
      <label class="param"><span class="param-name">z<sub>f</sub> (pu)</span>
        <input id="tr-zf" type="number" step="any" min="0" value="${pv('tr-zf', '0')}" />
      </label>
      <label class="param"><span class="param-name">跳闸支路</span>
        <select id="tr-trip">${optionList(branches, pv('tr-trip', ''), '不跳闸')}</select>
      </label>
      <label class="param"><span class="param-name">t<sub>stop</sub> (s)</span>
        <input id="tr-tstop" type="number" step="any" min="0" value="${pv('tr-tstop', '3.0')}" />
      </label>
      <label class="param"><span class="param-name">dt (s)</span>
        <input id="tr-dt" type="number" step="any" min="0" value="${pv('tr-dt', '0.001')}" />
      </label>
      <label class="param param-bool"><input id="tr-cct" type="checkbox" ${findCct ? 'checked' : ''} /> 搜索 CCT</label>
    `;
  }

  // 值变化即写回并持久化
  bar.querySelectorAll('input, select').forEach((node) => {
    const input = node as HTMLInputElement | HTMLSelectElement;
    if (input.type === 'checkbox') {
      input.addEventListener('change', () => {
        const checked = (input as HTMLInputElement).checked;
        if (input.id === 'n1-restore') n1Restore = checked;
        else findCct = checked;
        saveParams();
      });
      return;
    }
    input.addEventListener('change', () => {
      paramValues[input.id] = input.value;
      saveParams();
      updateScaleCount();
    });
    input.addEventListener('input', updateScaleCount);
  });

  const typical = bar.querySelector('#ts-typical');
  typical?.addEventListener('click', () => {
    const input = $('#ts-scale') as HTMLInputElement;
    input.value = typicalDayScale().map((v) => v.toFixed(2)).join(', ');
    paramValues['ts-scale'] = input.value;
    saveParams();
    updateScaleCount();
  });
  updateScaleCount();
}

function updateScaleCount(): void {
  const label = document.querySelector('#ts-count');
  const input = document.querySelector('#ts-scale') as HTMLInputElement | null;
  if (!label || !input) return;
  const parsed = parseLoadScale(input.value);
  label.textContent = parsed.ok ? `${parsed.value.length} 个点` : parsed.error;
  label.className = parsed.ok ? 'param-hint muted small' : 'param-hint error-text small';
}

function setAnalysis(kind: AnalysisKind): void {
  const switched = kind !== analysis;
  analysis = kind;
  ($('#analysis-select') as HTMLSelectElement).value = kind;
  $('#dock-title').textContent = `计算结果 — ${ANALYSIS_META[kind].title}`;
  renderParamBar();
  saveParams();
  // 换了分析类型，上一次的画布着色（如短路热力色）与结果面板都不再对应当前标题，必须清掉。
  if (switched && booted) {
    clearPaintedResults(board);
    showEmpty();
  }
}

// ---------------------------------------------------------------- 运行

let running = false;

function setRunning(state: boolean, text = '计算中…'): void {
  running = state;
  ($('#run-overlay') as HTMLElement).hidden = !state;
  $('#run-overlay-text').textContent = text;
  ($('#btn-run') as HTMLButtonElement).disabled = state;
  ($('#btn-run') as HTMLButtonElement).textContent = state ? '⏳ 计算中…' : '▶ 运行';
  if (state) {
    expandDock();
    resetView();
    $('#results-body').innerHTML = `<div class="dock-loading"><div class="spinner"></div><span>${text}</span></div>`;
  }
}

function resetView(): void {
  disposeView?.();
  disposeView = null;
}

function showEmpty(message = '尚未运行计算。选择上方的分析类型，填好参数后点「运行」。'): void {
  resetView();
  $('#results-body').innerHTML = `<p class="muted">${message}</p>`;
}

/** 通用前置校验：拓扑合法性 + 该分析特有的前置条件。 */
function prepareTopology(): Topology | null {
  const topo = exportTopology(board, currentMeta());
  const issues = [...validateTopology(topo), ...validateForAnalysis(topo, analysis)];
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  for (const w of warnings) toast(w.message, 'info', 6000);
  if (errors.length > 0) {
    toast(`存在 ${errors.length} 个问题：${errors[0].message}${errors.length > 1 ? ' …' : ''}`, 'error', 6000);
    expandDock();
    resetView();
    $('#results-body').innerHTML =
      '<p class="muted">请先修复以下问题：</p><ul class="issue-list">' +
      errors.map((e) => `<li>${esc(e.message)}</li>`).join('') +
      '</ul>';
    return null;
  }
  return topo;
}

function paramError(message: string): void {
  toast(message, 'error', 7000);
  expandDock();
  resetView();
  $('#results-body').innerHTML = `<p class="error-text">参数有误</p><p class="muted">${esc(message)}</p>`;
}

async function handleRun(): Promise<void> {
  if (running) return;
  const topo = prepareTopology();
  if (!topo) return;

  const meta = ANALYSIS_META[analysis];
  try {
    switch (analysis) {
      case 'pf': {
        setRunning(true, meta.running);
        const pf = await runPf(topo);
        clearPaintedResults(board);
        paintResults(board, pf);
        resetView();
        renderPfPanel($('#results-body'), pf);
        const lossKw = pf.summary.loss_mw * 1000;
        pushHistory(
          '潮流',
          `网损 ${lossKw.toFixed(1)} kW · 最低电压 ${pf.summary.vmin_pu.toFixed(4)} pu @ ${pf.summary.vmin_bus}`,
        );
        toast(`潮流完成：网损 ${lossKw.toFixed(1)} kW`, 'success');
        break;
      }
      case 'opf': {
        setRunning(true, meta.running);
        const opf = await runOpf(topo);
        clearPaintedResults(board);
        // 支路格式与潮流同构：先用同一套潮流着色画支路方向/负载率，再用 LMP 覆盖母线颜色
        paintResults(board, { status: opf.status, type: opf.type, buses: opf.buses, branches: opf.branches, summary: { loss_mw: opf.summary.loss_mw, vmin_pu: opf.summary.vmin_pu, vmin_bus: opf.summary.vmin_bus, violation_buses: opf.summary.violation_buses, overloaded_branches: opf.summary.overloaded_branches, solve_time_s: opf.summary.solve_time_s, termination_status: opf.summary.termination_status } });
        const domain = opfLmpDomain(opf);
        paintLmp(board, opf.buses, domain);
        resetView();
        renderOpf($('#results-body'), opf, domain);
        const so = opf.summary;
        pushHistory(
          '最优潮流',
          `总成本 ${so.cost_total_yuan_per_h.toFixed(2)} 元/h · 发电 ${so.gen_total_mw.toFixed(3)} MW · LMP ${so.lmp_min_yuan_per_mwh.toFixed(4)} → ${so.lmp_max_yuan_per_mwh.toFixed(4)} 元/MWh`,
        );
        toast(
          `最优潮流完成：${so.cost_total_yuan_per_h.toFixed(2)} 元/h（${so.termination_status}）`,
          'success',
        );
        break;
      }
      case 'reconfig': {
        setRunning(true, meta.running);
        const rc = await runReconfiguration(topo);
        clearPaintedResults(board);
        paintResults(board, rc.pf);
        const statusNow = new Map<string, string>();
        for (const link of board.graph.getLinks()) {
          const kind = link.get('jgdoType');
          if (kind === 'Line' || kind === 'Switch') {
            statusNow.set(String(link.id), String((link.get('elec') as Record<string, unknown>)?.status ?? 'CLOSED'));
          }
        }
        resetView();
        renderReconfigPanel($('#results-body'), rc, statusNow, () => applySchedule(rc));
        const s = rc.summary;
        pushHistory(
          '重构',
          `网损 ${(s.loss_before_mw * 1000).toFixed(1)} → ${(s.loss_after_mw * 1000).toFixed(1)} kW（降 ${s.improvement_pct.toFixed(1)}%）`,
        );
        toast(`重构完成：降损 ${s.improvement_pct.toFixed(1)}%`, 'success');
        break;
      }
      case 'n1': {
        const restore = (($('#n1-restore') as HTMLInputElement | null)?.checked ?? n1Restore) === true;
        setRunning(true, restore ? 'N-1 扫描 + 转供恢复计算中…' : meta.running);
        // ⚠️ 请求体必须是 {topology, restore}；max_ties 已被后端删除，带上直接 422。
        const res = await runN1({ topology: topo, restore });
        clearPaintedResults(board);
        resetView();
        renderN1($('#results-body'), res, {
          onHoverBranch: (entry, rest) => highlightContingency(board, entry, rest),
        });
        disposeView = () => highlightContingency(board, null);
        const rs = res.summary;
        const conflicts = (res.restoration ?? []).filter(
          (r) => r.restorable && r.fully_restored && r.violated === true,
        ).length;
        // 判据必须与 renderN1 的 hasRestore 完全一致（length > 0，不是真值判断）：
        // 全网状拓扑开 restore 但零孤岛时后端给 restoration: []，表格会退回 7 列旧形态，
        // 此处若用真值判断（[] 为真）就会弹一条「可转供恢复 0 / 不可恢复 0」的自相矛盾提示。
        const hasRestore = (res.restoration?.length ?? 0) > 0;
        pushHistory(
          'N-1',
          `${rs.n_branches} 条支路：孤岛 ${rs.n_islanding} · 最大失负荷 ${rs.max_lost_load_mw.toFixed(3)} MW @ ${rs.worst_branch ?? '—'}` +
            (hasRestore ? ` · 可恢复 ${rs.n_restorable ?? 0}/${rs.n_branches}（其中 ${conflicts} 条恢复后越限）` : ''),
        );
        toast(
          hasRestore
            ? `N-1 完成：可转供恢复 ${rs.n_restorable ?? 0} / 不可恢复 ${rs.n_unrestorable ?? 0}${conflicts ? `，${conflicts} 条恢复后越限` : ''}`
            : `N-1 完成：最严重 ${rs.worst_branch ?? '—'}（失负荷 ${rs.max_lost_load_mw.toFixed(3)} MW）`,
          conflicts ? 'info' : 'success',
        );
        break;
      }
      case 'timeseries': {
        const parsed = parseLoadScale(($('#ts-scale') as HTMLInputElement).value);
        if (!parsed.ok) return paramError(parsed.error);
        setRunning(true, `${meta.running}（${parsed.value.length} 点）`);
        const res = await runTimeseries({ topology: topo, load_scale: parsed.value });
        clearPaintedResults(board);
        resetView();
        disposeView = renderTimeseries($('#results-body'), res);
        const violations = res.points.filter((p) => (p.violation_count ?? 0) > 0).length;
        pushHistory(
          '时序',
          `${res.summary.n_points} 点：最大网损 ${
            res.summary.max_loss_mw === null ? '—' : (res.summary.max_loss_mw * 1000).toFixed(1) + ' kW'
          } · 最低电压 ${res.summary.min_vmin_pu === null ? '—' : res.summary.min_vmin_pu.toFixed(4) + ' pu'} · 越限 ${violations} 点`,
        );
        toast(`时序潮流完成：${res.summary.n_points} 点，越限 ${violations} 点`, violations ? 'info' : 'success');
        break;
      }
      case 'shortcircuit': {
        const parsed = parseShortCircuitParams({
          faultBus: ($('#sc-bus') as HTMLSelectElement).value,
          zf: ($('#sc-zf') as HTMLInputElement).value,
        });
        if (!parsed.ok) return paramError(parsed.error);
        setRunning(true, meta.running);
        const res = await runShortCircuit({ topology: topo, ...parsed.value });
        const slack = topologyOptions().slack;
        clearPaintedResults(board);
        paintShortCircuit(board, res, slack);
        resetView();
        renderShortCircuit($('#results-body'), res, slack, { onHoverBus: (bus) => highlightBus(board, bus) });
        disposeView = () => highlightBus(board, null);
        pushHistory(
          '短路',
          `${res.results.length} 个故障点：最大 ${res.summary.max_bus} · 最小 ${res.summary.min_bus}（${res.summary.min_i_f_ka.toFixed(3)} kA）`,
        );
        toast(`短路计算完成：${res.results.length} 个故障点`, 'success');
        break;
      }
      case 'transient': {
        const parsed = parseTransientParams({
          faultBus: ($('#tr-bus') as HTMLSelectElement).value,
          tFault: ($('#tr-tfault') as HTMLInputElement).value,
          tClear: ($('#tr-tclear') as HTMLInputElement).value,
          zf: ($('#tr-zf') as HTMLInputElement).value,
          tripBranch: ($('#tr-trip') as HTMLSelectElement).value,
          tStop: ($('#tr-tstop') as HTMLInputElement).value,
          dt: ($('#tr-dt') as HTMLInputElement).value,
          findCct: ($('#tr-cct') as HTMLInputElement).checked,
        });
        if (!parsed.ok) return paramError(parsed.error);
        setRunning(true, parsed.value.find_cct ? '暂态仿真 + CCT 二分搜索中…' : meta.running);
        const res = await runTransient({ topology: topo, ...parsed.value });
        clearPaintedResults(board);
        resetView();
        disposeView = renderTransient($('#results-body'), res, parsed.value.f_hz);
        pushHistory(
          '暂态',
          `${res.stable ? '稳定' : `失稳 @ ${res.t_unstable_s?.toFixed(3)} s`} · 故障 ${res.fault.bus} · t_clear ${res.fault.t_clear_s.toFixed(3)} s${
            res.cct_s !== null ? ` · CCT ${res.cct_s.toFixed(3)} s` : ''
          }`,
        );
        toast(res.stable ? '暂态仿真完成：系统稳定' : '暂态仿真完成：系统失稳', res.stable ? 'success' : 'error');
        break;
      }
    }
  } catch (err) {
    reportError(`${meta.title}失败`, err);
  } finally {
    setRunning(false);
  }
}

function applySchedule(rc: ReconfigResult): void {
  let changed = 0;
  for (const sw of rc.switch_schedule) {
    const cell = board.graph.getCell(sw.id);
    if (!cell || !cell.isLink()) continue;
    const elec = { ...((cell.get('elec') ?? {}) as Record<string, unknown>) };
    if (elec.status !== sw.status) changed += 1;
    elec.status = sw.status;
    cell.set('elec', elec);
    styleLink(cell as dia.Link);
  }
  saveDraft();
  toast(`已应用开关方案（${changed} 处变化），可重新运行潮流验证`, 'success');
}

/** 后端 422/500 的 message + code + path 必须原样显示给学生，不能吞。 */
function reportError(prefix: string, err: unknown): void {
  const api = err instanceof ApiError ? err : null;
  const detail = api ? api.message : err instanceof Error ? err.message : String(err);
  const meta = [
    // message/code/path 由后端回显，其中 path 常常就是学生自己写的节点 id → 一律转义
    api?.code ? `<span class="err-code">${esc(api.code)}</span>` : '',
    // 注意：grid 后端目前把业务错误也用 HTTP 200 返回（见报告），因此只在真的是 4xx/5xx 时才显示状态码
    api?.httpStatus && api.httpStatus >= 400 ? `<span class="err-code">HTTP ${api.httpStatus}</span>` : '',
    api?.path?.length ? `<span class="muted small">位置：${esc(api.path.join('.'))}</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');
  toast(`${prefix}：${detail}`, 'error', 8000);
  expandDock();
  resetView();
  $('#results-body').innerHTML =
    `<div class="result-error"><p class="error-text">${esc(prefix)}</p>` +
    `<p class="err-msg">${esc(detail)}</p>${meta ? `<p class="err-meta">${meta}</p>` : ''}</div>`;
}

// ---------------------------------------------------------------- 结果面板（底部 dock）

const DEFAULT_DOCK_HEIGHT = 340;
let dockCollapsed = false;

function expandDock(): void {
  if (!dockCollapsed) return;
  toggleDock();
}

function toggleDock(): void {
  dockCollapsed = !dockCollapsed;
  const dock = $('#result-dock');
  dock.classList.toggle('collapsed', dockCollapsed);
  dock.style.height = dockCollapsed ? '' : `${DEFAULT_DOCK_HEIGHT}px`;
  $('#btn-dock-toggle').textContent = dockCollapsed ? '展开 ▴' : '折叠 ▾';
  requestAnimationFrame(() => board.fitContent());
}

function bindDock(): void {
  const dock = $('#result-dock');
  dock.style.height = `${DEFAULT_DOCK_HEIGHT}px`;
  $('#btn-dock-toggle').addEventListener('click', toggleDock);

  // 拖动上边缘调整高度（Simulink 式的可调结果窗）
  const resizer = $('#dock-resizer');
  let drag: { y: number; h: number } | null = null;
  resizer.addEventListener('mousedown', (evt) => {
    drag = { y: (evt as MouseEvent).clientY, h: dock.getBoundingClientRect().height };
    evt.preventDefault();
  });
  document.addEventListener('mousemove', (evt) => {
    if (!drag) return;
    const next = Math.min(window.innerHeight - 220, Math.max(120, drag.h + (drag.y - evt.clientY)));
    dock.style.height = `${next}px`;
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null;
    board.fitContent();
  });
}

// ---------------------------------------------------------------- 工具栏

function bindToolbar(): void {
  $('#btn-run').addEventListener('click', handleRun);
  ($('#analysis-select') as HTMLSelectElement).addEventListener('change', (evt) => {
    setAnalysis((evt.target as HTMLSelectElement).value as AnalysisKind);
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) void handleRun();
  });

  $('#btn-clear-results').addEventListener('click', () => {
    clearPaintedResults(board);
    showEmpty();
  });

  $('#btn-new').addEventListener('click', () => {
    if (board.graph.getCells().length && !window.confirm('清空当前画布？（未导出的改动将丢失）')) return;
    board.select(null);
    board.graph.clear();
    board.zoomReset();
    showEmpty();
    saveDraft();
  });

  $('#btn-export').addEventListener('click', () => {
    const topo = exportTopology(board, currentMeta());
    const stamp = new Date().toISOString().replace(/[.:]/g, '-');
    const envelope = wrapGridProject(`grid-${stamp}`, topo);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulearn-grid-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#btn-import').addEventListener('click', () => ($('#file-input') as HTMLInputElement).click());
  $('#file-input').addEventListener('change', async (evt) => {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const unwrapped = unwrapProjectFile(JSON.parse(await file.text()));
      if (!unwrapped.ok) {
        toast(unwrapped.error, 'error', 7000);
        return;
      }
      gotoEditor();
      loadTopology(unwrapped.topology, file.name);
      saveDraft();
    } catch (err) {
      reportError('导入失败', err);
    }
  });

  $('#btn-zoom-in').addEventListener('click', () => board.zoomIn());
  $('#btn-zoom-out').addEventListener('click', () => board.zoomOut());
  $('#btn-zoom-reset').addEventListener('click', () => board.fitContent());

  $('#base-mva').addEventListener('change', saveDraft);

  document.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Delete' && evt.key !== 'Backspace') return;
    const tag = (document.activeElement?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (evt.key === 'Backspace') evt.preventDefault();
    board.deleteSelection();
  });
}

async function bindExamples(): Promise<void> {
  const select = $('#example-select') as HTMLSelectElement;
  try {
    const examples = await fetchExamples();
    for (const ex of examples) {
      const option = document.createElement('option');
      option.value = ex.name;
      option.textContent = `${ex.name}${ex.description ? ` — ${ex.description}` : ''}`;
      select.appendChild(option);
    }
  } catch {
    /* 服务未起时静默 */
  }
  select.addEventListener('change', async () => {
    const name = select.value;
    select.value = '';
    if (!name) return;
    try {
      loadTopology(await fetchExample(name), `示例 ${name}`);
      saveDraft();
    } catch (err) {
      reportError('加载示例失败', err);
    }
  });
}

// ---------------------------------------------------------------- 启动

function boot(): void {
  renderPalette();
  bindToolbar();
  bindDock();
  bindHome();
  void bindExamples();
  void renderExampleCards();
  renderHistory();
  loadParams();

  const draft = localStorage.getItem(DRAFT_KEY);
  if (draft) {
    try {
      const topo = JSON.parse(draft) as Topology;
      if (topo.nodes?.length) {
        importTopology(board, topo);
        if (topo.meta?.baseMVA) ($('#base-mva') as HTMLInputElement).value = String(topo.meta.baseMVA);
        ($('#home-continue') as HTMLElement).hidden = false;
      }
    } catch {
      /* 草稿损坏则忽略 */
    }
  }
  setAnalysis(analysis);
  $('#canvas-hint').style.display = board.graph.getCells().length ? 'none' : 'block';
  route();
  booted = true;
}

boot();

// 调试/E2E 钩子（浏览器控制台可用）
(window as unknown as Record<string, unknown>).__jgdo = {
  board,
  exportTopology: () => exportTopology(board, currentMeta()),
  setAnalysis: (kind: AnalysisKind) => setAnalysis(kind),
  getAnalysis: () => analysis,
  run: () => handleRun(),
};
