// Paper removal: turn a photo of a drawing on paper into a drawing on alpha.
//
// Approach:
//   1. Estimate the paper colour locally, not globally. Phone photos have shadows
//      and gradients, so a single colour removes one side of the page and leaves
//      the other. The image is split into cells; each cell's paper colour is the
//      average of its brightest pixels; cells are then dilated (so cells covered
//      by the drawing borrow from neighbours) and smoothed. The result is a small
//      grid that is sampled bilinearly per pixel.
//   2. Mark every pixel whose colour is within `threshold` of its local paper
//      colour as paper-like.
//   3. Flood-fill from the photo's edges through paper-like pixels. Everything the
//      fill reaches is outside the drawing and becomes transparent. Paper-like
//      pixels the fill cannot reach (a face inside an outline) stay opaque, which
//      is what a paper puppet wants.
//
// Pure functions over ImageData. No DOM, so they can be unit tested.

const CELL_TARGET = 48;        // cells across the shorter side of the image
const BRIGHT_FRACTION = 0.3;   // the brightest 30% of a cell is assumed to be paper

// Returns { cols, rows, cell, rgb: Float32Array(cols*rows*3) }.
export function estimatePaperMap(imageData) {
  const { data, width, height } = imageData;
  const cell = Math.max(4, Math.round(Math.min(width, height) / CELL_TARGET));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const rgb = new Float32Array(cols * rows * 3);
  const known = new Uint8Array(cols * rows);

  const lum = new Float32Array(cell * cell);
  const order = new Int32Array(cell * cell);

  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const x0 = cx * cell, y0 = cy * cell;
      const x1 = Math.min(width, x0 + cell), y1 = Math.min(height, y0 + cell);
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          lum[n] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          order[n] = i;
          n += 1;
        }
      }
      if (n === 0) continue;
      // Sort the cell's pixels by luminance, brightest first.
      const pairs = [];
      for (let k = 0; k < n; k += 1) pairs.push([lum[k], order[k]]);
      pairs.sort((a, b) => b[0] - a[0]);
      const take = Math.max(1, Math.round(n * BRIGHT_FRACTION));
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < take; k += 1) {
        const i = pairs[k][1];
        r += data[i]; g += data[i + 1]; b += data[i + 2];
      }
      const c = (cy * cols + cx) * 3;
      rgb[c] = r / take; rgb[c + 1] = g / take; rgb[c + 2] = b / take;
      known[cy * cols + cx] = 1;
    }
  }

  dilateBrightest(rgb, cols, rows);
  boxBlur(rgb, cols, rows);
  boxBlur(rgb, cols, rows);
  return { cols, rows, cell, rgb };
}

// Each cell takes the brightest of itself and its 8 neighbours. Cells covered by
// the drawing (dark everywhere) borrow real paper from next door.
function dilateBrightest(rgb, cols, rows) {
  const out = new Float32Array(rgb.length);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let best = -1, bi = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const i = (ny * cols + nx) * 3;
          const l = rgb[i] * 0.299 + rgb[i + 1] * 0.587 + rgb[i + 2] * 0.114;
          if (l > best) { best = l; bi = i; }
        }
      }
      const o = (y * cols + x) * 3;
      out[o] = rgb[bi]; out[o + 1] = rgb[bi + 1]; out[o + 2] = rgb[bi + 2];
    }
  }
  rgb.set(out);
}

function boxBlur(rgb, cols, rows) {
  const out = new Float32Array(rgb.length);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const i = (ny * cols + nx) * 3;
          r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; n += 1;
        }
      }
      const o = (y * cols + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  rgb.set(out);
}

