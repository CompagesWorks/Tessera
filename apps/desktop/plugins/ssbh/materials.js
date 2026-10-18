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

function group(title, rows) {
  if (rows.length === 0) return [];
  const details = document.createElement('details');
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.append(summary, ...rows);
  return [details];
}

function structRows(params, fields, onChange) {
  return params.flatMap((param) => [
    Object.assign(document.createElement('h4'), { textContent: param.param_id }),
    ...fields.map(([key, label, kind]) =>
      fieldRow(label, control(param.data[key], kind, `${param.param_id} ${label}`, (value) => {
        param.data[key] = value;
        onChange(param.param_id);
      })),
    ),
  ]);
}

function materialEditor(entry, t, onChange) {
  const simple = (params, kind) =>
    params.map((param) =>
      fieldRow(param.param_id, control(param.data, kind, param.param_id, (value) => {
        param.data = value;
        onChange(param.param_id);
      })),
    );
  const vectors = entry.vectors.map((param) =>
    fieldRow(
      param.param_id,
      ...['x', 'y', 'z', 'w'].map((axis) =>
        control(param.data[axis], 'number', `${param.param_id} ${axis}`, (value) => {
          param.data[axis] = value;
          onChange(param.param_id);
        }),
      ),
    ),
  );
  return [
    ...group(t('group.textures'), simple(entry.textures, 'text')),
    ...group(t('group.samplers'), structRows(entry.samplers, SAMPLER, onChange)),
    ...group(t('group.floats'), simple(entry.floats, 'number')),
    ...group(t('group.booleans'), simple(entry.booleans, 'bool')),
    ...group(t('group.vectors'), vectors),
    ...group(t('group.blend'), structRows(entry.blend_states, BLEND, onChange)),
    ...group(t('group.rasterizer'), structRows(entry.rasterizer_states, RASTERIZER, onChange)),
  ];
}
