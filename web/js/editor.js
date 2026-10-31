// The character editor: Joints view (place the skeleton) and Pieces view
// (see the puppet cut into parts, fix the cut with pen and eraser).
//
// One undo stack covers both: every entry is { skeleton, overrides }.
// Everything heavy (labelling, cutting) happens on a working-size copy of
// the texture so dragging stays smooth; the full-resolution cut happens in
// piecebuild.js when saving.

import {
  applyTemplate, addJoint, moveJoint, renameJoint, deleteJoint, setParent, mirrorX,
  bones, depthOrder, jointById, rootOf, descendantsOf, depthOf, validate,
} from './skeleton.js';
import { labelCounts } from './regions.js';
import { poseTransforms } from './rig.js';
import { ERASED, emptyOverrides, applyOverrides, paintCircle, cutPieces, capRadius, explodeOffsets } from './pieces.js';
import { rasterise, autoLabels, buildAndSavePieces, loadOverrides } from './piecebuild.js';
import { characterFileUrl, putCharacterFile } from './api.js';

const BONE_COLOURS = [
  '#2456e6', '#f28c28', '#2bb673', '#d63384', '#7a4fd3', '#0fa3b1', '#e4402f',
  '#c9a200', '#9c6b3c', '#f477b5', '#4b7bec', '#20bf6b', '#a55eea', '#fd9644',
  '#0fb9b1', '#eb3b5a', '#778ca3', '#3867d6', '#fa8231', '#26de81',
];
const WORK_MAX_SIDE = 512;       // working resolution for labels, tints, pieces preview, paint
const HIT_RADIUS = 14;           // screen pixels
const WIGGLE_DEGREES = 12;
const WIGGLE_PERIOD_MS = 1800;
const AUTOSAVE_DELAY_MS = 1500;

const $ = (id) => document.getElementById(id);
const el = {
  title: $('title'), status: $('status'), save: $('save'),
  modeJoints: $('mode-joints'), modePieces: $('mode-pieces'),
  toolsJoints: $('tools-joints'), toolsPieces: $('tools-pieces'),
  template: $('template'), applyTemplate: $('apply-template'),
  add: $('add'), delete: $('delete'), mirror: $('mirror'), undo: $('undo'), redo: $('redo'),
  jointList: $('joint-list'), inspector: $('inspector'), jointName: $('joint-name'), jointParent: $('joint-parent'), jointNote: $('joint-note'),
  showRegions: $('show-regions'), showNames: $('show-names'), wiggle: $('wiggle'),
  spread: $('spread'), toolPen: $('tool-pen'), toolEraser: $('tool-eraser'), toolNone: $('tool-none'), brush: $('brush'),
  paintHint: $('paint-hint'), paintUndo: $('paint-undo'), paintRedo: $('paint-redo'), paintClear: $('paint-clear'),
  pieceList: $('piece-list'),
  stage: $('stage'), stageHint: $('stage-hint'),
};

const state = {
  name: null,
  texture: null,            // ImageBitmap
  textureWidth: 0,
  textureHeight: 0,
  skeleton: null,
  overrides: null,          // Int16Array at working size
  undo: [],                 // [{ skeleton, overrides }]
  redo: [],
  mode: 'joints',
  tool: 'none',             // 'none' | 'pen' | 'eraser'
  selected: null,           // joint id (in Pieces view: the bone's joint id)
  hover: null,
  adding: false,
  drag: null,
  stroke: null,             // { before, last }
  pointer: null,            // last pointer position on screen, for the brush cursor
  dirty: false,
  templates: [],
  view: { scale: 1, offsetX: 0, offsetY: 0 },
  work: null,               // see initWork and refreshWork
  workStale: true,
  wiggleStart: 0,
  animationFrame: 0,
  autosaveTimer: 0,
  building: false,
};

// ---------- boot ----------

