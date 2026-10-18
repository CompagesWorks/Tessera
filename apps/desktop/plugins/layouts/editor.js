const ENUMS = {
  originX: ['Center', 'Left', 'Right'],
  originY: ['Center', 'Top', 'Bottom'],
  lineAlign: ['Unspecified', 'Left', 'Center', 'Right'],
  wrap: ['Clamp', 'Repeat', 'Mirror'],
  filter: ['Near', 'Linear'],
  windowKind: ['Around', 'Horizontal', 'Horizontal (no content)'],
  flip: ['None', 'Flip H', 'Flip V', 'Rotate 90', 'Rotate 180', 'Rotate 270'],
  tev: ['Replace', 'Modulate', 'Add', 'AddSigned', 'Interpolate', 'Subtract', 'AddMultiplicate', 'MultiplicateAdd', 'Overlay', 'Indirect', 'BlendIndirect', 'EachIndirect'],
  compare: ['Never', 'Less', 'LessOrEqual', 'Equal', 'NotEqual', 'GreaterOrEqual', 'Greater', 'Always'],
  blendOp: ['Disable', 'Add', 'Subtract', 'ReverseSubtract', 'SelectMin', 'SelectMax'],
  blendFactor: ['Factor0', 'Factor1', 'DestColor', 'DestInvColor', 'SourceAlpha', 'SourceInvAlpha', 'DestAlpha', 'DestInvAlpha', 'SourceColor', 'SourceInvColor'],
  logic: ['Disable', 'NoOp', 'Clear', 'Set', 'Copy', 'InvCopy', 'Inv', 'And', 'Nand', 'Or', 'Nor', 'Xor', 'Equiv', 'RevAnd', 'InvAnd', 'RevOr', 'InvOr'],
};
const CORNERS = ['corner.tl', 'corner.tr', 'corner.bl', 'corner.br'];
const SIDES = ['side.left', 'side.right', 'side.top', 'side.bottom'];

let activeTab = 'pane';

const num = (value) => String(Math.round(value * 1000) / 1000);
const hexColor = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

function mark(item) {
  showSide('props');
  rows.get(selected)?.classList.remove('is-selected');
  selected = item;
  const row = rows.get(item);
  row?.classList.add('is-selected');
  row?.scrollIntoView({ block: 'nearest' });
}

function setDirty(value) {
  dirty = value;
  saveButton.disabled = revertButton.disabled = !dirty;
}

function changed() {
  setDirty(true);
  rasters.clear();
  scheduleDraw();
}

function element(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, attrs);
  node.append(...children);
  return node;
}

function numberInput(target, key, label, options = {}) {
  const node = element('input', { type: 'number', className: 'atrium-input', value: num(target[key]), step: options.step ?? 1, title: label });
  node.setAttribute('aria-label', label);
  if (options.min !== undefined) node.min = options.min;
  if (options.max !== undefined) node.max = options.max;
  node.addEventListener('input', () => {
    let value = parseFloat(node.value);
    if (!Number.isFinite(value)) return;
    if (options.min !== undefined) value = Math.max(value, options.min);
    if (options.max !== undefined) value = Math.min(value, options.max);
    target[key] = options.integer ? Math.round(value) : value;
    options.after?.();
    changed();
  });
  return node;
}

function checkInput(target, key, label, after) {
  const node = element('input', { type: 'checkbox', checked: Boolean(target[key]) });
  node.setAttribute('aria-label', label);
  node.addEventListener('change', () => {
    target[key] = node.checked;
    after?.();
    changed();
  });
  return node;
}

function textInput(target, key, label, options = {}) {
  const node = element(options.multiline ? 'textarea' : 'input', { className: 'atrium-input', value: target[key] ?? '' });
  if (!options.multiline) node.type = 'text';
  else node.rows = Math.min(Math.max(String(target[key] ?? '').split('\n').length, 2), 8);
  if (options.maxLength) node.maxLength = options.maxLength;
  if (options.disabled) node.disabled = true;
  node.setAttribute('aria-label', label);
  node.addEventListener('input', () => {
    target[key] = node.value;
    options.after?.(node.value);
    changed();
  });
  return node;
}

