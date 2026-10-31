// Plays a rigged character with a preset motion on a 1280x720 stage.
//
// The character is one PixiJS mesh: a grid over the texture whose vertices
// follow the bones (rig.js). Every frame: sample the motion, compute the bone
// matrices, skin the vertices, upload. Nothing here is specific to preset
// motions; step 4 feeds the same pose from the webcam.

// PixiJS is loaded as a classic script (see web/vendor/VENDOR.md for why) and
// found on the global, together with its CSP-friendly add-on.
const { Application, Mesh, MeshGeometry, Texture, Graphics, Container } = window.PIXI;
import { validate, depthOrder, jointById, rootOf } from './skeleton.js';
import { buildGrid, solidCellTester, restBones, computeWeightsFromLabels, poseTransforms, skin, mat } from './rig.js';
import { measureBoneHalfWidths, labelPixelsByThickness } from './regions.js';
import { validateMotion, evaluateMotion } from './motion.js';
import { characterFileUrl } from './api.js';

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;
const CHARACTER_HEIGHT = 0.78;     // of the stage height
const GROUND = 0.94;               // feet sit here, as a fraction of stage height
const GRID_CELLS_ON_LONG_SIDE = 48;
const ALPHA_SCALE = 0.25;          // resolution of the alpha map used to skip empty cells

const el = {
  title: document.getElementById('title'),
  status: document.getElementById('status'),
  editLink: document.getElementById('edit-link'),
  stageWrap: document.getElementById('stage-wrap'),
  motion: document.getElementById('motion'),
  play: document.getElementById('play'),
  bend: document.getElementById('bend'),
  showBones: document.getElementById('show-bones'),
  showMesh: document.getElementById('show-mesh'),
};

const state = {
  name: null,
  skeleton: null,
  texture: null,          // Pixi Texture
  bitmap: null,           // ImageBitmap of texture.png
  grid: null,
  bones: null,
  weighting: null,
  labels: null,           // { data, width, height, scale } bone ownership per pixel
  mesh: null,
  posed: null,            // Float32Array, skinned positions
  motions: [],
  motion: null,
  playing: true,
  time: 0,
  app: null,
  character: null,        // Container holding mesh and overlays
  bonesOverlay: null,
  meshOverlay: null,
};

