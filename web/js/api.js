// Talks to the local helper (serve.py). Same origin only; the page's
// Content-Security-Policy forbids anything else.

export async function listCharacters() {
  const response = await fetch('/api/characters');
  if (!response.ok) throw new Error(`Could not list characters (${response.status})`);
  return (await response.json()).characters;
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

export function characterFileUrl(name, filename) {
  return `/data/characters/${encodeURIComponent(name)}/${filename}`;
}
