const WRAP = ['Repeat', 'ClampToEdge', 'MirroredRepeat', 'ClampToBorder'];
const BLEND_FACTOR = ['Zero', 'One', 'SourceAlpha', 'DestinationAlpha', 'SourceColor', 'DestinationColor', 'OneMinusSourceAlpha', 'OneMinusDestinationAlpha', 'OneMinusSourceColor', 'OneMinusDestinationColor', 'SourceAlphaSaturate'];
const BLEND_OPERATION = ['Add', 'Subtract', 'ReverseSubtract', 'Minimum', 'Maximum'];

const SAMPLER = [
  ['wraps', 'Wrap S', WRAP],
  ['wrapt', 'Wrap T', WRAP],
  ['wrapr', 'Wrap R', WRAP],
  ['min_filter', 'Min Filter', ['Nearest', 'LinearMipmapLinear', 'LinearMipmapLinear2']],
  ['mag_filter', 'Mag Filter', ['Nearest', 'Linear', 'Linear2']],
  ['max_anisotropy', 'Max Anisotropy', ['One', 'Two', 'Four', 'Eight', 'Sixteen']],
  ['lod_bias', 'LOD Bias'],
];
const BLEND = [
  ['source_color', 'Source Color', BLEND_FACTOR],
  ['color_operation', 'Color Operation', BLEND_OPERATION],
  ['destination_color', 'Destination Color', BLEND_FACTOR],
  ['source_alpha', 'Source Alpha', BLEND_FACTOR],
  ['alpha_operation', 'Alpha Operation', BLEND_OPERATION],
  ['destination_alpha', 'Destination Alpha', BLEND_FACTOR],
  ['alpha_sample_to_coverage', 'Alpha Sample to Coverage', 'bool'],
];
const RASTERIZER = [
  ['fill_mode', 'Fill Mode', ['Line', 'Solid']],
  ['cull_mode', 'Cull Mode', ['Back', 'Front', 'Disabled']],
  ['depth_bias', 'Depth Bias'],
];

function control(value, kind, label, onInput) {
  let input;
  if (Array.isArray(kind)) {
    input = document.createElement('select');
    input.className = 'atrium-input';
    input.append(...[...new Set([...kind, value])].map((option) => new Option(option, option)));
    input.value = value;
    input.addEventListener('change', () => onInput(input.value));
  } else if (kind === 'bool') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onInput(input.checked));
  } else if (kind === 'text') {
    input = document.createElement('input');
    input.className = 'atrium-input';
    input.value = value;
    input.setAttribute('list', 'texture-names');
    input.spellcheck = false;
    input.addEventListener('change', () => input.value.trim() && onInput(input.value.trim()));
  } else {
    input = document.createElement('input');
    input.className = 'atrium-input';
    input.type = 'number';
    input.step = 'any';
    input.value = String(value);
    input.addEventListener('input', () => {
      const number = Number.parseFloat(input.value);
      if (Number.isFinite(number)) onInput(number);
    });
  }
  input.setAttribute('aria-label', label);
  return input;
}

function fieldRow(label, ...inputs) {
  const row = document.createElement('div');
  row.className = 'field';
  const name = document.createElement('span');
  name.textContent = label;
  name.title = label;
  const values = document.createElement('div');
  values.className = 'values';
  values.append(...inputs);
  row.append(name, values);
  return row;
}

function iconButton(icon, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(Object.assign(document.createElement('i'), { className: `bi bi-${icon}` }));
  button.addEventListener('click', onClick);
  return button;
}

function adder(entry, kind, t, rebuild) {
  const free = freeParams(entry, kind);
  if (free.length === 0) return [];
  const select = document.createElement('select');
  select.className = 'atrium-input';
  select.setAttribute('aria-label', t('param.new'));
  select.append(...free.map((id) => new Option(id, id)));
  const row = document.createElement('div');
  row.className = 'adder';
  row.append(select, iconButton('plus-lg', t('param.add'), () => {
    addParam(entry, kind, select.value);
    rebuild();
  }));
  return [row];
}

function materialEditor(entry, t, { change, rebuild, texture }) {
  const remove = (kind, param) => {
    const button = iconButton('trash', t('param.remove', { name: param.param_id }), () => {
      removeParam(entry, kind, param.param_id);
      rebuild();
    });
    button.classList.add('danger');
    return button;
  };
  const set = (param, apply) => (value) => {
    apply(value);
    change(param.param_id);
  };
  const simple = (kind, type) =>
    entry[kind].map((param) => fieldRow(param.param_id, control(param.data, type, param.param_id, set(param, (v) => (param.data = v))), remove(kind, param)));
  const vectors = entry.vectors.map((param) =>
    fieldRow(param.param_id, ...['x', 'y', 'z', 'w'].map((axis) => control(param.data[axis], 'number', `${param.param_id} ${axis}`, set(param, (v) => (param.data[axis] = v)))), remove('vectors', param)),
  );
  const structs = (kind, fields) =>
    entry[kind].flatMap((param) => [
      fieldRow(param.param_id, remove(kind, param)),
      ...fields.map(([key, label, type]) => fieldRow(label, control(param.data[key], type, `${param.param_id} ${label}`, set(param, (v) => (param.data[key] = v))))),
    ]);
  const group = (kind, title, rows) => {
    const details = document.createElement('details');
    details.open = rows.length > 0;
    const summary = document.createElement('summary');
    summary.textContent = `${title} (${entry[kind].length})`;
    details.append(summary, ...rows, ...adder(entry, kind, t, rebuild));
    return details;
  };
  return [
    group('textures', t('group.textures'), entry.textures.map((param) => fieldRow(param.param_id, texture(param.data, param.param_id, set(param, (v) => (param.data = v))), remove('textures', param)))),
    group('samplers', t('group.samplers'), structs('samplers', SAMPLER)),
    group('floats', t('group.floats'), simple('floats', 'number')),
    group('booleans', t('group.booleans'), simple('booleans', 'bool')),
    group('vectors', t('group.vectors'), vectors),
    group('blend_states', t('group.blend'), structs('blend_states', BLEND)),
    group('rasterizer_states', t('group.rasterizer'), structs('rasterizer_states', RASTERIZER)),
  ];
}
