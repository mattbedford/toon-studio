// Which bone owns which pixel.
//
// For the editor's preview, each opaque pixel of the texture is handed to the
// nearest bone (point-to-segment distance). The result is a label map: one
// int per pixel, the bone's index in the list it was given, or -1 where the
// texture is transparent. Step 3 replaces this hard assignment with soft
// weights for the mesh; the geometry here is reused there.
//
// Pure typed-array maths, no DOM, testable in Node.

export function segmentDistanceSq(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = 0;
  if (lengthSq > 0) {
    t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const cx = x1 + t * dx - px, cy = y1 + t * dy - py;
  return cx * cx + cy * cy;
}

// alpha: Uint8Array or Uint8ClampedArray of width*height alpha values.
// segments: [{ x1, y1, x2, y2 }] in the same pixel space as the alpha map.
// Returns Int16Array labels.
export function labelPixels(alpha, width, height, segments) {
  const labels = new Int16Array(width * height).fill(-1);
  if (segments.length === 0) return labels;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (alpha[p] === 0) continue;
      let best = -1, bestD = Infinity;
      for (let s = 0; s < segments.length; s += 1) {
        const seg = segments[s];
        const d = segmentDistanceSq(x, y, seg.x1, seg.y1, seg.x2, seg.y2);
        if (d < bestD) { bestD = d; best = s; }
      }
      labels[p] = best;
    }
  }
  return labels;
}

// Pixel count per label. Useful for "this bone grabs nothing" warnings.
export function labelCounts(labels, segmentCount) {
  const counts = new Int32Array(segmentCount);
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] >= 0) counts[labels[i]] += 1;
  }
  return counts;
}