function choiceInput(target, key, label, options) {
  const node = element('select', { className: 'atrium-input' });
  node.setAttribute('aria-label', label);
  options.forEach((option, index) => node.append(new Option(option, String(index), false, index === target[key])));
  if (target[key] >= options.length) node.append(new Option(`#${target[key]}`, String(target[key]), false, true));
  node.addEventListener('change', () => {
    target[key] = Number(node.value);
    changed();
  });
  return node;
}

function bitsInput(target, key, shift, mask, label, options) {
  const proxy = { value: (target[key] >> shift) & mask };
  const node = choiceInput(proxy, 'value', label, options);
  node.addEventListener('change', () => {
    target[key] = (target[key] & ~(mask << shift)) | ((proxy.value & mask) << shift);
  });
  return node;
}

function colorInput(rgba, label) {
  const picker = element('input', { type: 'color', value: hexColor(rgba.slice(0, 3)) });
  picker.setAttribute('aria-label', label);
  picker.addEventListener('input', () => {
    rgba.splice(0, 3, parseInt(picker.value.slice(1, 3), 16), parseInt(picker.value.slice(3, 5), 16), parseInt(picker.value.slice(5, 7), 16));
    changed();
  });
  const holder = { alpha: rgba[3] };
  const alpha = numberInput(holder, 'alpha', `${label} ${t('prop.alpha')}`, { min: 0, max: 255, integer: true, after: () => (rgba[3] = holder.alpha) });
  return pair(picker, alpha);
}

function pair(...children) {
  return element('span', { className: `pair pair-${children.length}` }, children);
}

function group(title, entries, open = true) {
  const list = element('dl');
  for (const [label, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    list.append(element('dt', { textContent: label }), element('dd', {}, [value]));
  }
  return element('details', { open, className: 'group' }, [element('summary', { textContent: title }), list]);
}

function renderTabs(tabs) {
  const visible = tabs.filter((tab) => tab.content.length);
  const current = visible.find((tab) => tab.id === activeTab) ?? visible[0];
  const bar = element('div', { className: 'tabs' });
  bar.setAttribute('role', 'tablist');
  const panel = element('div', { className: 'tab-panel' });
  panel.setAttribute('role', 'tabpanel');
  for (const tab of visible) {
    const button = element('button', { type: 'button', className: 'tab', textContent: tab.title });
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab === current));
    button.addEventListener('click', () => {
      activeTab = tab.id;
      renderTabs(tabs);
    });
    bar.append(button);
  }
  panel.append(...(current?.content ?? []));
  props.replaceChildren(bar, panel);
}

function details(pairs, extra) {
  props.replaceChildren(group(t('group.info'), pairs.map(([key, value]) => [t(key), value])));
  if (extra) props.append(extra);
}

function syncFields(pane) {
  if (!fields.x) return;
  fields.x.value = num(pane.x);
  fields.y.value = num(pane.y);
}

function editablePane(pane) {
  return pane.at !== undefined && layout.panes.includes(pane);
}

function materialNames(target = layout) {
  return target.materials.map((material, index) => material.name.trim() || `#${index}`);
}

function quadEntries(quad) {
  const entries = quad.colors.map((rgba, i) => [t(CORNERS[i]), colorInput(rgba, t(CORNERS[i]))]);
  entries.push([t('prop.material'), choiceInput(quad, 'material', t('prop.material'), materialNames())]);
  quad.uvs?.forEach((uv, i) => entries.push([`UV ${t(CORNERS[i])}`, pair(numberInput(uv, 0, 'U', { step: 0.01 }), numberInput(uv, 1, 'V', { step: 0.01 }))]));
  return entries;
}

