import { dia } from '@joint/core';
import type { Board } from './board';
import { styleLink } from './shapes';
import { capacitorOptions, tapOptions } from './transformer';

interface FieldDef {
  key: string;
  label: string;
  unit?: string;
  kind: 'number' | 'bool' | 'select' | 'text';
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
  readonly?: boolean;
  help?: string;
  section?: string;
  placeholder?: string;
  /** 选项随当前参数变化（如挡位对应的 kV、电容组投入容量） */
  optionsFrom?: (elec: Record<string, unknown>) => { value: string; label: string }[];
  /** select 的值按数字存（挡位、投入组数） */
  numeric?: boolean;
  /** 改了它，其它字段的选项要跟着变：改完重绘检查器 */
  rerender?: boolean;
}

/** 机电暂态动态参数（Gen/DG 通用，后端 topology.jl 原样透传给 dynamics/shortcircuit）。 */
export const DYNAMIC_DEFAULTS: Record<string, number> = { h_s: 5, xd1_pu: 0.3, d_pu: 0 };

const DYNAMIC_FIELDS: FieldDef[] = [
  {
    key: '__dynamic',
    label: '暂态动态机组',
    kind: 'bool',
    section: '机电暂态参数',
    help: '勾选后该机组参与暂态稳定/短路计算的动态建模；不勾选则视为理想电源（无穷大母线）',
  },
  { key: 'h_s', label: '惯性时间常数 H', unit: 's', kind: 'number', min: 0.001, placeholder: '5' },
  { key: 'xd1_pu', label: "暂态电抗 X'd", unit: 'pu', kind: 'number', min: 0.001, placeholder: '0.3' },
  { key: 'd_pu', label: '阻尼系数 D', unit: 'pu', kind: 'number', min: 0, placeholder: '0' },
];

/**
 * 发电成本曲线 C(P) = c2·P² + c1·P + c0（P 单位 MW），仅最优潮流 / 经济调度用到。
 * 边际成本 dC/dP = 2·c2·P + c1 —— c1 就是边际成本曲线的截距，c2 决定它的斜率。
 * 留空 = 后端默认（c2=0, c1=1, c0=0），即"所有机组同一条平坦成本曲线"，经济调度会退化。
 */
export const COST_DEFAULTS: Record<string, number> = { cost_c2: 0, cost_c1: 1, cost_c0: 0 };

/**
 * min: 0 是**前端有意收紧**，不是照抄后端：活后端实测接受负成本系数
 * （econ2 里把 gen-2 设成 c₁=-5 → HTTP 200，gen-2 被顶到 Pmax，总成本 -399.91 元/h）。
 * 负边际成本在教学上没有对应物，只会让"谁在定价"这条主线彻底崩掉，所以在输入端就拦住。
 */
const COST_FIELDS: FieldDef[] = [
  {
    key: 'cost_c2',
    label: '二次项 c₂',
    unit: '元/MW²h',
    kind: 'number',
    min: 0,
    placeholder: '0',
    section: '发电成本',
    help: 'C(P) = c₂·P² + c₁·P + c₀（P 单位 MW）；边际成本 = 2·c₂·P + c₁。留空按后端默认 c₂=0, c₁=1, c₀=0',
  },
  { key: 'cost_c1', label: '一次项 c₁（边际成本截距）', unit: '元/MWh', kind: 'number', min: 0, placeholder: '1' },
  { key: 'cost_c0', label: '固定项 c₀', unit: '元/h', kind: 'number', min: 0, placeholder: '0' },
];

const BUS_FIELDS: FieldDef[] = [
  { key: 'kv', label: '额定电压', unit: 'kV', kind: 'number', required: true, min: 0.001 },
  { key: 'is_slack', label: '平衡节点', kind: 'bool', help: '全网必须恰有一个平衡节点' },
  { key: 'vm_pu', label: '电压幅值', unit: 'pu', kind: 'number' },
  { key: 'va_deg', label: '电压相角', unit: '°', kind: 'number' },
  { key: 'vmin_pu', label: '电压下限', unit: 'pu', kind: 'number' },
  { key: 'vmax_pu', label: '电压上限', unit: 'pu', kind: 'number' },
];

const LOAD_FIELDS: FieldDef[] = [
  { key: 'bus', label: '所属母线', kind: 'text', readonly: true, help: '从设备拖一条线到母线即可挂接' },
  { key: 'p_kw', label: '有功', unit: 'kW', kind: 'number', required: true },
  { key: 'q_kvar', label: '无功', unit: 'kvar', kind: 'number', required: true },
];

