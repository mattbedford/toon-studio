// Pieces: the drawing cut into one part per bone, like a paper puppet.
//
// The automatic cut comes from the label map (regions.js): every opaque pixel
// belongs to one bone. On top of that sit her overrides, painted with the pen
// (this pixel belongs to that piece) and the eraser (this pixel belongs to no
// piece). Overrides are kept separately from the automatic labels so moving a
// joint re-cuts the drawing without losing her corrections.
//
// Each piece also gets a round "cap" of pixels around its pivot joint, copied
// from whatever is there, so turning the piece never opens a gap at the joint.
// Paper puppets do the same with a circle of card behind each joint.
//
// Pure functions on typed arrays. Tested in Node.

export const NO_OVERRIDE = -2;   // use the automatic label
export const ERASED = -1;        // belongs to no piece

export function emptyOverrides(width, height) {
  return new Int16Array(width * height).fill(NO_OVERRIDE);
}

// Final labels = automatic labels with overrides on top. Transparent pixels
// stay unlabelled whatever the overrides say.
export function applyOverrides(labels, overrides, alpha) {
  const out = new Int16Array(labels.length);
  for (let p = 0; p < labels.length; p += 1) {
    if (alpha[p] === 0) { out[p] = -1; continue; }
    const o = overrides[p];
    out[p] = o === NO_OVERRIDE ? labels[p] : o;
  }
  return out;
}

// Stamp a disc of `value` into overrides. Returns true if anything changed.
export function paintCircle(overrides, width, height, cx, cy, radius, value) {
  let changed = false;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const p = y * width + x;
      if (overrides[p] !== value) { overrides[p] = value; changed = true; }
    }
  }
  return changed;
}

// Overrides are stored as a grey PNG: 0 = no override, 255 = erased,
// otherwise 1 + position of the bone id in `order`. The order is saved next
// to the image so bones can be renamed, added or deleted between sessions.
export function encodeOverrides(overrides, boneIds) {
  const grey = new Uint8Array(overrides.length);
  for (let p = 0; p < overrides.length; p += 1) {
    const o = overrides[p];
    grey[p] = o === NO_OVERRIDE ? 0 : o === ERASED ? 255 : Math.min(254, o + 1);
  }
  return { grey, order: boneIds.slice() };
}

export function decodeOverrides(grey, savedOrder, currentBoneIds) {
  const remap = savedOrder.map((id) => currentBoneIds.indexOf(id));
  const out = new Int16Array(grey.length);
  for (let p = 0; p < grey.length; p += 1) {
    const g = grey[p];
    if (g === 0) { out[p] = NO_OVERRIDE; continue; }
    if (g === 255) { out[p] = ERASED; continue; }
    const mapped = remap[g - 1];
    out[p] = mapped === undefined || mapped < 0 ? NO_OVERRIDE : mapped;
  }
  return out;
}

// Nearest-neighbour resample of a label map (or overrides) to another size.
export function resampleLabels(labels, width, height, newWidth, newHeight) {
  const out = new Int16Array(newWidth * newHeight);
  for (let y = 0; y < newHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / newHeight));
    for (let x = 0; x < newWidth; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / newWidth));
      out[y * newWidth + x] = labels[sy * width + sx];
    }
  }
  return out;
}

// Radius of the overlap cap at a piece's pivot, from the bone's measured
// half-width (in the same pixels as the cut). Thin limbs get a small cap,
// a thick neck a bigger one.
export function capRadius(halfWidth) {
  return Math.min(80, Math.max(8, halfWidth * 2 + 6));
}

// Cut the texture into pieces.
//   rgba: Uint8ClampedArray width*height*4 (the texture)
//   labels: Int16Array width*height, final labels (after overrides)
//   bones: [{ x1, y1 }] pivot per bone, same pixel space
//   caps: Float64Array radius per bone (0 for none)
// Returns [{ bone, x, y, width, height, data, pixels }], pixels = opaque count.
// Pieces with no pixels are omitted.
export function cutPieces(rgba, width, height, labels, bones, caps) {
  const pieces = [];
  for (let b = 0; b < bones.length; b += 1) {
    const px = bones[b].x1, py = bones[b].y1, r = caps[b] || 0, r2 = r * r;
    let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
    const mine = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (rgba[p * 4 + 3] === 0) continue;
        const dx = x - px, dy = y - py;
        if (labels[p] !== b && dx * dx + dy * dy > r2) continue;
        if (labels[p] < 0 && dx * dx + dy * dy > r2) continue;
        mine[p] = 1;
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (count === 0) continue;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = (minY + y) * width + (minX + x);
        if (!mine[p]) continue;
        data.set(rgba.subarray(p * 4, p * 4 + 4), (y * w + x) * 4);
      }
    }
    pieces.push({ bone: b, x: minX, y: minY, width: w, height: h, data, pixels: count });
  }
  return pieces;
}

// Where to draw each piece when exploded: pushed away from `centre` along the
// line through the piece's pivot, by `spread` times the distance. spread 0
// is the assembled drawing.
export function explodeOffsets(pieces, bones, centre, spread) {
  return pieces.map((piece) => {
    const pivotX = bones[piece.bone].x1, pivotY = bones[piece.bone].y1;
    const dx = pivotX - centre.x, dy = pivotY - centre.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return { x: 0, y: 0 };
    return { x: dx * spread || 0, y: dy * spread || 0 };   // `|| 0` turns -0 into 0
  });
}
