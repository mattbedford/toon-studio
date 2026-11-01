// Renders characters on the 16:9 stage. This is the renderer the stage
// (step 2), the timeline (step 3) and the export (step 6) all build on.
//
// A character on stage is one PixiJS container holding the pose sprite and,
// on top of it, one sprite per face part type (eyes, mouth, brows) placed at
// the pose's face anchor. Swapping a pose or a part swaps a texture; nothing
// else moves. Step 1 only shows the default pose with the default face.

// PixiJS is loaded as a classic script (see web/vendor/VENDOR.md for why) and
// found on the global, together with its CSP-friendly add-on.
const { Application, Sprite, Texture, Graphics, Container } = window.PIXI;

import { getCharacter, characterFileUrl } from './api.js';
import { STAGE, DEFAULT_CHARACTER_HEIGHT } from './config.js';

const FACE_TYPES = ['eyes', 'mouth', 'brows'];

const el = {
  title: document.getElementById('title'),
  status: document.getElementById('status'),
  caption: document.getElementById('caption'),
  stageWrap: document.getElementById('stage-wrap'),
};

// ---------- a character on stage ----------

export class StageCharacter {
  constructor(manifest) {
    this.manifest = manifest;
    this.container = new Container();
    this.pose = new Sprite();
    this.container.addChild(this.pose);
    this.parts = {};
    for (const kind of FACE_TYPES) {
      this.parts[kind] = new Sprite();
      this.parts[kind].visible = false;
      this.container.addChild(this.parts[kind]);
    }
    this.poseName = null;
    this.face = { eyes: null, mouth: null, brows: null };
  }

  async setPose(name) {
    const { manifest } = this;
    if (!manifest.poses.includes(name)) throw new Error(`"${manifest.title}" has no pose called "${name}".`);
    this.pose.texture = await loadTexture(characterFileUrl(manifest, `pose.${name}.png`));
    this.poseName = name;
    this.placeFace();
  }

  async setFace(kind, name) {
    const { manifest } = this;
    const sprite = this.parts[kind];
    if (!name || manifest.no_face_swap.includes(this.poseName)) {
      sprite.visible = false;
      this.face[kind] = null;
      return;
    }
    if (kind === 'mouth' && manifest.no_mouth_swap.includes(this.poseName)) {
      sprite.visible = false;
      this.face[kind] = null;
      return;
    }
    const available = (manifest.pose_faces[this.poseName] || {})[kind]?.length
      ? manifest.pose_faces[this.poseName][kind] : manifest.faces[kind];
    if (!available.includes(name)) {
      sprite.visible = false;
      this.face[kind] = null;
      return;
    }
    const folder = manifest.pose_faces[this.poseName]?.[kind]?.includes(name) ? `${this.poseName}/` : '';
    sprite.texture = await loadTexture(characterFileUrl(manifest, `${folder}${kind}.${name}.png`));
    sprite.visible = true;
    this.face[kind] = name;
    this.placeFace();
  }

  placeFace() {
    const anchor = this.manifest.anchors[this.poseName] || { x: 0, y: 0 };
    for (const kind of FACE_TYPES) this.parts[kind].position.set(anchor.x, anchor.y);
  }
}

const textures = new Map();
async function loadTexture(url) {
  if (!textures.has(url)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Missing image: ${url}`);
    const bitmap = await createImageBitmap(await response.blob());
    textures.set(url, Texture.from(bitmap));
  }
  return textures.get(url);
}

// ---------- the stage ----------

export async function createStage(mount) {
  const app = new Application();
  await app.init({
    width: STAGE.width, height: STAGE.height, backgroundColor: 0xffffff, antialias: true,
    resolution: 1, autoDensity: false,
  });
  mount.appendChild(app.canvas);
  app.canvas.classList.add('player-canvas');
  const ground = new Graphics();
  ground.moveTo(0, STAGE.height * 0.96).lineTo(STAGE.width, STAGE.height * 0.96).stroke({ width: 3, color: 0xd9d8d1 });
  app.stage.addChild(ground);
  return app;
}

// Place a character so its canvas is DEFAULT_CHARACTER_HEIGHT of the stage,
// centred, feet (the canvas baseline) on the ground line.
function placeOnStage(character, app) {
  const [canvasW, canvasH] = character.manifest.canvas;
  const scale = (STAGE.height * DEFAULT_CHARACTER_HEIGHT) / canvasH;
  const baseline = character.manifest.baseline ?? canvasH;
  character.container.scale.set(scale);
  character.container.position.set(STAGE.width / 2 - (canvasW * scale) / 2, STAGE.height * 0.96 - baseline * scale);
  app.stage.addChild(character.container);
}

// ---------- the preview page ----------

async function boot() {
  const name = new URLSearchParams(location.search).get('name');
  if (!name) { setStatus('No character given. Go back and pick one.', 'error'); return; }
  try {
    const manifest = await getCharacter(name);
    el.title.textContent = manifest.title;
    document.title = `${manifest.title}: preview`;
    if (!manifest.default_pose) throw new Error(`"${manifest.title}" has no default pose. ${manifest.problems.join(' ')}`);
    const app = await createStage(el.stageWrap);
    const character = new StageCharacter(manifest);
    await character.setPose(manifest.default_pose);
    for (const kind of FACE_TYPES) await character.setFace(kind, manifest.default_face[kind]);
    placeOnStage(character, app);
    const face = FACE_TYPES.filter((k) => character.face[k]).map((k) => `${k} ${character.face[k]}`).join(', ');
    el.caption.textContent = `${manifest.default_pose}, ${face || 'no face parts'}. ${manifest.poses.length} poses available.`
      + (manifest.problems.length ? ` Problems: ${manifest.problems.join(' ')}` : '');
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

if (el.stageWrap) boot();