const GEN_FIELDS: FieldDef[] = [
  { key: 'bus', label: '所属母线', kind: 'text', readonly: true, help: '从设备拖一条线到母线即可挂接' },
  { key: 'p_kw', label: '有功出力', unit: 'kW', kind: 'number', required: true },
  { key: 'p_max_kw', label: '有功上限', unit: 'kW', kind: 'number' },
  { key: 'p_min_kw', label: '有功下限', unit: 'kW', kind: 'number' },
  { key: 'q_kvar', label: '无功出力', unit: 'kvar', kind: 'number' },
  { key: 'q_max_kvar', label: '无功上限', unit: 'kvar', kind: 'number' },
  { key: 'q_min_kvar', label: '无功下限', unit: 'kvar', kind: 'number' },
  {
    key: 'status', label: '投运状态', kind: 'select',
    options: [
      { value: '1', label: '投运' },
      { value: '0', label: '停运' },
    ],
  },
  ...COST_FIELDS,
  ...DYNAMIC_FIELDS,
];

const KIND_FIELD: FieldDef = {
  key: '__kind', label: '类型', kind: 'select',
  options: [
    { value: 'Line', label: '线路' },
    { value: 'Switch', label: '开关' },
    { value: 'Transformer', label: '变压器' },
  ],
};

const CAPACITOR_FIELDS: FieldDef[] = [
  { key: 'bus', label: '所属母线', kind: 'text', readonly: true, help: '从设备拖一条线到母线即可挂接' },
  { key: 'q_unit_kvar', label: '每组容量', unit: 'kvar', kind: 'number', required: true, min: 0, rerender: true,
    help: '在母线额定电压下的补偿容量；实际补偿无功随电压平方变化' },
  { key: 'groups', label: '总组数', kind: 'number', required: true, min: 0, rerender: true },
  { key: 'in_service', label: '投入组数', kind: 'select', numeric: true, optionsFrom: capacitorOptions },
];

const TRANSFORMER_FIELDS: FieldDef[] = [
  KIND_FIELD,
  { key: 'hv_kv', label: '高压侧额定电压', unit: 'kV', kind: 'number', required: true, min: 0.001, rerender: true,
    help: '即分接头中心电压；连线起点必须是高压侧母线' },
  { key: 'lv_kv', label: '低压侧额定电压', unit: 'kV', kind: 'number', required: true, min: 0.001, rerender: true },
  { key: 'r_ohm', label: '电阻（归算到高压侧）', unit: 'Ω', kind: 'number', required: true, min: 0 },
  { key: 'x_ohm', label: '电抗（归算到高压侧）', unit: 'Ω', kind: 'number', required: true, min: 0 },
  { key: 'tap_step_pct', label: '每挡调压', unit: '%', kind: 'number', min: 0, rerender: true },
  { key: 'tap_steps', label: '挡数（±）', kind: 'number', min: 0, rerender: true, help: '例如 110±2×2.5% 填 2' },
  { key: 'tap_pos', label: '分接头挡位', kind: 'select', numeric: true, optionsFrom: tapOptions },
  { key: 'rate_mva', label: '额定容量', unit: 'MVA', kind: 'number' },
  {
    key: 'status', label: '运行状态', kind: 'select',
    options: [
      { value: 'CLOSED', label: '投运' },
      { value: 'OPEN', label: '退出' },
    ],
  },
];

const LINK_FIELDS: FieldDef[] = [
  KIND_FIELD,
  { key: 'r_ohm', label: '电阻', unit: 'Ω', kind: 'number', required: true, min: 0 },
  { key: 'x_ohm', label: '电抗', unit: 'Ω', kind: 'number', required: true, min: 0 },
  { key: 'rate_mva', label: '额定容量', unit: 'MVA', kind: 'number' },
  {
    key: 'status', label: '运行状态', kind: 'select',
    options: [
      { value: 'CLOSED', label: '闭合' },
      { value: 'OPEN', label: '断开' },
    ],
  },
  { key: 'switchable', label: '重构时可开断', kind: 'bool', help: '重构优化只会操作可开断的支路' },
];

const TYPE_TITLES: Record<string, string> = {
  Bus: '母线',
  Load: '负荷',
  Gen: '电源',
  DG: '分布式电源',
  Line: '线路',
  Switch: '开关',
  Capacitor: '电容组',
  Transformer: '变压器',
};

export interface InspectorHooks {
  onChanged(): void;
  onDelete(): void;
  /** 嵌入模式锁定拓扑时为 false：不显示「删除」（设计记录 D19） */
  canDelete?: boolean;
}

