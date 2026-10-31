// The skeleton editor. All state changes go through `commit()`, which keeps an
// undo stack of whole skeletons (they are small) and redraws.

import {
  applyTemplate, addJoint, moveJoint, renameJoint, deleteJoint, setParent, mirrorX,
  bones, depthOrder, jointById, rootOf, descendantsOf, depthOf, validate,
} from './skeleton.js';
import { labelCounts, measureBoneHalfWidths, labelPixelsByThickness } from './regions.js';
import { buildGrid, solidCellTester, restBones, computeWeightsFromLabels, poseTransforms, skin } from './rig.js';
import { characterFileUrl, putCharacterFile } from './api.js';

// One colour per bone, in depth order. Marker colours, distinct from each other.
const BONE_COLOURS = [
  '#2456e6', '#f28c28', '#2bb673', '#d63384', '#7a4fd3', '#0fa3b1', '#e4402f',
  '#c9a200', '#9c6b3c', '#f477b5', '#4b7bec', '#20bf6b', '#a55eea', '#fd9644',
  '#0fb9b1', '#eb3b5a', '#778ca3', '#3867d6', '#fa8231', '#26de81',
];
const REGION_MAX_SIDE = 512;     // working resolution for the label map
const HIT_RADIUS = 14;           // screen pixels
const WIGGLE_DEGREES = 12;
const PREVIEW_CELLS_ON_LONG_SIDE = 28;   // mesh density for the wiggle preview
const WIGGLE_PERIOD_MS = 1800;

function boneColour(joint) {
  const index = state.skeleton.joints.findIndex((j) => j.id === joint.id);
  return BONE_COLOURS[(index < 0 ? 0 : index) % BONE_COLOURS.length];
}

const el = {
  title: document.getElementById('title'),
  status: document.getElementById('status'),
  save: document.getElementById('save'),
  template: document.getElementById('template'),
  applyTemplate: document.getElementById('apply-template'),
  add: document.getElementById('add'),
  delete: document.getElementById('delete'),
  mirror: document.getElementById('mirror'),
  undo: document.getElementById('undo'),
  redo: document.getElementById('redo'),
  jointList: document.getElementById('joint-list'),
  inspector: document.getElementById('inspector'),
  jointName: document.getElementById('joint-name'),
  jointParent: document.getElementById('joint-parent'),
  jointNote: document.getElementById('joint-note'),
  showRegions: document.getElementById('show-regions'),
  showNames: document.getElementById('show-names'),
  wiggle: document.getElementById('wiggle'),
  stage: document.getElementById('stage'),
  stageHint: document.getElementById('stage-hint'),
};

const state = {
  name: null,
  texture: null,          // ImageBitmap of texture.png
  textureWidth: 0,
  textureHeight: 0,
  skeleton: null,
  undo: [],
  redo: [],
  selected: null,         // joint id
  hover: null,            // joint id
  adding: false,          // next click places a joint
  drag: null,             // { id, offsetX, offsetY, moved }
  dirty: false,
  templates: [],          // from templates/index.json
  view: { scale: 1, offsetX: 0, offsetY: 0 },
  regions: null,          // { width, height, scale, labels, alpha, counts, overlay(ImageBitmap), pieces[] }
  regionsStale: true,
  wiggleStart: 0,
  animationFrame: 0,
};

// ---------- boot ----------

async function boot() {
  const name = new URLSearchParams(location.search).get('name');
  if (!name) {
    setStatus('No character given. Go back and pick one.', 'error');
    return;
  }
  state.name = name;
  el.title.textContent = name;
  document.title = `${name}: skeleton`;
  document.getElementById('animate-link').href = `play.html?name=${encodeURIComponent(name)}`;

  try {
    const [texture, templates, existing] = await Promise.all([
      loadTexture(name),
      loadTemplateIndex(),
      loadExistingSkeleton(name),
    ]);
    state.texture = texture;
    state.textureWidth = texture.width;
    state.textureHeight = texture.height;
    state.templates = templates;
    fillTemplateSelect(templates);
    if (existing) {
      state.skeleton = existing;
      el.template.value = existing.template ?? 'humanoid';
      setStatus('Loaded the saved skeleton.');
    } else {
      state.skeleton = applyTemplate(await loadTemplate('humanoid'), texture.width, texture.height);
      setStatus('Started from the person template. Drag the joints onto your drawing.');
    }
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }

  wireUi();
  fitView();
  refreshRegions();
  renderList();
  draw();
}