async function boot() {
  const name = new URLSearchParams(location.search).get('name');
  if (!name) { setStatus('No character given. Go back and pick one.', 'error'); return; }
  state.name = name;
  el.title.textContent = name;
  document.title = `${name}: skeleton`;
  $('animate-link').href = `play.html?name=${encodeURIComponent(name)}`;

  try {
    const [texture, templates, existing] = await Promise.all([loadTexture(name), loadTemplateIndex(), loadExistingSkeleton(name)]);
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
    initWork();
    state.overrides = existing ? await loadOverrides(name, state.skeleton, state.work) : emptyOverrides(state.work.width, state.work.height);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }

  wireUi();
  fitView();
  afterChange({ silent: true });
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
  el.template.replaceChildren(...templates.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })));
}

// ---------- working copy ----------

function initWork() {
  const scale = Math.min(1, WORK_MAX_SIDE / Math.max(state.textureWidth, state.textureHeight));
  const width = Math.max(1, Math.round(state.textureWidth * scale));
  const height = Math.max(1, Math.round(state.textureHeight * scale));
  const { image, alpha } = rasterise(state.texture, width, height);
  state.work = { width, height, scale, image, alpha, auto: null, autoFor: null };
}

// Recompute whatever depends on the skeleton, the overrides or the spread.
function refreshWork() {
  const w = state.work;
  if (w.autoFor !== state.skeleton) {
    w.auto = autoLabels(w.alpha, w.width, w.height, w.scale, state.skeleton);
    w.autoFor = state.skeleton;
  }
  const { bones: boneList, segments, halfWidths } = w.auto;
  w.labels = applyOverrides(w.auto.labels, state.overrides, w.alpha);
  w.counts = labelCounts(w.labels, boneList.length);
  w.boneList = boneList;

  // Tints.
  const overlay = new ImageData(w.width, w.height);
  const colours = boneList.map((b) => hexToRgb(boneColour(jointById(state.skeleton, b.jointId))));
  for (let p = 0; p < w.labels.length; p += 1) {
    const l = w.labels[p];
    if (l < 0) continue;
    const c = colours[l];
    overlay.data[p * 4] = c[0]; overlay.data[p * 4 + 1] = c[1]; overlay.data[p * 4 + 2] = c[2]; overlay.data[p * 4 + 3] = 110;
  }
  w.overlay = toCanvas(overlay);

  // Pieces at working size, with caps.
  const caps = Float64Array.from(halfWidths.map((hw) => capRadius(hw)));
  w.pieces = cutPieces(w.image.data, w.width, w.height, w.labels, segments, caps).map((piece) => ({
    ...piece,
    canvas: toCanvas(new ImageData(piece.data, piece.width, piece.height)),
    jointId: boneList[piece.bone].jointId,
  }));
  w.offsets = explodeOffsets(w.pieces, segments, { x: w.width / 2, y: w.height / 2 }, spreadValue());
  state.workStale = false;
}

function toCanvas(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function boneColour(joint) {
  const index = state.skeleton.joints.findIndex((j) => j.id === joint.id);
  return BONE_COLOURS[(index < 0 ? 0 : index) % BONE_COLOURS.length];
}

function spreadValue() {
  return state.mode === 'pieces' && state.tool === 'none' ? Number(el.spread.value) / 100 : 0;
}

// ---------- undo stack ----------

function snapshot() {
  return { skeleton: state.skeleton, overrides: state.overrides };
}

function commit(next) {
  state.undo.push(snapshot());
  if (state.undo.length > 100) state.undo.shift();
  state.redo = [];
  if (next.skeleton) state.skeleton = next.skeleton;
  if (next.overrides) state.overrides = next.overrides;
  state.dirty = true;
  state.workStale = true;
  afterChange();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  restore(state.undo.pop());
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  restore(state.redo.pop());
}

function restore(entry) {
  state.skeleton = entry.skeleton;
  state.overrides = entry.overrides;
  state.dirty = true;
  state.workStale = true;
  if (state.selected && !jointById(state.skeleton, state.selected)) state.selected = null;
  afterChange();
}

function afterChange({ silent = false } = {}) {
  const canUndo = state.undo.length > 0, canRedo = state.redo.length > 0;
  el.undo.disabled = !canUndo; el.paintUndo.disabled = !canUndo;
  el.redo.disabled = !canRedo; el.paintRedo.disabled = !canRedo;
  el.save.textContent = state.dirty ? 'Save' : 'Saved';
  renderLists();
  scheduleDraw();
  if (!silent) scheduleAutosave();
}

function select(id) {
  state.selected = id;
  renderLists();
  scheduleDraw();
}

// ---------- saving ----------

function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => {
    if (state.dirty && !state.drag && !state.stroke) save({ quiet: true });
  }, AUTOSAVE_DELAY_MS);
}

