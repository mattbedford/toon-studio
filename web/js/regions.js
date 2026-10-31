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

// How thick is the drawing around each bone? Sampled at several points along
// the segment, walking out perpendicular until the ink ends (small gaps are
// bridged so anti-aliasing and pen texture do not stop the walk early).
// Returns the median half-width per bone, in pixels of the alpha map.
// A scribbled torso comes out wide, a stick arm narrow, a bone that lies on
// bare paper zero.
export function measureBoneHalfWidths(alpha, width, height, segments, { samples = 9, maxWalk = 400, gap = 2 } = {}) {
  const opaque = (x, y) => x >= 0 && y >= 0 && x < width && y < height && alpha[(y | 0) * width + (x | 0)] > 0;
  const walk = (x, y, nx, ny) => {
    let last = 0, misses = 0;
    for (let d = 1; d <= maxWalk; d += 1) {
      if (opaque(x + nx * d, y + ny * d)) { last = d; misses = 0; } else if ((misses += 1) > gap) break;
    }
    return last;
  };
  return Float64Array.from(segments.map((seg) => {
    const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length;
    const widths = [];
    for (let i = 0; i < samples; i += 1) {
      const t = (i + 0.5) / samples;
      const x = seg.x1 + dx * t, y = seg.y1 + dy * t;
      if (!opaque(x, y)) { widths.push(0); continue; }
      widths.push(Math.min(walk(x, y, nx, ny), walk(x, y, -nx, -ny)));
    }
    widths.sort((a, b) => a - b);
    return widths[Math.floor(widths.length / 2)];
  }));
}

// Like labelPixels, but thickness-aware. Each bone has a body: the band
// within its measured half-width (plus a small pad). A pixel inside one or
// more bodies goes to the nearest of those bones by plain distance. A pixel
// outside every body goes to the bone whose body edge is nearest. So a thick
// scribbled torso belongs to the bone running through it, a thin stick arm
// claims only its own line, and thickness never lets a bone reach beyond
// its own ink.
export function labelPixelsByThickness(alpha, width, height, segments, halfWidths, pad = 3) {
  const labels = new Int16Array(width * height).fill(-1);
  if (segments.length === 0) return labels;
  const bands = segments.map((_, i) => halfWidths[i] + pad);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (alpha[p] === 0) continue;
      let inside = -1, insideD = Infinity;
      let outside = -1, outsideD = Infinity;
      for (let s = 0; s < segments.length; s += 1) {
        const seg = segments[s];
        const d = Math.sqrt(segmentDistanceSq(x, y, seg.x1, seg.y1, seg.x2, seg.y2));
        if (d <= bands[s]) {
          if (d < insideD) { insideD = d; inside = s; }
        } else if (d - bands[s] < outsideD) {
          outsideD = d - bands[s]; outside = s;
        }
      }
      labels[p] = inside >= 0 ? inside : outside;
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