async function boot() {
  const name = new URLSearchParams(location.search).get('name');
  if (!name) { setStatus('No character given. Go back and pick one.', 'error'); return; }
  state.name = name;
  el.title.textContent = name;
  document.title = `${name}: animate`;
  el.editLink.href = `editor.html?name=${encodeURIComponent(name)}`;

  try {
    const [bitmap, skeleton, motions] = await Promise.all([loadBitmap(name), loadSkeleton(name), loadMotionIndex()]);
    state.bitmap = bitmap;
    state.skeleton = skeleton;
    state.motions = motions;
    fillMotionSelect(motions);
    state.motion = await loadMotion(motions[0].id);
    await setupStage();
    buildRig();
    wireUi();
    state.app.ticker.add(tick);
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function loadBitmap(name) {
  const response = await fetch(characterFileUrl(name, 'texture.png'));
  if (!response.ok) throw new Error(`No texture for "${name}". Make the character first.`);
  return createImageBitmap(await response.blob());
}

async function loadSkeleton(name) {
  const response = await fetch(characterFileUrl(name, 'skeleton.json'));
  if (response.status === 404) throw new Error(`"${name}" has no skeleton yet. Give it one first.`);
  if (!response.ok) throw new Error('The skeleton could not be read.');
  const skeleton = await response.json();
  const problems = validate(skeleton);
  if (problems.length) throw new Error(`The skeleton has problems: ${problems.join('; ')}`);
  return skeleton;
}

async function loadMotionIndex() {
  const response = await fetch('motions/index.json');
  if (!response.ok) throw new Error('Motions could not be loaded.');
  return (await response.json()).motions;
}

async function loadMotion(id) {
  const entry = state.motions.find((m) => m.id === id);
  const response = await fetch(`motions/${entry.file}`);
  if (!response.ok) throw new Error(`Motion "${id}" could not be loaded.`);
  const motion = await response.json();
  const problems = validateMotion(motion);
  if (problems.length) throw new Error(`Motion "${id}" has problems: ${problems.join('; ')}`);
  return motion;
}

function fillMotionSelect(motions) {
  el.motion.replaceChildren(...motions.map((m) => {
    const option = document.createElement('option');
    option.value = m.id;
    option.textContent = m.name;
    return option;
  }));
}

// ---------- stage ----------

async function setupStage() {
  const app = new Application();
  await app.init({
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    backgroundColor: 0xffffff,
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  state.app = app;
  el.stageWrap.appendChild(app.canvas);
  app.canvas.classList.add('player-canvas');

  // Ground line, so a jump has something to leave.
  const ground = new Graphics();
  ground.moveTo(0, STAGE_HEIGHT * GROUND).lineTo(STAGE_WIDTH, STAGE_HEIGHT * GROUND).stroke({ width: 3, color: 0xd9d8d1 });
  app.stage.addChild(ground);

  state.character = new Container();
  app.stage.addChild(state.character);
  state.bonesOverlay = new Graphics();
  state.meshOverlay = new Graphics();
  state.character.addChild(state.meshOverlay, state.bonesOverlay);
}

// ---------- rig ----------

function buildRig() {
  const { bitmap, skeleton } = state;
  const width = bitmap.width, height = bitmap.height;

  // Alpha map at reduced resolution, to skip cells with nothing in them.
  const aw = Math.max(1, Math.round(width * ALPHA_SCALE));
  const ah = Math.max(1, Math.round(height * ALPHA_SCALE));
  const canvas = new OffscreenCanvas(aw, ah);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, aw, ah);
  const data = ctx.getImageData(0, 0, aw, ah).data;
  const alpha = new Uint8Array(aw * ah);
  for (let p = 0; p < alpha.length; p += 1) alpha[p] = data[p * 4 + 3] > 8 ? 255 : 0;

  const cellSize = Math.max(6, Math.round(Math.max(width, height) / GRID_CELLS_ON_LONG_SIDE));
  state.grid = buildGrid(width, height, cellSize, solidCellTester(alpha, aw, ah, ALPHA_SCALE, cellSize));
  state.bones = restBones(skeleton);

  // Which bone owns which pixel, at the alpha map's resolution.
  const segments = state.bones.map((b) => ({
    x1: b.x1 * ALPHA_SCALE, y1: b.y1 * ALPHA_SCALE, x2: b.x2 * ALPHA_SCALE, y2: b.y2 * ALPHA_SCALE,
  }));
  const halfWidths = measureBoneHalfWidths(alpha, aw, ah, segments);
  state.labels = { data: labelPixelsByThickness(alpha, aw, ah, segments, halfWidths), width: aw, height: ah, scale: ALPHA_SCALE };
  state.weighting = buildWeights();
  state.posed = new Float32Array(state.grid.positions);

  if (state.mesh) state.mesh.destroy();
  state.texture = state.texture ?? Texture.from(bitmap);
  const geometry = new MeshGeometry({
    positions: state.posed,
    uvs: state.grid.uvs,
    indices: state.grid.indices,
  });
  state.mesh = new Mesh({ geometry, texture: state.texture });
  state.character.addChildAt(state.mesh, 0);

  // Place the character: scaled to a share of the stage, feet on the ground line.
  const scale = (STAGE_HEIGHT * CHARACTER_HEIGHT) / height;
  state.character.scale.set(scale);
  state.character.position.set(STAGE_WIDTH / 2 - (width * scale) / 2, STAGE_HEIGHT * GROUND - height * scale);
}

// ---------- per frame ----------

// Seam softness: how far from a region boundary vertices blend, in grid cells.
function buildWeights() {
  const radius = Number(el.bend.value) * 0.5 * state.grid.cellSize;
  const { data, width, height, scale } = state.labels;
  return computeWeightsFromLabels(state.grid.positions, state.bones, data, width, height, scale, radius);
}

function tick(ticker) {
  if (state.playing) state.time += ticker.deltaMS / 1000;
  const pose = evaluateMotion(state.motion, state.time);
  const transforms = poseTransforms(state.skeleton, state.bones, pose);
  skin(state.grid.positions, transforms.bones, state.weighting, state.posed);
  state.mesh.geometry.getBuffer('aPosition').update();

  drawOverlays(transforms);
}

function drawOverlays(transforms) {
  const g = state.bonesOverlay;
  g.clear();
  if (el.showBones.checked) {
    for (const joint of depthOrder(state.skeleton)) {
      if (joint.parent === null) continue;
      const parent = jointById(state.skeleton, joint.parent);
      const [x1, y1] = mat.apply(transforms.joints.get(joint.id), parent.x, parent.y);
      const [x2, y2] = mat.apply(transforms.joints.get(joint.id), joint.x, joint.y);
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 10, color: 0x2456e6, alpha: 0.8 });
      g.circle(x2, y2, 9).fill({ color: 0xffffff }).stroke({ width: 3, color: 0x1f1d2b });
    }
    const root = rootOf(state.skeleton);
    const [rx, ry] = mat.apply(transforms.joints.get(root.id), root.x, root.y);
    g.rect(rx - 9, ry - 9, 18, 18).fill({ color: 0x2456e6 }).stroke({ width: 3, color: 0x1f1d2b });
  }

  const m = state.meshOverlay;
  m.clear();
  if (el.showMesh.checked) {
    const { indices } = state.grid;
    const p = state.posed;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 2, b = indices[i + 1] * 2, c = indices[i + 2] * 2;
      m.moveTo(p[a], p[a + 1]).lineTo(p[b], p[b + 1]).lineTo(p[c], p[c + 1]).lineTo(p[a], p[a + 1]);
    }
    m.stroke({ width: 1.5, color: 0x2456e6, alpha: 0.5 });
  }
}

// ---------- UI ----------

function wireUi() {
  el.motion.addEventListener('change', async () => {
    try {
      state.motion = await loadMotion(el.motion.value);
      state.time = 0;
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
  el.play.addEventListener('click', () => {
    state.playing = !state.playing;
    el.play.textContent = state.playing ? 'Pause' : 'Play';
  });
  el.bend.addEventListener('change', () => {
    state.weighting = buildWeights();
  });
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

boot();