function materialTabs(material) {
  const name = material.name.trim();
  const colors = [
    group(`${t('group.material')} · ${name}`, [
      [t('mat.black'), colorInput(material.black, t('mat.black'))],
      [t('mat.white'), colorInput(material.white, t('mat.white'))],
    ]),
  ];
  if (material.fontShadow) {
    colors.push(group(t('group.fontShadow'), [
      [t('mat.black'), colorInput(material.fontShadow.black, t('mat.black'))],
      [t('mat.white'), colorInput(material.fontShadow.white, t('mat.white'))],
    ]));
  }
  const maps = material.maps.map((map, i) => {
    const transform = material.transforms[i];
    const texture = textures.get(material.textureNames[map.texture]);
    const preview = texture ? element('img', { src: texture.url, className: 'texture small', alt: material.textureNames[map.texture] }) : undefined;
    return group(t('group.texture', { n: i + 1 }), [
      [t('mat.texture'), choiceInput(map, 'texture', t('mat.texture'), material.textureNames)],
      ['', preview],
      [t('mat.wrap'), pair(bitsInput(map, 'flagS', 0, 3, 'U', ENUMS.wrap), bitsInput(map, 'flagT', 0, 3, 'V', ENUMS.wrap))],
      [t('mat.filter'), pair(bitsInput(map, 'flagS', 2, 3, t('mat.filterMin'), ENUMS.filter), bitsInput(map, 'flagT', 2, 3, t('mat.filterMag'), ENUMS.filter))],
      ...(transform
        ? [
            [t('mat.translate'), pair(numberInput(transform, 'x', 'X', { step: 0.01 }), numberInput(transform, 'y', 'Y', { step: 0.01 }))],
            [t('prop.rotation'), numberInput(transform, 'rotation', t('prop.rotation'))],
            [t('prop.scale'), pair(numberInput(transform, 'scaleX', 'X', { step: 0.01 }), numberInput(transform, 'scaleY', 'Y', { step: 0.01 }))],
          ]
        : []),
    ]);
  });
  const blending = [];
  if (material.alphaCompare) {
    blending.push(group(t('group.alphaCompare'), [
      [t('mat.compare'), choiceInput(material.alphaCompare, 'mode', t('mat.compare'), ENUMS.compare)],
      [t('mat.reference'), numberInput(material.alphaCompare, 'value', t('mat.reference'), { step: 0.01, min: 0, max: 1 })],
    ]));
  }
  if (material.blend) {
    blending.push(group(t('group.blend'), [
      [t('mat.blendOp'), choiceInput(material.blend, 'op', t('mat.blendOp'), ENUMS.blendOp)],
      [t('mat.source'), choiceInput(material.blend, 'source', t('mat.source'), ENUMS.blendFactor)],
      [t('mat.dest'), choiceInput(material.blend, 'dest', t('mat.dest'), ENUMS.blendFactor)],
      [t('mat.logic'), choiceInput(material.blend, 'logic', t('mat.logic'), ENUMS.logic)],
    ]));
  }
  const combiners = material.tev.length
    ? [group(t('group.combiner'), material.tev.flatMap((stage, i) => [
        [`${t('mat.stage', { n: i + 1 })} RGB`, choiceInput(stage, 'colorMode', 'RGB', ENUMS.tev)],
        [`${t('mat.stage', { n: i + 1 })} A`, choiceInput(stage, 'alphaMode', 'Alpha', ENUMS.tev)],
      ]))]
    : [];
  return [
    { id: 'colors', title: t('tab.colors'), content: colors },
    { id: 'maps', title: t('tab.textureMaps'), content: maps },
    { id: 'blending', title: t('tab.blending'), content: blending },
    { id: 'combiners', title: t('tab.combiners'), content: combiners },
  ];
}

