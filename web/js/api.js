// Talks to the local helper (serve.py). Same origin only; the page's
// Content-Security-Policy forbids anything else.

export async function listCharacters() {
  const response = await fetch('/api/characters');
  if (!response.ok) throw new Error(`Could not list characters (${response.status})`);
  return (await response.json()).characters;
}

export async function getCharacter(name) {
  const response = await fetch(`/api/characters/${encodeURIComponent(name)}`);
  if (response.status === 404) throw new Error(`There is no character called "${name}".`);
  if (!response.ok) throw new Error(`Could not read "${name}" (${response.status})`);
  return response.json();
}

export async function putCharacterFile(name, filename, body, contentType) {
  const response = await fetch(`/api/characters/${encodeURIComponent(name)}/${filename}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Save failed (${response.status})`);
  return payload;
}

export async function importOra(name, file) {
  const response = await fetch(`/api/import/ora?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Import failed (${response.status})`);
  return payload;
}

// URL of one file of a character, using the manifest's own base so shipped
// and imported characters are handled the same way.
export function characterFileUrl(manifest, filename) {
  return manifest.url + filename;
}
