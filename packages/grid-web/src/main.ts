import './style.css';
import { dia } from '@joint/core';
import { ApiError, fetchExample, fetchExamples, runPf, runReconfiguration } from './api';
import { createBoard } from './board';
import { renderInspector } from './inspector';
import { clearPaintedResults, paintResults, renderPfPanel, renderReconfigPanel } from './results';
import { createNodeElement, NODE_META, styleLink } from './shapes';
import { exportTopology, importTopology, shouldBeSlack } from './topologyio';
import type { NodeType, ReconfigResult, Topology } from './types';
import { validateTopology } from './validation';
import { unwrapProjectFile, wrapGridProject } from './envelope';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const DRAFT_KEY = 'slp:grid:draft-v1';
const HISTORY_KEY = 'slp:grid:history-v1';
const ID_PREFIX: Record<NodeType, string> = { Bus: 'bus', Load: 'load', Gen: 'gen', DG: 'dg' };

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
        .map((e) => `<li><strong>${e.kind}</strong> <span class="muted small">${e.ts}</span><br />${e.text}</li>`)
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
  },
});

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
  $('#results-body').innerHTML = '<p class="muted">尚未运行计算。</p>';
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
        <span class="card-name">${ex.name}</span>
        <span class="card-desc">${ex.description || ex.feeder || ''}</span>
        <span class="card-meta">${ex.scale}<span class="card-open">打开 →</span></span>
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

// ---------------------------------------------------------------- 运行

let running = false;

function setRunning(state: boolean, text = '计算中…'): void {
  running = state;
  ($('#run-overlay') as HTMLElement).hidden = !state;
  $('#run-overlay-text').textContent = text;
  ($('#btn-run-pf') as HTMLButtonElement).disabled = state;
  ($('#btn-run-opt') as HTMLButtonElement).disabled = state;
}

function prepareTopology(): Topology | null {
  const topo = exportTopology(board, currentMeta());
  const issues = validateTopology(topo);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  for (const w of warnings) toast(w.message, 'info', 6000);
  if (errors.length > 0) {
    toast(`存在 ${errors.length} 个问题：${errors[0].message}${errors.length > 1 ? ' …' : ''}`, 'error', 6000);
    $('#results-body').innerHTML =
      '<p class="muted">请先修复以下问题：</p><ul class="issue-list">' +
      errors.map((e) => `<li>${e.message}</li>`).join('') +
      '</ul>';
    return null;
  }
  return topo;
}

async function handleRunPf(): Promise<void> {
  if (running) return;
  const topo = prepareTopology();
  if (!topo) return;
  setRunning(true, 'AC 潮流计算中…');
  try {
    const pf = await runPf(topo);
    clearPaintedResults(board);
    paintResults(board, pf);
    renderPfPanel($('#results-body'), pf);
    const lossKw = pf.summary.loss_mw * 1000;
    pushHistory('潮流', `网损 ${lossKw.toFixed(1)} kW · 最低电压 ${pf.summary.vmin_pu.toFixed(4)} pu @ ${pf.summary.vmin_bus}`);
    toast(`潮流完成：网损 ${lossKw.toFixed(1)} kW`, 'success');
  } catch (err) {
    reportError('潮流计算失败', err);
  } finally {
    setRunning(false);
  }
}

async function handleRunOpt(): Promise<void> {
  if (running) return;
  const topo = prepareTopology();
  if (!topo) return;
  setRunning(true, '重构优化中（MINLP 求解，可能需要几十秒）…');
  try {
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
    renderReconfigPanel($('#results-body'), rc, statusNow, () => applySchedule(rc));
    const s = rc.summary;
    pushHistory(
      '重构',
      `网损 ${(s.loss_before_mw * 1000).toFixed(1)} → ${(s.loss_after_mw * 1000).toFixed(1)} kW（降 ${s.improvement_pct.toFixed(1)}%）`,
    );
    toast(`重构完成：降损 ${s.improvement_pct.toFixed(1)}%`, 'success');
  } catch (err) {
    reportError('重构优化失败', err);
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

function reportError(prefix: string, err: unknown): void {
  const detail =
    err instanceof ApiError
      ? `${err.message}${err.path ? `（位置：${err.path.join('.')}）` : ''}`
      : err instanceof Error
        ? err.message
        : String(err);
  toast(`${prefix}：${detail}`, 'error', 8000);
  $('#results-body').innerHTML = `<p class="error-text">${prefix}</p><p class="muted">${detail}</p>`;
}

// ---------------------------------------------------------------- 工具栏

function bindToolbar(): void {
  $('#btn-run-pf').addEventListener('click', handleRunPf);
  $('#btn-run-opt').addEventListener('click', handleRunOpt);

  $('#btn-clear-results').addEventListener('click', () => {
    clearPaintedResults(board);
    $('#results-body').innerHTML = '<p class="muted">尚未运行计算。</p>';
  });

  $('#btn-new').addEventListener('click', () => {
    if (board.graph.getCells().length && !window.confirm('清空当前画布？（未导出的改动将丢失）')) return;
    board.select(null);
    board.graph.clear();
    board.zoomReset();
    $('#results-body').innerHTML = '<p class="muted">尚未运行计算。</p>';
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
  bindHome();
  void bindExamples();
  void renderExampleCards();
  renderHistory();

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
  $('#canvas-hint').style.display = board.graph.getCells().length ? 'none' : 'block';
  route();
}

boot();

// 调试/E2E 钩子（浏览器控制台可用）
(window as unknown as Record<string, unknown>).__jgdo = {
  board,
  exportTopology: () => exportTopology(board, currentMeta()),
};