async function save({ quiet = false } = {}) {
  const problems = validate(state.skeleton);
  if (problems.length) { setStatus(`Cannot save: ${problems.join('; ')}`, 'error'); return; }
  if (state.building) { scheduleAutosave(); return; }
  const taken = snapshot();
  state.building = true;
  el.save.disabled = true;
  el.save.textContent = 'Saving';
  setStatus('Saving and cutting the pieces...');
  try {
    await putCharacterFile(state.name, 'skeleton.json', JSON.stringify(taken.skeleton, null, 2), 'application/json');
    await buildAndSavePieces(state.name, state.texture, taken.skeleton, taken.overrides, state.work);
    if (state.skeleton === taken.skeleton && state.overrides === taken.overrides) state.dirty = false;
    el.save.textContent = state.dirty ? 'Save' : 'Saved';
    setStatus(quiet ? 'Saved.' : 'Skeleton and pieces saved.', 'ok');
    if (state.dirty) scheduleAutosave();
  } catch (error) {
    el.save.textContent = 'Save';
    setStatus(`Could not save: ${error.message}`, 'error');
  } finally {
    state.building = false;
    el.save.disabled = false;
  }
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

// ---------- UI wiring ----------

function wireUi() {
  el.modeJoints.addEventListener('click', () => setMode('joints'));
  el.modePieces.addEventListener('click', () => setMode('pieces'));

  el.applyTemplate.addEventListener('click', async () => {
    try {
      const template = await loadTemplate(el.template.value);
      state.selected = null;
      commit({ skeleton: applyTemplate(template, state.textureWidth, state.textureHeight) });
      setStatus(`Using the "${template.name}" template. Drag the joints into place.`);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
  el.add.addEventListener('click', () => setAdding(!state.adding));
  el.delete.addEventListener('click', deleteSelected);
  el.mirror.addEventListener('click', () => { commit({ skeleton: mirrorX(state.skeleton, state.textureWidth) }); setStatus('Mirrored left to right.'); });
  for (const b of [el.undo, el.paintUndo]) b.addEventListener('click', undo);
  for (const b of [el.redo, el.paintRedo]) b.addEventListener('click', redo);
  el.save.addEventListener('click', () => save());

  el.jointName.addEventListener('change', () => {
    if (!state.selected) return;
    try { commit({ skeleton: renameJoint(state.skeleton, state.selected, el.jointName.value) }); } catch (error) { setStatus(error.message, 'error'); }
  });
  el.jointParent.addEventListener('change', () => {
    if (!state.selected) return;
    try { commit({ skeleton: setParent(state.skeleton, state.selected, el.jointParent.value) }); } catch (error) { setStatus(error.message, 'error'); renderLists(); }
  });

  for (const box of [el.showRegions, el.showNames]) box.addEventListener('change', scheduleDraw);
  el.wiggle.addEventListener('change', () => { state.wiggleStart = performance.now(); scheduleDraw(); });

  el.spread.addEventListener('input', () => { state.workStale = true; scheduleDraw(); });
  el.toolPen.addEventListener('click', () => setTool('pen'));
  el.toolEraser.addEventListener('click', () => setTool('eraser'));
  el.toolNone.addEventListener('click', () => setTool('none'));
  el.paintClear.addEventListener('click', () => {
    commit({ overrides: emptyOverrides(state.work.width, state.work.height) });
    setStatus('Your fixes are cleared. The cut is automatic again.');
  });

  el.stage.addEventListener('pointerdown', onPointerDown);
  el.stage.addEventListener('pointermove', onPointerMove);
  el.stage.addEventListener('pointerup', onPointerUp);
  el.stage.addEventListener('pointercancel', onPointerUp);
  el.stage.addEventListener('pointerleave', () => { state.pointer = null; scheduleDraw(); });
  el.stage.addEventListener('keydown', onKeyDown);
  document.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('resize', () => { fitView(); scheduleDraw(); });
}

function setMode(mode) {
  state.mode = mode;
  el.modeJoints.classList.toggle('active', mode === 'joints');
  el.modePieces.classList.toggle('active', mode === 'pieces');
  el.toolsJoints.hidden = mode !== 'joints';
  el.toolsPieces.hidden = mode !== 'pieces';
  if (mode === 'pieces') { setAdding(false); el.wiggle.checked = false; }
  if (mode === 'joints') setTool('none');
  state.workStale = true;
  renderLists();
  scheduleDraw();
}

function setTool(tool) {
  state.tool = tool;
  el.toolPen.classList.toggle('active', tool === 'pen');
  el.toolEraser.classList.toggle('active', tool === 'eraser');
  el.toolNone.classList.toggle('active', tool === 'none');
  el.spread.disabled = tool !== 'none';
  el.stage.classList.toggle('painting', tool !== 'none');
  el.stageHint.hidden = tool === 'none';
  if (tool === 'pen') el.stageHint.textContent = state.selected ? `Painting into "${jointById(state.skeleton, state.selected).name}".` : 'Pick a piece in the list first, then paint.';
  if (tool === 'eraser') el.stageHint.textContent = 'Erasing takes pixels out of every piece.';
  state.workStale = true;
  scheduleDraw();
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
    commit({ skeleton: deleteJoint(state.skeleton, state.selected) });
    state.selected = null;
    renderLists();
    setStatus(`Removed "${name}".`);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

// ---------- lists ----------

function renderLists() {
  if (state.workStale) refreshWork();
  const ordered = depthOrder(state.skeleton);
  const boneIndex = new Map(state.work.boneList.map((b, i) => [b.jointId, i]));

  const makeItem = (joint, { piecesOnly }) => {
    const li = document.createElement('li');
    li.className = 'joint-item';
    li.style.setProperty('--depth', depthOf(state.skeleton, joint.id) - (piecesOnly ? 1 : 0));
    if (joint.id === state.selected) li.classList.add('selected');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = joint.parent === null ? '#1f1d2b' : boneColour(joint);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'joint-button';
    button.textContent = joint.name;
    button.addEventListener('click', () => { select(joint.id); if (state.tool === 'pen') setTool('pen'); });
    li.append(swatch, button);
    const count = joint.parent === null ? null : state.work.counts[boneIndex.get(joint.id)];
    if (count === 0) {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = 'grabs nothing';
      li.append(warn);
    }
    return li;
  };

  el.jointList.replaceChildren(...ordered.map((j) => makeItem(j, { piecesOnly: false })));
  el.pieceList.replaceChildren(...ordered.filter((j) => j.parent !== null).map((j) => makeItem(j, { piecesOnly: true })));

  const selected = state.selected ? jointById(state.skeleton, state.selected) : null;
  el.inspector.hidden = !selected;
  el.delete.disabled = !selected || selected.parent === null;
  if (!selected) return;
  el.jointName.value = selected.name;
  const blocked = new Set([selected.id, ...descendantsOf(state.skeleton, selected.id).map((j) => j.id)]);
  el.jointParent.replaceChildren(...ordered.filter((j) => !blocked.has(j.id)).map((j) => {
    const option = document.createElement('option');
    option.value = j.id; option.textContent = j.name; option.selected = j.id === selected.parent;
    return option;
  }));
  el.jointParent.disabled = selected.parent === null;
  el.jointNote.textContent = selected.parent === null
    ? 'This is the root. Everything hangs off it, so it cannot be deleted or reattached.'
    : selected.landmark ? 'Follows your body in the webcam step.' : 'Not linked to the webcam yet. It will keep still unless a motion moves it.';
}

// ---------- view maths ----------

function fitView() {
  const wrap = el.stage.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = wrap.clientWidth, cssHeight = wrap.clientHeight;
  el.stage.width = Math.round(cssWidth * dpr);
  el.stage.height = Math.round(cssHeight * dpr);
  el.stage.style.width = `${cssWidth}px`;
  el.stage.style.height = `${cssHeight}px`;
  const margin = 32;
  // Leave room for the exploded view: fit the drawing into the middle 72%.
  const scale = Math.min((cssWidth - margin * 2) / state.textureWidth, (cssHeight - margin * 2) / state.textureHeight) * 0.72;
  state.view = { scale, offsetX: (cssWidth - state.textureWidth * scale) / 2, offsetY: (cssHeight - state.textureHeight * scale) / 2 };
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

// Which exploded piece is under the pointer (topmost first).
function pieceAt(sx, sy) {
  const w = state.work;
  const [tx, ty] = toTexture(sx, sy);
  for (let i = w.pieces.length - 1; i >= 0; i -= 1) {
    const piece = w.pieces[i], off = w.offsets[i];
    const x = Math.floor(tx * w.scale - off.x) - piece.x, y = Math.floor(ty * w.scale - off.y) - piece.y;
    if (x < 0 || y < 0 || x >= piece.width || y >= piece.height) continue;
    if (piece.data[(y * piece.width + x) * 4 + 3] > 0) return piece;
  }
  return null;
}

// ---------- pointer and keyboard ----------

function onPointerDown(event) {
  const [sx, sy] = pointerPosition(event);
  if (state.mode === 'pieces') { onPiecesPointerDown(event, sx, sy); return; }
  el.stage.focus();
  if (state.adding) {
    event.preventDefault();
    const [tx, ty] = toTexture(sx, sy);
    const parent = state.selected ?? rootOf(state.skeleton).id;
    const next = addJoint(state.skeleton, { name: 'New joint', x: tx, y: ty, parent });
    commit({ skeleton: next });
    state.selected = next.joints[next.joints.length - 1].id;
    setAdding(false);
    renderLists();
    el.jointName.focus();
    el.jointName.select();
    return;
  }
  const hit = jointAt(sx, sy);
  if (!hit) { select(null); return; }
  const [jx, jy] = toScreen(hit.x, hit.y);
  state.drag = { id: hit.id, offsetX: jx - sx, offsetY: jy - sy, moved: false, before: snapshot() };
  el.stage.setPointerCapture(event.pointerId);
  select(hit.id);
}

function onPiecesPointerDown(event, sx, sy) {
  if (state.tool === 'none') {
    const piece = pieceAt(sx, sy);
    select(piece ? piece.jointId : null);
    return;
  }
  if (state.tool === 'pen' && !state.selected) { setStatus('Pick a piece in the list first, then paint into it.', 'error'); return; }
  event.preventDefault();
  state.stroke = { before: snapshot(), last: null };
  state.overrides = Int16Array.from(state.overrides);   // copy-on-write so undo keeps the old one
  el.stage.setPointerCapture(event.pointerId);
  paintAt(sx, sy);
}

function paintAt(sx, sy) {
  const w = state.work;
  const [tx, ty] = toTexture(sx, sy);
  const x = tx * w.scale, y = ty * w.scale;
  const radius = (Number(el.brush.value) / 2 / state.view.scale) * w.scale;
  const value = state.tool === 'pen' ? w.boneList.findIndex((b) => b.jointId === state.selected) : ERASED;
  if (value === -1 && state.tool === 'pen') return;
  let changed = false;
  const last = state.stroke.last;
  if (last) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x - last.x, y - last.y) / Math.max(1, radius / 2)));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      changed = paintCircle(state.overrides, w.width, w.height, last.x + (x - last.x) * t, last.y + (y - last.y) * t, radius, value) || changed;
    }
  } else {
    changed = paintCircle(state.overrides, w.width, w.height, x, y, radius, value);
  }
  state.stroke.last = { x, y };
  if (changed) { state.workStale = true; scheduleDraw(); }
}

function onPointerMove(event) {
  const [sx, sy] = pointerPosition(event);
  state.pointer = { x: sx, y: sy };
  if (state.stroke) { paintAt(sx, sy); return; }
  if (state.drag) {
    const [tx, ty] = toTexture(sx + state.drag.offsetX, sy + state.drag.offsetY);
    state.skeleton = moveJoint(state.skeleton, state.drag.id, Math.max(0, Math.min(state.textureWidth, tx)), Math.max(0, Math.min(state.textureHeight, ty)));
    state.drag.moved = true;
    state.workStale = true;
    scheduleDraw();
    return;
  }
  if (state.mode === 'pieces') {
    if (state.tool !== 'none') { scheduleDraw(); return; }
    const piece = pieceAt(sx, sy);
    const id = piece ? piece.jointId : null;
    if (id !== state.hover) { state.hover = id; el.stage.style.cursor = piece ? 'pointer' : 'default'; scheduleDraw(); }
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
  if (state.stroke) {
    const { before } = state.stroke;
    state.stroke = null;
    el.stage.releasePointerCapture(event.pointerId);
    const after = snapshot();
    state.skeleton = before.skeleton; state.overrides = before.overrides;
    commit({ overrides: after.overrides });
    return;
  }
  if (!state.drag) return;
  const { moved, before } = state.drag;
  const after = snapshot();
  state.drag = null;
  el.stage.releasePointerCapture(event.pointerId);
  if (moved) {
    state.skeleton = before.skeleton;
    commit({ skeleton: after.skeleton });
  }
}

function onKeyDown(event) {
  if (!state.selected || state.mode !== 'joints') return;
  const step = event.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[event.key]) {
    event.preventDefault();
    const joint = jointById(state.skeleton, state.selected);
    commit({ skeleton: moveJoint(state.skeleton, state.selected, joint.x + moves[event.key][0], joint.y + moves[event.key][1]) });
  }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
}

function onGlobalKeyDown(event) {
  const active = document.activeElement;
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(active?.tagName) && active.type !== 'range';
  if (event.key === 'Escape') { if (state.adding) setAdding(false); if (state.tool !== 'none') setTool('none'); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
}

// ---------- drawing ----------

function scheduleDraw() {
  if (state.animationFrame) return;
  state.animationFrame = requestAnimationFrame(() => { state.animationFrame = 0; draw(); });
}

function draw() {
  if (state.workStale) { refreshWork(); if (!state.drag && !state.stroke) renderLists(); }
  const ctx = el.stage.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, el.stage.width, el.stage.height);

  if (state.mode === 'pieces') { drawPieces(ctx); drawBrushCursor(ctx); return; }

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
    if (el.showRegions.checked) ctx.drawImage(state.work.overlay, 0, 0, state.textureWidth, state.textureHeight);
  }
  ctx.restore();
  if (!wiggling) drawSkeleton(ctx);
  if (wiggling) scheduleDraw();
}

