import { estimatePaperMap, removePaper, crop } from './paper.js';
import { listCharacters, putCharacterFile, characterFileUrl } from './api.js';

// Working copies are capped at this many pixels on the long side. Plenty for a
// puppet texture, and keeps paper removal instant while the slider moves.
const MAX_WORKING_SIZE = 2000;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

const el = {
  drop: document.getElementById('drop'),
  file: document.getElementById('file'),
  workbench: document.getElementById('workbench'),
  original: document.getElementById('original'),
  result: document.getElementById('result'),
  threshold: document.getElementById('threshold'),
  thresholdValue: document.getElementById('threshold-value'),
  name: document.getElementById('name'),
  save: document.getElementById('save'),
  cancel: document.getElementById('cancel'),
  status: document.getElementById('status'),
  list: document.getElementById('character-list'),
  empty: document.getElementById('character-empty'),
};

const state = {
  sourceFile: null,     // the File the user dropped
  working: null,        // ImageData, downscaled working copy
  paper: null,          // local paper colour map, see paper.js
  removed: null,        // { imageData, bounds } for the current threshold
  pending: false,       // a removal is scheduled for the next frame
};

// ---------- loading a photo ----------

el.drop.addEventListener('click', () => el.file.click());
el.drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.file.click(); }
});
el.file.addEventListener('change', () => { if (el.file.files[0]) loadPhoto(el.file.files[0]); });

for (const type of ['dragenter', 'dragover']) {
  el.drop.addEventListener(type, (event) => { event.preventDefault(); el.drop.classList.add('over'); });
}
for (const type of ['dragleave', 'drop']) {
  el.drop.addEventListener(type, (event) => { event.preventDefault(); el.drop.classList.remove('over'); });
}
el.drop.addEventListener('drop', (event) => {
  const file = [...event.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (file) loadPhoto(file);
});

async function loadPhoto(file) {
  setStatus('');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    setStatus(`That file could not be read as an image. ${error.message}`, 'error');
    return;
  }
  const scale = Math.min(1, MAX_WORKING_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  el.original.width = width;
  el.original.height = height;
  const ctx = el.original.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  state.sourceFile = file;
  state.working = ctx.getImageData(0, 0, width, height);
  state.paper = estimatePaperMap(state.working);

  el.result.width = width;
  el.result.height = height;
  el.workbench.hidden = false;
  el.drop.hidden = true;
  if (!el.name.value) el.name.value = suggestName(file.name);
  scheduleRemoval();
}

function suggestName(filename) {
  return filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41);
}

// ---------- paper removal ----------

el.threshold.addEventListener('input', () => {
  el.thresholdValue.value = el.threshold.value;
  scheduleRemoval();
});

function scheduleRemoval() {
  if (state.pending) return;
  state.pending = true;
  requestAnimationFrame(() => {
    state.pending = false;
    runRemoval();
  });
}

function runRemoval() {
  if (!state.working) return;
  const threshold = Number(el.threshold.value);
  state.removed = removePaper(state.working, state.paper, threshold);
  el.result.getContext('2d').putImageData(state.removed.imageData, 0, 0);
  el.save.disabled = state.removed.bounds === null;
}

// ---------- saving ----------

el.save.addEventListener('click', saveCharacter);
el.cancel.addEventListener('click', reset);
el.name.addEventListener('input', () => setStatus(''));

async function saveCharacter() {
  const name = el.name.value.trim();
  if (!NAME_PATTERN.test(name)) {
    setStatus('Pick a name using lowercase letters, numbers and dashes, starting with a letter or number.', 'error');
    el.name.focus();
    return;
  }
  if (!state.removed || !state.removed.bounds) {
    setStatus('Nothing to save: the whole photo was treated as paper. Slide the threshold left.', 'error');
    return;
  }

  el.save.disabled = true;
  setStatus('Saving...');
  try {
    const texture = crop(state.removed.imageData, state.removed.bounds, 8);
    const texturePng = await imageDataToPng(texture);
    const drawingPng = await canvasToPng(el.original);
    const meta = {
      name,
      created: new Date().toISOString(),
      source: { filename: state.sourceFile.name, type: state.sourceFile.type },
      working: { width: state.working.width, height: state.working.height },
      paper: { threshold: Number(el.threshold.value) },
      texture: { width: texture.width, height: texture.height, bounds: state.removed.bounds },
    };
    await putCharacterFile(name, 'drawing.png', drawingPng, 'image/png');
    await putCharacterFile(name, 'texture.png', texturePng, 'image/png');
    await putCharacterFile(name, 'character.json', JSON.stringify(meta, null, 2), 'application/json');
    setStatus(`Saved "${name}". Next up: giving it a skeleton.`, 'ok');
    await refreshList();
  } catch (error) {
    setStatus(`Could not save: ${error.message}`, 'error');
  } finally {
    el.save.disabled = false;
  }
}

function imageDataToPng(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvasToPng(canvas);
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

function reset() {
  state.sourceFile = null;
  state.working = null;
  state.removed = null;
  el.file.value = '';
  el.name.value = '';
  el.workbench.hidden = true;
  el.drop.hidden = false;
  setStatus('');
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

// ---------- character list ----------

async function refreshList() {
  let characters = [];
  try {
    characters = await listCharacters();
  } catch (error) {
    setStatus(error.message, 'error');
  }
  el.list.replaceChildren(...characters.map(renderCharacter));
  el.empty.hidden = characters.length > 0;
}

function renderCharacter(character) {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.alt = '';
  img.src = character.files.includes('texture.png') ? characterFileUrl(character.name, 'texture.png') : '';
  const text = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = character.name;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = character.files.includes('skeleton.json') ? 'rigged' : 'no skeleton yet';
  text.append(name, meta);
  li.append(img, text);
  return li;
}

refreshList();