async function loadTexture(name) {
  const response = await fetch(characterFileUrl(name, 'texture.png'));
  if (!response.ok) throw new Error(`No texture for "${name}". Make the character first.`);
  return createImageBitmap(await response.blob());
}

async function loadTemplateIndex() {
  const response = await fetch('templates/index.json');
  if (!response.ok) throw new Error('Templates could not be loaded.');
  return (await response.json()).templates;
}

async function loadTemplate(id) {
  const entry = state.templates.find((t) => t.id === id);
  const response = await fetch(`templates/${entry ? entry.file : `${id}.json`}`);
  if (!response.ok) throw new Error(`Template "${id}" could not be loaded.`);
  return response.json();
}

async function loadExistingSkeleton(name) {
  const response = await fetch(characterFileUrl(name, 'skeleton.json'));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('The saved skeleton could not be read.');
  const skeleton = await response.json();
  const problems = validate(skeleton);
  if (problems.length) throw new Error(`The saved skeleton has problems: ${problems.join('; ')}`);
  return skeleton;
}

function fillTemplateSelect(templates) {
  el.template.replaceChildren(...templates.map((t) => {
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = t.name;
    return option;
  }));
}

// ---------- state changes ----------

function commit(next, { stale = true } = {}) {
  state.undo.push(state.skeleton);
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  state.skeleton = next;
  state.dirty = true;
  if (stale) state.regionsStale = true;
  afterChange();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(state.skeleton);
  state.skeleton = state.undo.pop();
  state.dirty = true;
  state.regionsStale = true;
  if (state.selected && !jointById(state.skeleton, state.selected)) state.selected = null;
  afterChange();
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(state.skeleton);
  state.skeleton = state.redo.pop();
  state.dirty = true;
  state.regionsStale = true;
  afterChange();
}

function afterChange() {
  el.undo.disabled = state.undo.length === 0;
  el.redo.disabled = state.redo.length === 0;
  el.save.textContent = state.dirty ? 'Save skeleton' : 'Saved';
  renderList();
  scheduleDraw();
  scheduleAutosave();
}

// Changes are saved on their own a moment after she stops editing, so nothing
// is lost if the tab closes. The button stays for the reassurance of pressing it.
const AUTOSAVE_DELAY_MS = 1500;
let autosaveTimer = 0;

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (state.dirty && !state.drag) save({ quiet: true });
  }, AUTOSAVE_DELAY_MS);
}

function select(id) {
  state.selected = id;
  renderList();
  scheduleDraw();
}

// ---------- UI wiring ----------

