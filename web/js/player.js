// Plays a character with a preset motion on a 1280x720 stage.
//
// The character is its pieces (parts.json), each a PixiJS sprite that turns
// rigidly about its pivot. Every frame: sample the motion, work out the bone
// transforms (rig.js), apply each piece's transform. Step 4 feeds the same
// pose from the webcam.

// PixiJS is loaded as a classic script (see web/vendor/VENDOR.md for why) and
// found on the global, together with its CSP-friendly add-on.
const { Application, Sprite, Texture, Graphics, Container, Matrix } = window.PIXI;

import { validate, depthOrder, jointById, rootOf } from './skeleton.js';
import { restBones, poseTransforms, mat } from './rig.js';
import { validateMotion, evaluateMotion } from './motion.js';
import { characterFileUrl } from './api.js';

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;
const CHARACTER_HEIGHT = 0.78;     // of the stage height
const GROUND = 0.94;               // feet sit here, as a fraction of stage height

const el = {
  title: document.getElementById('title'),
  status: document.getElementById('status'),
  editLink: document.getElementById('edit-link'),
  stageWrap: document.getElementById('stage-wrap'),
  motion: document.getElementById('motion'),
  play: document.getElementById('play'),
  showBones: document.getElementById('show-bones'),
};

const state = {
  name: null,
  skeleton: null,
  parts: null,            // parts.json manifest
  bones: null,
  pieces: [],             // [{ id, container }]
  motions: [],
  motion: null,
  playing: true,
  time: 0,
  app: null,
  character: null,
  bonesOverlay: null,
};

async function boot() {
  const name = new URLSearchParams(location.search).get('name');
  if (!name) { setStatus('No character given. Go back and pick one.', 'error'); return; }
  state.name = name;
  el.title.textContent = name;
  document.title = `${name}: animate`;
  el.editLink.href = `editor.html?name=${encodeURIComponent(name)}`;

  try {
    const [skeleton, parts, motions] = await Promise.all([loadSkeleton(name), loadParts(name), loadMotionIndex()]);
    state.skeleton = skeleton;
    state.parts = parts;
    state.motions = motions;
    fillMotionSelect(motions);
    state.motion = await loadMotion(motions[0].id);
    await setupStage();
    await buildPuppet();
    wireUi();
    state.app.ticker.add(tick);
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
  }
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

async function loadParts(name) {
  const response = await fetch(characterFileUrl(name, 'parts.json'));
  if (response.status === 404) throw new Error(`"${name}" has no pieces yet. Open the skeleton editor and save.`);
  if (!response.ok) throw new Error('The pieces could not be read.');
  return response.json();
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
  el.motion.replaceChildren(...motions.map((m) => Object.assign(document.createElement('option'), { value: m.id, textContent: m.name })));
}

// ---------- stage ----------

async function setupStage() {
  const app = new Application();
  await app.init({
    width: STAGE_WIDTH, height: STAGE_HEIGHT, backgroundColor: 0xffffff, antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true,
  });
  state.app = app;
  el.stageWrap.appendChild(app.canvas);
  app.canvas.classList.add('player-canvas');

  const ground = new Graphics();
  ground.moveTo(0, STAGE_HEIGHT * GROUND).lineTo(STAGE_WIDTH, STAGE_HEIGHT * GROUND).stroke({ width: 3, color: 0xd9d8d1 });
  app.stage.addChild(ground);

  state.character = new Container();
  app.stage.addChild(state.character);
  state.bonesOverlay = new Graphics();
}

// ---------- puppet ----------

async function buildPuppet() {
  const { parts, skeleton } = state;
  const { width, height } = parts.texture;
  state.bones = restBones(skeleton);

  const pieces = [...parts.pieces].sort((a, b) => a.order - b.order);
  for (const piece of pieces) {
    if (!jointById(skeleton, piece.id)) continue;   // a bone that no longer exists
    const image = await loadImage(characterFileUrl(state.name, piece.file));
    const sprite = new Sprite(Texture.from(image));
    sprite.position.set(piece.x, piece.y);
    const container = new Container();
    container.addChild(sprite);
    state.character.addChild(container);
    state.pieces.push({ id: piece.id, container });
  }
  state.character.addChild(state.bonesOverlay);

  const scale = (STAGE_HEIGHT * CHARACTER_HEIGHT) / height;
  state.character.scale.set(scale);
  state.character.position.set(STAGE_WIDTH / 2 - (width * scale) / 2, STAGE_HEIGHT * GROUND - height * scale);
}

async function loadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`A piece is missing (${url}). Save the skeleton again.`);
  return createImageBitmap(await response.blob());
}

// ---------- per frame ----------

function tick(ticker) {
  if (state.playing) state.time += ticker.deltaMS / 1000;
  const pose = evaluateMotion(state.motion, state.time);
  const transforms = poseTransforms(state.skeleton, state.bones, pose);
  for (const piece of state.pieces) {
    const m = transforms.joints.get(piece.id);
    piece.container.setFromMatrix(new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]));
  }
  drawBones(transforms);
}

function drawBones(transforms) {
  const g = state.bonesOverlay;
  g.clear();
  if (!el.showBones.checked) return;
  for (const joint of depthOrder(state.skeleton)) {
    if (joint.parent === null) continue;
    const parent = jointById(state.skeleton, joint.parent);
    const m = transforms.joints.get(joint.id);
    const [x1, y1] = mat.apply(m, parent.x, parent.y);
    const [x2, y2] = mat.apply(m, joint.x, joint.y);
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 10, color: 0x2456e6, alpha: 0.8 });
    g.circle(x2, y2, 9).fill({ color: 0xffffff }).stroke({ width: 3, color: 0x1f1d2b });
  }
  const root = rootOf(state.skeleton);
  const [rx, ry] = mat.apply(transforms.joints.get(root.id), root.x, root.y);
  g.rect(rx - 9, ry - 9, 18, 18).fill({ color: 0x2456e6 }).stroke({ width: 3, color: 0x1f1d2b });
}

// ---------- UI ----------

function wireUi() {
  el.motion.addEventListener('change', async () => {
    try { state.motion = await loadMotion(el.motion.value); state.time = 0; } catch (error) { setStatus(error.message, 'error'); }
  });
  el.play.addEventListener('click', () => {
    state.playing = !state.playing;
    el.play.textContent = state.playing ? 'Pause' : 'Play';
  });
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

boot();
