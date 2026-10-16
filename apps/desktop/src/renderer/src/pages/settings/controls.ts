import type { UiProvider } from '../../ui/provider';

export function group(icon: string, title: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tessera-set-group';
  el.innerHTML = `<i class="bi bi-${icon}"></i>`;
  el.append(title);
  return el;
}

export function section(...rows: HTMLElement[]): HTMLElement {
  const el = document.createElement('section');
  el.className = 'tessera-set-section';
  el.append(...rows);
  return el;
}

export function row(title: string, description: string | Node | null, ...controls: Array<Node | string>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tessera-set-row';
  const text = document.createElement('div');
  text.className = 'tessera-set-text';
  const b = document.createElement('b');
  b.textContent = title;
  text.append(b);
  if (description) {
    const span = document.createElement('span');
    span.append(description);
    text.append(span);
  }
  const ctl = document.createElement('div');
  ctl.className = 'tessera-set-control';
  ctl.append(...controls);
  el.append(text, ctl);
  return el;
}

export function toggle(checked: boolean, onChange: (checked: boolean) => void, disabled = false): HTMLElement {
  const label = document.createElement('label');
  label.className = 'atrium-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  const slider = document.createElement('span');
  slider.className = 'atrium-switch-slider';
  label.append(input, slider);
  return label;
}

const lastSegment = new Map<string, string>();

export function segmented(ui: UiProvider, value: string, options: Array<{ value: string; label: string }>, onChange: (value: string) => void): HTMLElement {
  const el = document.createElement('div');
  const key = options.map((o) => o.value).join('|');
  const previous = lastSegment.get(key);
  const from = previous !== undefined && previous !== value && options.some((o) => o.value === previous) ? previous : value;
  lastSegment.set(key, value);
  const control = ui.atrium.segmented(el, {
    value: from,
    options,
    label: options.find((o) => o.value === value)?.label ?? '',
    onChange,
  });
  if (from !== value) requestAnimationFrame(() => requestAnimationFrame(() => control.setValue(value)));
  return el;
}

export function select(ui: UiProvider, value: string, options: Array<{ value: string; label: string }>, onChange: (value: string) => void): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'tessera-set-select';
  const native = document.createElement('select');
  for (const option of options) native.append(new Option(option.label, option.value));
  native.value = value;
  holder.append(native);
  ui.atrium.select(native, { onChange });
  return holder;
}

export function button(label: string, icon: string | null, onClick: () => void, variant: 'primary' | 'secondary' | 'danger' = 'secondary'): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `atrium-btn atrium-btn-${variant === 'danger' ? 'secondary tessera-set-danger' : variant}`;
  if (icon) el.innerHTML = `<i class="bi bi-${icon}"></i>`;
  el.append(label);
  el.addEventListener('click', onClick);
  return el;
}

export function pathBox(value: string, muted = false): HTMLElement {
  const el = document.createElement('span');
  el.className = `tessera-set-path${muted ? ' is-muted' : ''}`;
  el.textContent = value;
  el.title = value;
  return el;
}

export function note(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'tessera-set-note';
  el.textContent = text;
  return el;
}

export function textField(value: string, onCommit: (value: string) => void, options: { placeholder?: string; maxLength?: number; width?: number } = {}): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'atrium-input tessera-set-field';
  el.value = value;
  el.spellcheck = false;
  if (options.placeholder) el.placeholder = options.placeholder;
  if (options.maxLength) el.maxLength = options.maxLength;
  if (options.width) el.style.width = `${options.width}px`;
  el.addEventListener('change', () => onCommit(el.value));
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') el.blur();
  });
  return el;
}

export function numberField(value: number, onCommit: (value: number) => void, options: { min: number; max: number; step: number }): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'number';
  el.className = 'atrium-input tessera-set-field is-number';
  el.min = String(options.min);
  el.max = String(options.max);
  el.step = String(options.step);
  el.value = String(value);
  el.addEventListener('change', () => {
    const next = Number(el.value);
    if (Number.isFinite(next) && next >= options.min && next <= options.max) onCommit(next);
    else el.value = String(value);
  });
  return el;
}