function selectPane(pane) {
  mark(pane);
  fields = {};
  if (!editablePane(pane)) {
    details([['prop.name', pane.name], ['prop.type', t(`type.${pane.type}`)], ['prop.part', pane.part]]);
    draw();
    return;
  }
  const relabel = () => {
    const label = rows.get(pane);
    if (label) {
      label.lastChild.textContent = pane.name;
      label.classList.toggle('is-hidden', !pane.visible);
    }
  };
  fields.x = numberInput(pane, 'x', 'X');
  fields.y = numberInput(pane, 'y', 'Y');
  const paneGroup = [
    group(`${t(`type.${pane.type}`)} · ${pane.name}`, [
      [t('prop.name'), textInput(pane, 'name', t('prop.name'), { maxLength: 24, after: relabel })],
      [t('prop.visible'), checkInput(pane, 'visible', t('prop.visible'), relabel)],
      [t('prop.influenceAlpha'), checkInput(pane, 'influenceAlpha', t('prop.influenceAlpha'))],
      [t('prop.alpha'), numberInput(pane, 'alpha', t('prop.alpha'), { min: 0, max: 255, integer: true })],
      [t('prop.position'), pair(fields.x, fields.y, numberInput(pane, 'z', 'Z'))],
      [t('prop.rotation'), pair(numberInput(pane, 'rotateX', 'X'), numberInput(pane, 'rotateY', 'Y'), numberInput(pane, 'rotation', 'Z'))],
      [t('prop.scale'), pair(numberInput(pane, 'scaleX', 'X', { step: 0.05 }), numberInput(pane, 'scaleY', 'Y', { step: 0.05 }))],
      [t('prop.size'), pair(numberInput(pane, 'width', t('prop.width')), numberInput(pane, 'height', t('prop.height')))],
      [t('prop.origin'), pair(bitsInput(pane, 'origin', 0, 3, 'X', ENUMS.originX), bitsInput(pane, 'origin', 2, 3, 'Y', ENUMS.originY))],
      [t('prop.parentOrigin'), pair(bitsInput(pane, 'origin', 4, 3, 'X', ENUMS.originX), bitsInput(pane, 'origin', 6, 3, 'Y', ENUMS.originY))],
    ]),
  ];
  const groups = [];
  let material;
  if (pane.picture) {
    groups.push(group(t('group.picture'), quadEntries(pane.picture)));
    material = layout.materials[pane.picture.material];
  }
  if (pane.type === 'text' && pane.textOffset !== undefined) {
    groups.push(
      group(t('group.text'), [
        [t('prop.text'), textInput(pane, 'text', t('prop.text'), { multiline: true })],
        [t('prop.textId'), pane.textId || undefined],
        [t('prop.font'), choiceInput(pane, 'fontIndex', t('prop.font'), layout.fonts)],
        [t('prop.fontSize'), pair(numberInput(pane, 'fontWidth', t('prop.width')), numberInput(pane, 'fontHeight', t('prop.height')))],
        [t('prop.spacing'), pair(numberInput(pane, 'charSpace', t('prop.charSpace'), { step: 0.5 }), numberInput(pane, 'lineSpace', t('prop.lineSpace'), { step: 0.5 }))],
        [t('prop.italic'), numberInput(pane, 'italic', t('prop.italic'), { step: 0.05 })],
        [t('prop.align'), pair(bitsInput(pane, 'textAlign', 0, 3, 'H', ENUMS.originX), bitsInput(pane, 'textAlign', 2, 3, 'V', ENUMS.originY))],
        [t('prop.lineAlign'), choiceInput(pane, 'lineAlign', t('prop.lineAlign'), ENUMS.lineAlign)],
        [t('prop.topColor'), colorInput(pane.topColor, t('prop.topColor'))],
        [t('prop.bottomColor'), colorInput(pane.bottomColor, t('prop.bottomColor'))],
        [t('prop.material'), choiceInput(pane, 'material', t('prop.material'), materialNames())],
      ]),
      group(t('group.shadow'), [
        [t('prop.offset'), pair(numberInput(pane, 'shadowX', 'X'), numberInput(pane, 'shadowY', 'Y'))],
        [t('prop.scale'), pair(numberInput(pane, 'shadowWidth', 'X', { step: 0.05 }), numberInput(pane, 'shadowHeight', 'Y', { step: 0.05 }))],
        [t('prop.topColor'), colorInput(pane.shadowTop, t('prop.topColor'))],
        [t('prop.bottomColor'), colorInput(pane.shadowBottom, t('prop.bottomColor'))],
        [t('prop.italic'), numberInput(pane, 'shadowItalic', t('prop.italic'), { step: 0.05 })],
      ]),
    );
    material = layout.materials[pane.material];
  }
  if (pane.window) {
    const win = pane.window;
    groups.push(
      group(t('group.window'), [
        [t('prop.windowKind'), choiceInput(win, 'kind', t('prop.windowKind'), ENUMS.windowKind)],
        [t('prop.frameSize'), pair(...win.frameSize.map((_, i) => numberInput(win.frameSize, i, t(SIDES[i]), { min: 0, integer: true })))],
        [t('prop.inflation'), pair(...win.inflation.map((_, i) => numberInput(win.inflation, i, t(SIDES[i]), { integer: true })))],
        ...win.frames.map((frame, i) => [t('prop.frame', { n: i + 1 }), pair(choiceInput(frame, 'material', t('prop.material'), materialNames()), choiceInput(frame, 'flip', t('prop.flip'), ENUMS.flip))]),
      ]),
    );
    if (win.content) groups.push(group(t('group.content'), quadEntries(win.content)));
    material = layout.materials[win.content?.material];
  }
  if (pane.partScale) {
    groups.push(group(t('group.part'), [
      [t('prop.part'), `${pane.part}${parts.get(pane.part) ? '' : ` (${t('missing')})`}`],
      [t('prop.magnify'), pair(numberInput(pane.partScale, 0, 'X', { step: 0.05 }), numberInput(pane.partScale, 1, 'Y', { step: 0.05 }))],
    ]));
  }
  renderTabs([
    { id: 'pane', title: t('tab.pane'), content: paneGroup },
    { id: 'type', title: t(`type.${pane.type}`), content: groups },
    ...(material ? materialTabs(material) : []),
  ]);
  draw();
}

