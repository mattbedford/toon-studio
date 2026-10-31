// Builds the character's pieces at full resolution and saves them, and loads
// her paint (pen and eraser overrides) back. Browser-only: needs canvases.
//
// On disk, next to texture.png and skeleton.json:
//   parts/<bone id>.png   one cropped RGBA image per piece
//   parts.json            where each piece sits, its pivot, draw order
//   paint.png             her overrides, grey, at the editor's working size
//
// A piece is positioned by its top-left corner (x, y) in texture pixels and
// turns about its pivot, the joint at the start of its bone.

import { restBones } from './rig.js';
import { measureBoneHalfWidths, labelPixelsByThickness } from './regions.js';
import { applyOverrides, resampleLabels, capRadius, cutPieces, encodeOverrides, decodeOverrides, emptyOverrides } from './pieces.js';
import { putCharacterFile, characterFileUrl } from './api.js';

export const PARTS_VERSION = 1;

// Reads RGBA and a 0/255 alpha mask off an ImageBitmap at a given size.
export function rasterise(bitmap, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const alpha = new Uint8Array(width * height);
  for (let p = 0; p < alpha.length; p += 1) alpha[p] = image.data[p * 4 + 3] > 8 ? 255 : 0;
  return { image, alpha };
}

// Automatic labels for a skeleton over an alpha map of the given scale.
export function autoLabels(alpha, width, height, scale, skeleton) {
  const bones = restBones(skeleton);
  const segments = bones.map((b) => ({ x1: b.x1 * scale, y1: b.y1 * scale, x2: b.x2 * scale, y2: b.y2 * scale }));
  const halfWidths = measureBoneHalfWidths(alpha, width, height, segments, { maxWalk: Math.round(400 * scale) + 20 });
  const labels = labelPixelsByThickness(alpha, width, height, segments, halfWidths);
  return { bones, segments, halfWidths, labels };
}

// Cut pieces at any scale (1 = full texture resolution). overrides are at
// paintSize and get resampled. Returns { pieces, bones, caps, halfWidths }.
export function cutAtScale(bitmap, skeleton, scale, overrides, paintSize) {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const { image, alpha } = rasterise(bitmap, width, height);
  const { bones, segments, halfWidths, labels } = autoLabels(alpha, width, height, scale, skeleton);
  const scaledOverrides = overrides
    ? resampleLabels(overrides, paintSize.width, paintSize.height, width, height)
    : emptyOverrides(width, height);
  const finalLabels = applyOverrides(labels, scaledOverrides, alpha);
  const caps = Float64Array.from(halfWidths.map((hw) => capRadius(hw)));
  const pieces = cutPieces(image.data, width, height, finalLabels, segments, caps);
  return { pieces, bones, segments, caps, halfWidths, labels: finalLabels, width, height, scale };
}

async function imageDataToPngBlob(data, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

// Cut at full resolution and save everything. Returns the parts manifest.
export async function buildAndSavePieces(name, bitmap, skeleton, overrides, paintSize) {
  const cut = cutAtScale(bitmap, skeleton, 1, overrides, paintSize);
  const boneIds = cut.bones.map((b) => b.jointId);

  const manifest = {
    version: PARTS_VERSION,
    texture: { width: bitmap.width, height: bitmap.height },
    paint: { width: paintSize.width, height: paintSize.height, order: boneIds },
    pieces: [],
  };

  for (const piece of cut.pieces) {
    const bone = cut.bones[piece.bone];
    const file = `parts/${bone.jointId}.png`;
    const blob = await imageDataToPngBlob(piece.data, piece.width, piece.height);
    await putCharacterFile(name, file, blob, 'image/png');
    manifest.pieces.push({
      id: bone.jointId,
      file,
      x: piece.x,
      y: piece.y,
      width: piece.width,
      height: piece.height,
      pivot: { x: bone.x1, y: bone.y1 },
      order: manifest.pieces.length,
    });
  }

  const { grey } = encodeOverrides(overrides, boneIds);
  const greyRgba = new Uint8ClampedArray(grey.length * 4);
  for (let p = 0; p < grey.length; p += 1) {
    greyRgba[p * 4] = grey[p]; greyRgba[p * 4 + 1] = grey[p]; greyRgba[p * 4 + 2] = grey[p]; greyRgba[p * 4 + 3] = 255;
  }
  await putCharacterFile(name, 'paint.png', await imageDataToPngBlob(greyRgba, paintSize.width, paintSize.height), 'image/png');
  await putCharacterFile(name, 'parts.json', JSON.stringify(manifest, null, 2), 'application/json');
  return manifest;
}

// Load saved overrides for the current skeleton, resampled to paintSize if
// the saved size differs. Returns empty overrides when nothing is saved.
export async function loadOverrides(name, skeleton, paintSize) {
  const empty = emptyOverrides(paintSize.width, paintSize.height);
  const manifestResponse = await fetch(characterFileUrl(name, 'parts.json'));
  if (!manifestResponse.ok) return empty;
  const manifest = await manifestResponse.json();
  if (!manifest.paint) return empty;
  const paintResponse = await fetch(characterFileUrl(name, 'paint.png'));
  if (!paintResponse.ok) return empty;
  const bitmap = await createImageBitmap(await paintResponse.blob());
  const { image } = rasterise(bitmap, bitmap.width, bitmap.height);
  const grey = new Uint8Array(bitmap.width * bitmap.height);
  for (let p = 0; p < grey.length; p += 1) grey[p] = image.data[p * 4];
  const currentIds = restBones(skeleton).map((b) => b.jointId);
  let overrides = decodeOverrides(grey, manifest.paint.order ?? [], currentIds);
  if (bitmap.width !== paintSize.width || bitmap.height !== paintSize.height) {
    overrides = resampleLabels(overrides, bitmap.width, bitmap.height, paintSize.width, paintSize.height);
  }
  return overrides;
}