// Bilinear sample of the paper map at pixel (x, y). Writes into out[0..2].
function samplePaper(map, x, y, out) {
  const { cols, rows, cell, rgb } = map;
  const fx = Math.min(cols - 1, Math.max(0, (x + 0.5) / cell - 0.5));
  const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / cell - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const i00 = (y0 * cols + x0) * 3, i10 = (y0 * cols + x1) * 3;
  const i01 = (y1 * cols + x0) * 3, i11 = (y1 * cols + x1) * 3;
  for (let c = 0; c < 3; c += 1) {
    const top = rgb[i00 + c] * (1 - tx) + rgb[i10 + c] * tx;
    const bottom = rgb[i01 + c] * (1 - tx) + rgb[i11 + c] * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
}

// Returns { imageData, bounds } where imageData is a new RGBA image with the
// paper transparent, and bounds is the box of opaque pixels (or null if none).
export function removePaper(imageData, paperMap, threshold) {
  const { data, width, height } = imageData;
  const count = width * height;
  const paperLike = new Uint8Array(count);
  const limit = threshold * threshold;
  const paper = [0, 0, 0];

  for (let p = 0, i = 0; p < count; p += 1, i += 4) {
    const x = p % width, y = (p - x) / width;
    samplePaper(paperMap, x, y, paper);
    const dr = data[i] - paper[0], dg = data[i + 1] - paper[1], db = data[i + 2] - paper[2];
    paperLike[p] = (dr * dr + dg * dg + db * db) <= limit ? 1 : 0;
  }

  const outside = floodFromEdges(paperLike, width, height);
  dropSmallPieces(outside, width, height);

  const out = new ImageData(width, height);
  const o = out.data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let p = 0, i = 0; p < count; p += 1, i += 4) {
    o[i] = data[i]; o[i + 1] = data[i + 1]; o[i + 2] = data[i + 2];
    if (outside[p]) {
      o[i + 3] = 0;
    } else {
      o[i + 3] = 255;
      const x = p % width, y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const bounds = maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { imageData: out, bounds };
}

// Breadth-first fill from every edge pixel through paper-like pixels.
function floodFromEdges(paperLike, width, height) {
  const count = width * height;
  const outside = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;

  const seed = (p) => {
    if (paperLike[p] && !outside[p]) { outside[p] = 1; queue[tail++] = p; }
  };
  for (let x = 0; x < width; x += 1) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { seed(y * width); seed(y * width + width - 1); }

  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < count - width) seed(p + width);
  }
  return outside;
}

// Specks of dust, the dark edge of the table, a corner of another sheet: these
// survive the flood because they are not paper-like, but they are not the
// drawing either. Be conservative: a stick figure is mostly thin, separate
// pieces (shorts that do not touch the torso, say) and losing one is far worse
// than keeping a speck. So drop only pieces that are dust-sized relative to
// the photo, and pieces that touch the photo's edge unless they are the
// largest piece. Everything else is treated as drawing.
const DUST_FRACTION = 0.0005;   // of the photo's pixel count

function dropSmallPieces(outside, width, height) {
  const count = width * height;
  const label = new Int32Array(count);      // 0 = unlabelled, else piece id
  const queue = new Int32Array(count);
  const areas = [0];                        // index = piece id
  const touchesEdge = [true];

  for (let start = 0; start < count; start += 1) {
    if (outside[start] || label[start]) continue;
    const id = areas.length;
    let head = 0, tail = 0, area = 0, edge = false;
    label[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++];
      area += 1;
      const x = p % width;
      if (x === 0 || x === width - 1 || p < width || p >= count - width) edge = true;
      const visit = (q) => { if (!outside[q] && !label[q]) { label[q] = id; queue[tail++] = q; } };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < count - width) visit(p + width);
    }
    areas.push(area);
    touchesEdge.push(edge);
  }

  const largest = Math.max(...areas);
  const largestId = areas.indexOf(largest);
  const dust = count * DUST_FRACTION;
  const keep = areas.map((area, id) => id === largestId || (area >= dust && !touchesEdge[id]));
  for (let p = 0; p < count; p += 1) {
    if (!outside[p] && !keep[label[p]]) outside[p] = 1;
  }
}

// Crop an RGBA ImageData to bounds plus padding. Returns a new ImageData.
export function crop(imageData, bounds, padding = 8) {
  const x0 = Math.max(0, bounds.x - padding);
  const y0 = Math.max(0, bounds.y - padding);
  const x1 = Math.min(imageData.width, bounds.x + bounds.width + padding);
  const y1 = Math.min(imageData.height, bounds.y + bounds.height + padding);
  const w = x1 - x0, h = y1 - y0;
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    const src = ((y0 + y) * imageData.width + x0) * 4;
    out.data.set(imageData.data.subarray(src, src + w * 4), y * w * 4);
  }
  return out;
}