function parentOf(target, pane = layout.root) {
  for (const child of pane.children) {
    if (child === target) return pane;
    const found = parentOf(target, child);
    if (found) return found;
  }
  return null;
}

function removePane(pane) {
  if (!pane || pane === layout.root || !editablePane(pane)) return;
  const subtree = (item) => [item, ...item.children.flatMap(subtree)];
  const used = subtree(pane).find((item) => layout.controlNames.has(item.name));
  if (used) return tessera.ui.toast('warning', t('remove.control', { name: used.name }));
  const parent = parentOf(pane);
  if (!parent) return;
  pane.removed = true;
  parent.children = parent.children.filter((child) => child !== pane);
  buildTree();
  selectPane(parent);
  changed();
  tessera.ui.toast('info', t('remove.done', { name: pane.name, count: subtree(pane).length }));
}

async function paneMenu(pane, event) {
  event.preventDefault();
  selectPane(pane);
  if (pane === layout.root || !editablePane(pane)) return;
  const choice = await tessera.ui.contextMenu({ x: event.clientX, y: event.clientY, items: [{ id: 'delete', label: t('remove.button'), icon: 'trash', danger: true }] });
  if (choice === 'delete') removePane(pane);
}

function selectMaterial(material) {
  mark(material);
  fields = {};
  renderTabs(materialTabs(material));
  draw();
}

function selectTexture(name) {
  mark(name);
  fields = {};
  const texture = textures.get(name);
  const image = texture ? element('img', { src: texture.url, className: 'texture', alt: name }) : undefined;
  details(
    [
      ['prop.name', name],
      ['prop.size', texture ? `${texture.size[0]} × ${texture.size[1]}` : t('missing')],
      ['tex.format', texture?.format ?? undefined],
      ['tex.actions', textureActions(name)],
    ],
    image,
  );
  draw();
}