export function renderInspector(container: HTMLElement, board: Board, cell: dia.Cell | null, hooks: InspectorHooks): void {
  container.replaceChildren();
  if (!cell || !cell.graph) {
    const message = document.createElement('p');
    message.className = 'muted';
    message.textContent = '未选中元件。点击画布中的元件查看/编辑参数。';
    container.appendChild(message);
    return;
  }

  const kind = cell.get('jgdoType') as string;
  if (kind === 'attach') {
    const message = document.createElement('p');
    message.className = 'muted';
    message.textContent =
      hooks.canDelete === false
        ? '设备挂接线（不参与计算）。'
        : '设备挂接线（不参与计算）。删除它可解除设备与母线的挂接。';
    container.appendChild(message);
    if (hooks.canDelete !== false) appendDeleteButton(container, hooks);
    return;
  }

  const fields = cell.isLink()
    ? kind === 'Transformer'
      ? TRANSFORMER_FIELDS
      : LINK_FIELDS
    : kind === 'Capacitor'
      ? CAPACITOR_FIELDS
      : kind === 'Bus'
      ? BUS_FIELDS
      : kind === 'Load'
        ? LOAD_FIELDS
        : GEN_FIELDS;

  const head = document.createElement('div');
  head.className = 'inspector-head';
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = TYPE_TITLES[kind] ?? kind;
  const id = document.createElement('code');
  id.textContent = String(cell.id);
  head.append(chip, id);
  container.appendChild(head);

  if (!cell.isLink()) {
    const nameRow = document.createElement('label');
    nameRow.className = 'field';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'field-label';
    nameLabel.textContent = '名称';
    nameRow.appendChild(nameLabel);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = String(cell.attr('label/text') ?? cell.id).replace(/ ★$/, '');
    nameInput.addEventListener('change', () => {
      const elec = (cell.get('elec') ?? {}) as Record<string, unknown>;
      const star = kind === 'Bus' && elec.is_slack ? ' ★' : '';
      cell.attr('label/text', nameInput.value + star);
      hooks.onChanged();
    });
    nameRow.appendChild(nameInput);
    container.appendChild(nameRow);
  }

  const elec = { ...((cell.get('elec') ?? {}) as Record<string, unknown>) };
  const dynamicOn = elec.h_s !== undefined || elec.xd1_pu !== undefined;

  for (const field of fields) {
    if (field.section) {
      const header = document.createElement('h3');
      header.className = 'field-section';
      header.textContent = field.section;
      container.appendChild(header);
    }
    const row = document.createElement('label');
    row.className = 'field';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'field-label';
    labelSpan.textContent = field.label + (field.unit ? ` (${field.unit})` : '');
    row.appendChild(labelSpan);

    let input: HTMLInputElement | HTMLSelectElement;
    if (field.kind === 'select') {
      input = document.createElement('select');
      for (const opt of field.optionsFrom ? field.optionsFrom(elec) : (field.options ?? [])) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        input.appendChild(option);
      }
      input.value =
        field.key === '__kind' ? String(cell.get('jgdoType')) : String(elec[field.key] ?? field.options?.[0]?.value ?? '');
    } else if (field.kind === 'bool') {
      input = document.createElement('input');
      input.type = 'checkbox';
      (input as HTMLInputElement).checked =
        field.key === '__dynamic' ? dynamicOn : Boolean(elec[field.key]);
      row.classList.add('field-bool');
    } else {
      input = document.createElement('input');
      input.type = field.kind === 'number' ? 'number' : 'text';
      if (field.kind === 'number') (input as HTMLInputElement).step = 'any';
      if (field.placeholder) (input as HTMLInputElement).placeholder = field.placeholder;
      input.value = elec[field.key] === undefined || elec[field.key] === null ? '' : String(elec[field.key]);
      if (field.readonly) {
        input.readOnly = true;
        input.classList.add('readonly');
      }
      // 未启用动态建模时，H / X'd / D 输入框禁用（避免半套参数发给后端）
      if (DYNAMIC_DEFAULTS[field.key] !== undefined && !dynamicOn) input.disabled = true;
    }

    input.addEventListener('change', () => {
      applyFieldChange(board, cell, field, input, hooks);
    });

    row.appendChild(input);
    if (field.help) {
      const help = document.createElement('span');
      help.className = 'field-help';
      help.textContent = field.help;
      row.appendChild(help);
    }
    container.appendChild(row);
  }

  if (hooks.canDelete !== false) appendDeleteButton(container, hooks);
}

