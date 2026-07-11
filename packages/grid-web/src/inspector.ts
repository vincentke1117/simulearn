import { dia } from '@joint/core';
import type { Board } from './board';
import { styleLink } from './shapes';

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
}

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
];

const LINK_FIELDS: FieldDef[] = [
  {
    key: '__kind', label: '类型', kind: 'select',
    options: [
      { value: 'Line', label: '线路' },
      { value: 'Switch', label: '开关' },
    ],
  },
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
};

export interface InspectorHooks {
  onChanged(): void;
  onDelete(): void;
}

export function renderInspector(container: HTMLElement, board: Board, cell: dia.Cell | null, hooks: InspectorHooks): void {
  container.innerHTML = '';
  if (!cell || !cell.graph) {
    container.innerHTML = '<p class="muted">未选中元件。点击画布中的元件查看/编辑参数。</p>';
    return;
  }

  const kind = cell.get('jgdoType') as string;
  if (kind === 'attach') {
    container.innerHTML = '<p class="muted">设备挂接线（不参与计算）。删除它可解除设备与母线的挂接。</p>';
    appendDeleteButton(container, hooks);
    return;
  }

  const fields = cell.isLink()
    ? LINK_FIELDS
    : kind === 'Bus'
      ? BUS_FIELDS
      : kind === 'Load'
        ? LOAD_FIELDS
        : GEN_FIELDS;

  const head = document.createElement('div');
  head.className = 'inspector-head';
  head.innerHTML = `<span class="chip">${TYPE_TITLES[kind] ?? kind}</span><code>${cell.id}</code>`;
  container.appendChild(head);

  if (!cell.isLink()) {
    const nameRow = document.createElement('label');
    nameRow.className = 'field';
    nameRow.innerHTML = '<span class="field-label">名称</span>';
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

  for (const field of fields) {
    const row = document.createElement('label');
    row.className = 'field';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'field-label';
    labelSpan.textContent = field.label + (field.unit ? ` (${field.unit})` : '');
    row.appendChild(labelSpan);

    let input: HTMLInputElement | HTMLSelectElement;
    if (field.kind === 'select') {
      input = document.createElement('select');
      for (const opt of field.options ?? []) {
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
      (input as HTMLInputElement).checked = Boolean(elec[field.key]);
      row.classList.add('field-bool');
    } else {
      input = document.createElement('input');
      input.type = field.kind === 'number' ? 'number' : 'text';
      if (field.kind === 'number') (input as HTMLInputElement).step = 'any';
      input.value = elec[field.key] === undefined || elec[field.key] === null ? '' : String(elec[field.key]);
      if (field.readonly) {
        input.readOnly = true;
        input.classList.add('readonly');
      }
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

  appendDeleteButton(container, hooks);
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
    const kind = input.value as 'Line' | 'Switch';
    cell.set('jgdoType', kind);
    if (kind === 'Switch' && elec.switchable === undefined) elec.switchable = true;
    if (kind === 'Switch') elec.switchable = true;
    cell.set('elec', elec);
    styleLink(cell as dia.Link);
    hooks.onChanged();
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
    value = field.key === 'status' && cell.isElement() ? Number(input.value) : input.value;
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
}

function appendDeleteButton(container: HTMLElement, hooks: InspectorHooks): void {
  const btn = document.createElement('button');
  btn.className = 'danger';
  btn.textContent = '删除元件';
  btn.addEventListener('click', () => hooks.onDelete());
  container.appendChild(btn);
}