function drawSkeleton(ctx) {
  const boneList = bones(state.skeleton);
  const lineWidth = 7;
  for (const bone of boneList) {
    const [x1, y1] = toScreen(bone.from.x, bone.from.y);
    const [x2, y2] = toScreen(bone.to.x, bone.to.y);
    ctx.lineCap = 'round';
    ctx.lineWidth = lineWidth + 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.lineWidth = lineWidth; ctx.strokeStyle = boneColour(bone.to);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const joint of depthOrder(state.skeleton)) {
    const [x, y] = toScreen(joint.x, joint.y);
    const isSelected = joint.id === state.selected, isHover = joint.id === state.hover;
    const r = isSelected ? 10 : isHover ? 9 : 7;
    ctx.lineWidth = 3; ctx.fillStyle = isSelected ? '#2456e6' : '#ffffff'; ctx.strokeStyle = '#1f1d2b';
    ctx.beginPath();
    if (joint.parent === null) ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (el.showNames.checked || isSelected || isHover) drawLabel(ctx, joint.name, x + r + 6, y, isSelected);
  }
}

function drawLabel(ctx, text, lx, ly, highlighted) {
  const padding = 5;
  const width = ctx.measureText(text).width + padding * 2;
  ctx.fillStyle = highlighted ? '#2456e6' : 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = 'rgba(31,29,43,0.25)';
  ctx.lineWidth = 1;
  roundRect(ctx, lx, ly - 10, width, 20, 6);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = highlighted ? '#ffffff' : '#1f1d2b';
  ctx.fillText(text, lx + padding, ly + 1);
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

// The puppet cut into pieces, pulled apart by the Spread slider. Each piece
// turns around its pivot dot. This is exactly what the player draws.
function drawPieces(ctx) {
  const w = state.work;
  const { scale, offsetX, offsetY } = state.view;
  const hasSelection = Boolean(state.selected);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale / w.scale, scale / w.scale);
  ctx.imageSmoothingEnabled = true;
  w.pieces.forEach((piece, i) => {
    const off = w.offsets[i];
    const isSelected = piece.jointId === state.selected, isHover = piece.jointId === state.hover;
    ctx.save();
    ctx.globalAlpha = hasSelection && !isSelected && state.tool === 'none' ? 0.55 : 1;
    if (isSelected || isHover) {
      ctx.shadowColor = isSelected ? 'rgba(36,86,230,0.9)' : 'rgba(31,29,43,0.5)';
      ctx.shadowBlur = (isSelected ? 18 : 10) * w.scale / scale;
    }
    ctx.drawImage(piece.canvas, piece.x + off.x, piece.y + off.y);
    ctx.restore();
  });
  // While painting, the pieces sit together and their colours show, so every
  // stroke is visible as it happens.
  if (state.tool !== 'none') ctx.drawImage(w.overlay, 0, 0);
  ctx.restore();

  // Pivots and names, in screen space.
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  w.pieces.forEach((piece, i) => {
    const off = w.offsets[i];
    const bone = w.boneList[piece.bone];
    const [px, py] = toScreen((bone.x1 * w.scale + off.x) / w.scale, (bone.y1 * w.scale + off.y) / w.scale);
    const joint = jointById(state.skeleton, piece.jointId);
    const isSelected = piece.jointId === state.selected;
    ctx.lineWidth = 3; ctx.strokeStyle = '#1f1d2b';
    ctx.fillStyle = isSelected ? '#2456e6' : boneColour(joint);
    ctx.beginPath(); ctx.arc(px, py, isSelected ? 8 : 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (spreadValue() > 0.05 || isSelected) drawLabel(ctx, joint.name, px + 12, py, isSelected);
  });
}

function drawBrushCursor(ctx) {
  if (state.tool === 'none' || !state.pointer) return;
  const r = Number(el.brush.value) / 2;
  ctx.lineWidth = 2;
  ctx.strokeStyle = state.tool === 'pen' ? '#2456e6' : '#e4402f';
  ctx.setLineDash(state.tool === 'eraser' ? [4, 4] : []);
  ctx.beginPath(); ctx.arc(state.pointer.x, state.pointer.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}

// Pieces swing about their pivots, parents carrying children.
function drawWiggle(ctx, elapsed) {
  const w = state.work;
  const phase = (elapsed / WIGGLE_PERIOD_MS) * Math.PI * 2;
  const rotations = {};
  for (const joint of state.skeleton.joints) {
    if (joint.parent === null) continue;
    rotations[joint.id] = (WIGGLE_DEGREES * Math.PI / 180) * Math.sin(phase + depthOf(state.skeleton, joint.id) * 0.9 + hashAngle(joint.id));
  }
  const workSkeleton = { ...state.skeleton, joints: state.skeleton.joints.map((j) => ({ ...j, x: j.x * w.scale, y: j.y * w.scale })) };
  const transforms = poseTransforms(workSkeleton, w.boneList, { rotations, root: { x: 0, y: 0, rotation: 0 } });
  ctx.save();
  ctx.scale(1 / w.scale, 1 / w.scale);
  for (const piece of w.pieces) {
    const m = transforms.joints.get(piece.jointId);
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(piece.canvas, piece.x, piece.y);
    ctx.restore();
  }
  ctx.restore();
}

function hashAngle(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 1000 * Math.PI * 2;
}

boot();