function applyFieldChange(
  board: Board,
  cell: dia.Cell,
  field: FieldDef,
  input: HTMLInputElement | HTMLSelectElement,
  hooks: InspectorHooks,
): void {
  const elec = { ...((cell.get('elec') ?? {}) as Record<string, unknown>) };

  if (field.key === '__kind') {
    const kind = input.value as 'Line' | 'Switch' | 'Transformer';
    cell.set('jgdoType', kind);
    if (kind === 'Switch') elec.switchable = true;
    if (kind === 'Transformer') {
      // 额定电压默认取两端母线的电压等级，挡位默认 110±2×2.5% 式的 ±2 挡、0 挡
      const link = cell as dia.Link;
      const kvOf = (el: dia.Element | null) => Number(((el?.get('elec') ?? {}) as Record<string, unknown>).kv);
      const hv = kvOf(link.getSourceElement());
      const lv = kvOf(link.getTargetElement());
      if (elec.hv_kv === undefined && Number.isFinite(hv)) elec.hv_kv = hv;
      if (elec.lv_kv === undefined && Number.isFinite(lv)) elec.lv_kv = lv;
      elec.tap_step_pct ??= 2.5;
      elec.tap_steps ??= 2;
      elec.tap_pos ??= 0;
      elec.switchable = false;
    }
    cell.set('elec', elec);
    styleLink(cell as dia.Link);
    hooks.onChanged();
    rerenderInspector(board, cell, input, hooks);
    return;
  }

  // 暂态动态机组开关：一次性写入/清除 h_s + xd1_pu + d_pu 三件套。
  // 关键：默认 elec 里【不】带这三个键——否则每台电源（含并网点 slack 机）都会被
  // 后端当成同步机建模，SMIB 的"无穷大母线"语义就没了。
  if (field.key === '__dynamic') {
    const on = (input as HTMLInputElement).checked;
    if (on) {
      for (const [key, def] of Object.entries(DYNAMIC_DEFAULTS)) {
        if (elec[key] === undefined) elec[key] = def;
      }
    } else {
      for (const key of Object.keys(DYNAMIC_DEFAULTS)) delete elec[key];
    }
    cell.set('elec', elec);
    hooks.onChanged();
    renderInspector(
      (input.closest('.panel-body') ?? input.parentElement?.parentElement) as HTMLElement,
      board,
      cell,
      hooks,
    );
    return;
  }

  let value: unknown;
  if (field.kind === 'bool') {
    value = (input as HTMLInputElement).checked;
  } else if (field.kind === 'number') {
    const raw = input.value.trim();
    if (raw === '') {
      value = undefined;
    } else {
      const num = Number(raw);
      if (!Number.isFinite(num) || (field.min !== undefined && num < field.min)) {
        input.classList.add('invalid');
        return;
      }
      value = num;
    }
  } else if (field.kind === 'select') {
    value = field.numeric || (field.key === 'status' && cell.isElement()) ? Number(input.value) : input.value;
  } else {
    value = input.value;
  }
  input.classList.remove('invalid');

  if (value === undefined) delete elec[field.key];
  else elec[field.key] = value;

  // 平衡节点唯一：勾选后取消其它母线的 is_slack
  if (field.key === 'is_slack' && value === true) {
    for (const el of board.graph.getElements()) {
      if (el !== cell && el.get('jgdoType') === 'Bus') {
        const other = { ...((el.get('elec') ?? {}) as Record<string, unknown>) };
        if (other.is_slack) {
          other.is_slack = false;
          el.set('elec', other);
          el.attr('label/text', String(el.attr('label/text')).replace(/ ★$/, ''));
        }
      }
    }
  }

  cell.set('elec', elec);

  if (cell.isElement() && cell.get('jgdoType') === 'Bus') {
    const base = String(cell.attr('label/text')).replace(/ ★$/, '');
    cell.attr('label/text', elec.is_slack ? `${base} ★` : base);
  }
  if (cell.isLink()) styleLink(cell as dia.Link);

  hooks.onChanged();
  if (field.rerender) rerenderInspector(board, cell, input, hooks);
}

function rerenderInspector(board: Board, cell: dia.Cell, input: HTMLElement, hooks: InspectorHooks): void {
  renderInspector(
    (input.closest('.panel-body') ?? input.parentElement?.parentElement) as HTMLElement,
    board,
    cell,
    hooks,
  );
}

function appendDeleteButton(container: HTMLElement, hooks: InspectorHooks): void {
  const btn = document.createElement('button');
  btn.className = 'danger';
  btn.textContent = '删除元件';
  btn.addEventListener('click', () => hooks.onDelete());
  container.appendChild(btn);
}
