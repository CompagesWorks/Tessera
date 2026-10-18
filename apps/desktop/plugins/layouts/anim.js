const animPicker = document.getElementById('anim');
const playButton = document.getElementById('play');
const frameSlider = document.getElementById('frame');
let animation = null;
let frame = 0;
let playing = 0;
let animationsReady = Promise.resolve();

function showAnimation() {
  playButton.hidden = frameSlider.hidden = !animation;
  frameSlider.max = animation?.frames ?? 0;
  frameSlider.value = frame;
}

async function loadAnimations(blyt) {
  stopAnimation();
  animation = null;
  frame = 0;
  showAnimation();
  animPicker.hidden = true;
  if (!blyt) return;
  const name = blyt.slice(blyt.lastIndexOf('/') + 1).replace(BFLYT, '');
  const files = (await tessera.files.list(`${folderOf(folderOf(blyt))}/anim`).catch(() => [])).filter((entry) => /\.bflan$/i.test(entry.name) && entry.name.startsWith(`${name}_`));
  if (blyt !== path) return;
  animPicker.replaceChildren(new Option(t('anim.none'), ''), ...files.map((entry) => new Option(entry.name.slice(name.length + 1).replace(/\.bflan$/i, ''), entry.path)));
  animPicker.hidden = !files.length;
}

function playAnimation() {
  if (frame >= animation.frames) frame = 0;
  let last = performance.now();
  const step = (now) => {
    frame += (now - last) * 0.06;
    last = now;
    if (frame >= animation.frames) {
      if (!animation.loop) {
        frame = animation.frames;
        stopAnimation();
      } else frame %= Math.max(animation.frames, 1);
    }
    frameSlider.value = frame;
    draw();
    if (playing) playing = requestAnimationFrame(step);
  };
  playing = requestAnimationFrame(step);
  playButton.innerHTML = '<i class="bi bi-pause-fill"></i>';
}

function stopAnimation() {
  cancelAnimationFrame(playing);
  playing = 0;
  playButton.innerHTML = '<i class="bi bi-play-fill"></i>';
}

function pose() {
  if (!animation) return () => {};
  const undo = [];
  const set = (owner, key, value) => {
    undo.push([owner, key, owner[key]]);
    owner[key] = value;
  };
  for (const entry of animation.entries) {
    const owners = entry.target === 1 ? layout.materials.filter((material) => material.name.trim() === entry.name) : layout.panes.filter((pane) => pane.name === entry.name);
    for (const owner of owners) {
      for (const { tag, curves } of entry.tags) {
        for (const curve of curves) {
          const value = sampleCurve(curve, frame);
          const quad = owner.picture ?? owner.window?.content;
          if (tag === 'FLPA' && PANE_CURVES[curve.target]) set(owner, PANE_CURVES[curve.target], value);
          else if (tag === 'FLVI') set(owner, 'visible', value !== 0);
          else if (tag === 'FLVC' && curve.target === 16) set(owner, 'alpha', value);
          else if (tag === 'FLVC' && owner.type === 'text' && curve.target < 16) {
            const key = curve.target < 8 ? 'topColor' : 'bottomColor';
            set(owner, key, Object.assign((owner[key] ?? [255, 255, 255, 255]).slice(), { [curve.target & 3]: value }));
          } else if (tag === 'FLVC' && quad && curve.target < 16) set(quad, 'colors', quad.colors.map((color, i) => (i === curve.target >> 2 ? Object.assign(color.slice(), { [curve.target & 3]: value }) : color)));
          else if (tag === 'FLMC' && curve.target < 8) {
            const key = curve.target < 4 ? 'black' : 'white';
            set(owner, key, Object.assign(owner[key].slice(), { [curve.target & 3]: value }));
          } else if (tag === 'FLTS' && owner.transforms?.[curve.index] && TEXTURE_CURVES[curve.target]) {
            set(owner, 'transforms', owner.transforms.map((item, i) => (i === curve.index ? { ...item, [TEXTURE_CURVES[curve.target]]: value } : item)));
          } else if (tag === 'FLTP' && owner.maps?.[curve.index] && animation.textures[value]) {
            set(owner, 'maps', owner.maps.map((item, i) => (i === curve.index ? { ...item, name: animation.textures[value] } : item)));
          }
        }
      }
    }
  }
  return () => {
    for (const [owner, key, value] of undo.reverse()) owner[key] = value;
  };
}

animPicker.addEventListener('change', async () => {
  stopAnimation();
  animation = null;
  frame = 0;
  try {
    if (animPicker.value) animation = readBflan(await tessera.files.readBytes(animPicker.value));
    if (animation?.textures.length) loadTextures(animation.textures, timgFolder, scheduleDraw);
  } catch (error) {
    failed(error);
  }
  showAnimation();
  scheduleDraw();
});

async function openAnimation(file) {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const owner = (await tessera.files.list(`${folderOf(folderOf(file))}/blyt`).catch(() => []))
    .filter((entry) => BFLYT.test(entry.name) && name.startsWith(`${entry.name.replace(BFLYT, '')}_`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!owner) {
    tessera.ui.toast('warning', t('anim.noLayout', { name }));
    return;
  }
  if (owner.path !== path) await open(owner.path);
  if (owner.path !== path) return;
  await animationsReady;
  animPicker.value = file;
  animPicker.dispatchEvent(new Event('change'));
}

playButton.addEventListener('click', () => (playing ? stopAnimation() : animation && playAnimation()));
frameSlider.addEventListener('input', () => {
  stopAnimation();
  frame = Number(frameSlider.value);
  scheduleDraw();
});