function wireUi() {
  el.applyTemplate.addEventListener('click', async () => {
    try {
      const template = await loadTemplate(el.template.value);
      state.selected = null;
      commit(applyTemplate(template, state.textureWidth, state.textureHeight));
      setStatus(`Using the "${template.name}" template. Drag the joints into place.`);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  el.add.addEventListener('click', () => setAdding(!state.adding));
  el.delete.addEventListener('click', deleteSelected);
  el.mirror.addEventListener('click', () => {
    commit(mirrorX(state.skeleton, state.textureWidth));
    setStatus('Mirrored left to right.');
  });
  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  el.save.addEventListener('click', save);

  el.jointName.addEventListener('change', () => {
    if (!state.selected) return;
    try {
      commit(renameJoint(state.skeleton, state.selected, el.jointName.value), { stale: false });
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
  el.jointParent.addEventListener('change', () => {
    if (!state.selected) return;
    try {
      commit(setParent(state.skeleton, state.selected, el.jointParent.value));
    } catch (error) {
      setStatus(error.message, 'error');
      renderList();
    }
  });

  for (const box of [el.showRegions, el.showNames]) box.addEventListener('change', scheduleDraw);
  el.wiggle.addEventListener('change', () => {
    state.wiggleStart = performance.now();
    scheduleDraw();
  });

  el.stage.addEventListener('pointerdown', onPointerDown);
  el.stage.addEventListener('pointermove', onPointerMove);
  el.stage.addEventListener('pointerup', onPointerUp);
  el.stage.addEventListener('pointercancel', onPointerUp);
  el.stage.addEventListener('keydown', onKeyDown);
  document.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('resize', () => { fitView(); scheduleDraw(); });
}

function setAdding(on) {
  state.adding = on;
  el.add.classList.toggle('active', on);
  el.stage.classList.toggle('adding', on);
  el.stageHint.hidden = !on;
  if (on) {
    const parent = state.selected ? jointById(state.skeleton, state.selected) : rootOf(state.skeleton);
    el.stageHint.textContent = `Click where the new joint goes. It will hang off "${parent.name}". Esc to cancel.`;
  }
}

function deleteSelected() {
  if (!state.selected) return;
  try {
    const name = jointById(state.skeleton, state.selected).name;
    commit(deleteJoint(state.skeleton, state.selected));
    state.selected = null;
    renderList();
    setStatus(`Removed "${name}".`);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function save({ quiet = false } = {}) {
  const problems = validate(state.skeleton);
  if (problems.length) {
    setStatus(`Cannot save: ${problems.join('; ')}`, 'error');
    return;
  }
  const snapshot = state.skeleton;
  el.save.disabled = true;
  el.save.textContent = 'Saving';
  try {
    await putCharacterFile(state.name, 'skeleton.json', JSON.stringify(snapshot, null, 2), 'application/json');
    if (state.skeleton === snapshot) state.dirty = false;
    el.save.textContent = state.dirty ? 'Save skeleton' : 'Saved';
    if (!quiet) setStatus('Skeleton saved.', 'ok');
  } catch (error) {
    el.save.textContent = 'Save skeleton';
    setStatus(`Could not save: ${error.message}`, 'error');
  } finally {
    el.save.disabled = false;
  }
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

// ---------- joint list and inspector ----------

function renderList() {
  const ordered = depthOrder(state.skeleton);
  const boneIndex = new Map(bones(state.skeleton).map((b, i) => [b.id, i]));
  el.jointList.replaceChildren(...ordered.map((joint) => {
    const li = document.createElement('li');
    li.className = 'joint-item';
    li.style.setProperty('--depth', depthOf(state.skeleton, joint.id));
    if (joint.id === state.selected) li.classList.add('selected');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = joint.parent === null ? '#1f1d2b' : boneColour(joint);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'joint-button';
    label.textContent = joint.name;
    label.addEventListener('click', () => select(joint.id));
    li.append(swatch, label);
    if (state.regions && joint.parent !== null && state.regions.counts[boneIndex.get(joint.id)] === 0) {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.title = 'This bone grabs no part of the drawing';
      warn.textContent = 'grabs nothing';
      li.append(warn);
    }
    return li;
  }));

  const selected = state.selected ? jointById(state.skeleton, state.selected) : null;
  el.inspector.hidden = !selected;
  el.delete.disabled = !selected || selected.parent === null;
  if (!selected) return;
  el.jointName.value = selected.name;
  const blocked = new Set([selected.id, ...descendantsOf(state.skeleton, selected.id).map((j) => j.id)]);
  el.jointParent.replaceChildren(...ordered.filter((j) => !blocked.has(j.id)).map((j) => {
    const option = document.createElement('option');
    option.value = j.id;
    option.textContent = j.name;
    option.selected = j.id === selected.parent;
    return option;
  }));
  el.jointParent.disabled = selected.parent === null;
  el.jointNote.textContent = selected.parent === null
    ? 'This is the root. Everything hangs off it, so it cannot be deleted or reattached.'
    : selected.landmark ? 'Follows your body in the webcam step.' : 'Not linked to the webcam yet. It will keep still unless you add a motion for it.';
}

// ---------- view maths ----------

function fitView() {
  const wrap = el.stage.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = wrap.clientWidth;
  const cssHeight = wrap.clientHeight;
  el.stage.width = Math.round(cssWidth * dpr);
  el.stage.height = Math.round(cssHeight * dpr);
  el.stage.style.width = `${cssWidth}px`;
  el.stage.style.height = `${cssHeight}px`;
  const margin = 32;
  const scale = Math.min((cssWidth - margin * 2) / state.textureWidth, (cssHeight - margin * 2) / state.textureHeight);
  state.view = {
    scale,
    offsetX: (cssWidth - state.textureWidth * scale) / 2,
    offsetY: (cssHeight - state.textureHeight * scale) / 2,
  };
}

const toScreen = (x, y) => [x * state.view.scale + state.view.offsetX, y * state.view.scale + state.view.offsetY];
const toTexture = (sx, sy) => [(sx - state.view.offsetX) / state.view.scale, (sy - state.view.offsetY) / state.view.scale];

function pointerPosition(event) {
  const rect = el.stage.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

function jointAt(sx, sy) {
  let best = null, bestD = HIT_RADIUS * HIT_RADIUS;
  for (const joint of state.skeleton.joints) {
    const [jx, jy] = toScreen(joint.x, joint.y);
    const d = (jx - sx) ** 2 + (jy - sy) ** 2;
    if (d <= bestD) { best = joint; bestD = d; }
  }
  return best;
}

// ---------- pointer and keyboard ----------

function onPointerDown(event) {
  el.stage.focus();
  const [sx, sy] = pointerPosition(event);
  if (state.adding) {
    event.preventDefault();   // stop the canvas taking focus; the name field gets it below
    const [tx, ty] = toTexture(sx, sy);
    const parent = state.selected ?? rootOf(state.skeleton).id;
    const next = addJoint(state.skeleton, { name: 'New joint', x: tx, y: ty, parent });
    const created = next.joints[next.joints.length - 1];
    commit(next);
    state.selected = created.id;
    setAdding(false);
    renderList();
    el.jointName.focus();
    el.jointName.select();
    return;
  }
  const hit = jointAt(sx, sy);
  if (!hit) {
    select(null);
    return;
  }
  const [jx, jy] = toScreen(hit.x, hit.y);
  state.drag = { id: hit.id, offsetX: jx - sx, offsetY: jy - sy, moved: false, before: state.skeleton };
  el.stage.setPointerCapture(event.pointerId);
  select(hit.id);
}

function onPointerMove(event) {
  const [sx, sy] = pointerPosition(event);
  if (state.drag) {
    const [tx, ty] = toTexture(sx + state.drag.offsetX, sy + state.drag.offsetY);
    const clampedX = Math.max(0, Math.min(state.textureWidth, tx));
    const clampedY = Math.max(0, Math.min(state.textureHeight, ty));
    state.skeleton = moveJoint(state.skeleton, state.drag.id, clampedX, clampedY);
    state.drag.moved = true;
    state.regionsStale = true;
    scheduleDraw();
    return;
  }
  const hit = jointAt(sx, sy);
  const id = hit ? hit.id : null;
  if (id !== state.hover) {
    state.hover = id;
    el.stage.style.cursor = hit ? 'grab' : state.adding ? 'crosshair' : 'default';
    scheduleDraw();
  }
}

function onPointerUp(event) {
  if (!state.drag) return;
  const { moved, before } = state.drag;
  const after = state.skeleton;
  state.drag = null;
  el.stage.releasePointerCapture(event.pointerId);
  if (moved) {
    state.skeleton = before;   // so commit records the pre-drag skeleton as the undo point
    commit(after);
  }
}

function onKeyDown(event) {
  if (!state.selected) return;
  const step = event.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[event.key]) {
    event.preventDefault();
    const joint = jointById(state.skeleton, state.selected);
    commit(moveJoint(state.skeleton, state.selected, joint.x + moves[event.key][0], joint.y + moves[event.key][1]));
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelected();
  }
}

function onGlobalKeyDown(event) {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (event.key === 'Escape' && state.adding) setAdding(false);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
}

// ---------- regions: which bone grabs which pixels ----------

function refreshRegions() {
  const scale = Math.min(1, REGION_MAX_SIDE / Math.max(state.textureWidth, state.textureHeight));
  const width = Math.max(1, Math.round(state.textureWidth * scale));
  const height = Math.max(1, Math.round(state.textureHeight * scale));

  // Alpha at working resolution, computed once.
  if (!state.regions || state.regions.width !== width) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(state.texture, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let p = 0; p < alpha.length; p += 1) alpha[p] = data[p * 4 + 3] > 8 ? 255 : 0;
    state.regions = { width, height, scale, alpha, small: ctx.getImageData(0, 0, width, height) };
  }

  const boneList = bones(state.skeleton);
  const segments = boneList.map((b) => ({
    x1: b.from.x * scale, y1: b.from.y * scale, x2: b.to.x * scale, y2: b.to.y * scale,
  }));
  const halfWidths = measureBoneHalfWidths(state.regions.alpha, width, height, segments);
  const labels = labelPixelsByThickness(state.regions.alpha, width, height, segments, halfWidths);
  const counts = labelCounts(labels, segments.length);

  // Tinted overlay for "what each bone grabs".
  const overlay = new ImageData(width, height);
  const colours = boneList.map((b) => hexToRgb(boneColour(b.to)));
  for (let p = 0; p < labels.length; p += 1) {
    const l = labels[p];
    if (l < 0) continue;
    const c = colours[l];
    overlay.data[p * 4] = c[0]; overlay.data[p * 4 + 1] = c[1]; overlay.data[p * 4 + 2] = c[2]; overlay.data[p * 4 + 3] = 110;
  }

  // The wiggle preview uses the same bending mesh as the player, built over
  // the working-resolution texture so it stays quick while joints are dragged.
  const cellSize = Math.max(4, Math.round(Math.max(width, height) / PREVIEW_CELLS_ON_LONG_SIDE));
  const grid = buildGrid(width, height, cellSize, solidCellTester(state.regions.alpha, width, height, 1, cellSize));
  const rig = restBones(scaledSkeleton(scale));
  const weighting = computeWeightsFromLabels(grid.positions, rig, labels, width, height, 1, cellSize);
  const preview = { grid, rig, weighting, posed: new Float32Array(grid.positions), skeleton: scaledSkeleton(scale) };

  if (!state.regions.image) {
    const image = new OffscreenCanvas(width, height);
    image.getContext('2d').putImageData(state.regions.small, 0, 0);
    state.regions.image = image;
  }

  Object.assign(state.regions, { labels, counts, overlay: overlayToCanvas(overlay), boneList, preview });
  state.regionsStale = false;
}

// The skeleton in working-resolution pixels.
function scaledSkeleton(scale) {
  return { ...state.skeleton, joints: state.skeleton.joints.map((j) => ({ ...j, x: j.x * scale, y: j.y * scale })) };
}

function overlayToCanvas(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// ---------- drawing ----------

function scheduleDraw() {
  if (state.animationFrame) return;
  state.animationFrame = requestAnimationFrame(() => {
    state.animationFrame = 0;
    draw();
  });
}

function draw() {
  if (state.regionsStale) {
    refreshRegions();
    renderList();
  }
  const ctx = el.stage.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, el.stage.width, el.stage.height);

  const { scale, offsetX, offsetY } = state.view;
  const wiggling = el.wiggle.checked;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;

  if (wiggling) {
    drawWiggle(ctx, performance.now() - state.wiggleStart);
  } else {
    ctx.drawImage(state.texture, 0, 0);
    if (el.showRegions.checked && state.regions.overlay) {
      ctx.drawImage(state.regions.overlay, 0, 0, state.textureWidth, state.textureHeight);
    }
  }
  ctx.restore();

  if (!wiggling) drawSkeleton(ctx);
  if (wiggling) scheduleDraw();
}

function drawSkeleton(ctx) {
  const boneList = bones(state.skeleton);
  const lineWidth = 7;

  // Bones as thick strips.
  boneList.forEach((bone) => {
    const [x1, y1] = toScreen(bone.from.x, bone.from.y);
    const [x2, y2] = toScreen(bone.to.x, bone.to.y);
    ctx.lineCap = 'round';
    ctx.lineWidth = lineWidth + 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = boneColour(bone.to);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  });

  // Joints as rings; root is a square.
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const joint of depthOrder(state.skeleton)) {
    const [x, y] = toScreen(joint.x, joint.y);
    const isSelected = joint.id === state.selected;
    const isHover = joint.id === state.hover;
    const r = isSelected ? 10 : isHover ? 9 : 7;
    ctx.lineWidth = 3;
    ctx.fillStyle = isSelected ? '#2456e6' : '#ffffff';
    ctx.strokeStyle = '#1f1d2b';
    ctx.beginPath();
    if (joint.parent === null) ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (el.showNames.checked || isSelected || isHover) {
      const text = joint.name;
      const padding = 5;
      const width = ctx.measureText(text).width + padding * 2;
      const lx = x + r + 6, ly = y;
      ctx.fillStyle = isSelected ? '#2456e6' : 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(31,29,43,0.25)';
      ctx.lineWidth = 1;
      roundRect(ctx, lx, ly - 10, width, 20, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isSelected ? '#ffffff' : '#1f1d2b';
      ctx.fillText(text, lx + padding, ly + 1);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Every bone swings gently about its parent, and the mesh bends with it,
// exactly as the player will render it.
function drawWiggle(ctx, elapsed) {
  const { preview, image, scale: regionScale } = state.regions;
  const phase = (elapsed / WIGGLE_PERIOD_MS) * Math.PI * 2;
  const rotations = {};
  for (const joint of state.skeleton.joints) {
    if (joint.parent === null) continue;
    const depth = depthOf(state.skeleton, joint.id);
    rotations[joint.id] = (WIGGLE_DEGREES * Math.PI / 180) * Math.sin(phase + depth * 0.9 + hashAngle(joint.id));
  }
  const transforms = poseTransforms(preview.skeleton, preview.rig, { rotations, root: { x: 0, y: 0, rotation: 0 } });
  skin(preview.grid.positions, transforms.bones, preview.weighting, preview.posed);

  ctx.save();
  ctx.scale(1 / regionScale, 1 / regionScale);
  drawTexturedTriangles(ctx, image, preview.grid.positions, preview.posed, preview.grid.indices);
  ctx.restore();
}

// Canvas 2D has no mesh primitive, so each triangle is drawn by clipping to
// its posed shape and drawing the image through the affine map that takes
// the rest triangle onto it. Triangles are grown by a hair to hide seams.
function drawTexturedTriangles(ctx, image, rest, posed, indices) {
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 2, b = indices[i + 1] * 2, c = indices[i + 2] * 2;
    const x0 = rest[a], y0 = rest[a + 1], x1 = rest[b], y1 = rest[b + 1], x2 = rest[c], y2 = rest[c + 1];
    const u0 = posed[a], v0 = posed[a + 1], u1 = posed[b], v1 = posed[b + 1], u2 = posed[c], v2 = posed[c + 1];

    // Affine map M with M(rest_k) = posed_k, solved from the three correspondences.
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(det) < 1e-6) continue;
    const ma = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
    const mc = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
    const mb = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
    const md = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
    const me = u0 - ma * x0 - mc * y0;
    const mf = v0 - mb * x0 - md * y0;

    // Grow the clip slightly away from the centroid to cover seams.
    const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3;
    const grow = (px, py) => { const dx = px - cx, dy = py - cy, l = Math.hypot(dx, dy) || 1; return [px + dx / l * 0.6, py + dy / l * 0.6]; };
    const [g0x, g0y] = grow(u0, v0), [g1x, g1y] = grow(u1, v1), [g2x, g2y] = grow(u2, v2);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g0x, g0y); ctx.lineTo(g1x, g1y); ctx.lineTo(g2x, g2y); ctx.closePath();
    ctx.clip();
    ctx.transform(ma, mb, mc, md, me, mf);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }
}

function hashAngle(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 1000 * Math.PI * 2;
}

boot();
