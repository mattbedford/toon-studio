// The front page: the cast (shipped characters and hers) and the Krita importer.

import { listCharacters, importOra, putCharacterFile, characterFileUrl } from './api.js';
import { NAME_PATTERN } from './config.js';

const el = {
  list: document.getElementById('character-list'),
  empty: document.getElementById('character-empty'),
  drop: document.getElementById('drop'),
  file: document.getElementById('file'),
  name: document.getElementById('name'),
  status: document.getElementById('status'),
};

// ---------- the cast ----------

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
  if (character.thumb) img.src = character.thumb;

  const text = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'name';
  title.textContent = character.title;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const faces = ['eyes', 'mouth', 'brows'].map((kind) => `${character.faces[kind].length} ${kind}`).join(', ');
  meta.textContent = `${character.source === 'shipped' ? 'From the kit' : 'Yours'}. ${character.poses.length} poses, ${faces}.`;
  text.append(title, meta);
  if (character.problems.length) {
    const problems = document.createElement('div');
    problems.className = 'problems';
    problems.textContent = character.problems.join(' ');
    text.append(problems);
  }

  const links = document.createElement('div');
  links.className = 'links';
  const preview = document.createElement('a');
  preview.className = 'rig';
  preview.href = `play.html?name=${encodeURIComponent(character.name)}`;
  preview.textContent = 'Preview';
  if (!character.poses.length || !character.default_pose) preview.setAttribute('aria-disabled', 'true');
  links.append(preview);

  li.append(img, text, links);
  return li;
}

// ---------- importing a Krita file ----------

el.drop.addEventListener('click', () => el.file.click());
el.drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.file.click(); }
});
el.file.addEventListener('change', () => { if (el.file.files[0]) importFile(el.file.files[0]); });
for (const type of ['dragenter', 'dragover']) {
  el.drop.addEventListener(type, (event) => { event.preventDefault(); el.drop.classList.add('over'); });
}
for (const type of ['dragleave', 'drop']) {
  el.drop.addEventListener(type, (event) => { event.preventDefault(); el.drop.classList.remove('over'); });
}
el.drop.addEventListener('drop', (event) => {
  const file = [...event.dataTransfer.files].find((f) => f.name.toLowerCase().endsWith('.ora'));
  if (file) importFile(file);
  else setStatus('Drop a .ora file exported from Krita.', 'error');
});
el.name.addEventListener('input', () => setStatus(''));

async function importFile(file) {
  const name = (el.name.value.trim() || suggestName(file.name));
  if (!NAME_PATTERN.test(name)) {
    setStatus('Pick a name using lowercase letters, numbers and dashes, starting with a letter or number.', 'error');
    el.name.focus();
    return;
  }
  setStatus(`Importing "${file.name}"...`);
  try {
    const summary = await importOra(name, file);
    await makeThumbnail(summary.character);
    const ignored = summary.ignored.length ? ` Ignored layers: ${summary.ignored.join(', ')}.` : '';
    setStatus(`Imported "${name}": ${summary.written.length} layers.${ignored}`, 'ok');
    el.file.value = '';
    await refreshList();
  } catch (error) {
    setStatus(`Could not import: ${error.message}`, 'error');
  }
}

function suggestName(filename) {
  return filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41);
}

// The helper has no image library, so the browser makes the thumbnail: the
// default pose cropped to its opaque box and scaled to 256 px tall.
async function makeThumbnail(manifest) {
  if (!manifest || !manifest.default_pose) return;
  const response = await fetch(characterFileUrl(manifest, `pose.${manifest.default_pose}.png`));
  if (!response.ok) return;
  const bitmap = await createImageBitmap(await response.blob());
  const probe = document.createElement('canvas');
  probe.width = bitmap.width;
  probe.height = bitmap.height;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const box = opaqueBox(ctx.getImageData(0, 0, probe.width, probe.height));
  if (!box) return;
  const height = 256;
  const width = Math.max(1, Math.round((box.w * height) / box.h));
  const thumb = document.createElement('canvas');
  thumb.width = width;
  thumb.height = height;
  thumb.getContext('2d').drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) => thumb.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  await putCharacterFile(manifest.name, 'thumb.png', blob, 'image/png');
}

function opaqueBox(imageData) {
  const { width, height, data } = imageData;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

refreshList();
