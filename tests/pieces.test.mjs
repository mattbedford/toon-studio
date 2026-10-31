// Unit tests for the piece cutting module.
// Run with:  node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_OVERRIDE, ERASED, emptyOverrides, applyOverrides, paintCircle,
  encodeOverrides, decodeOverrides, resampleLabels, capRadius, cutPieces, explodeOffsets,
} from '../web/js/pieces.js';

test('applyOverrides respects pen, eraser and transparency', () => {
  const labels = Int16Array.from([0, 0, 1, 1]);
  const alpha = Uint8Array.from([255, 255, 255, 0]);
  const overrides = Int16Array.from([NO_OVERRIDE, 1, ERASED, 0]);
  assert.deepEqual(Array.from(applyOverrides(labels, overrides, alpha)), [0, 1, -1, -1]);
});

test('paintCircle stamps a disc and reports changes', () => {
  const overrides = emptyOverrides(5, 5);
  assert.equal(paintCircle(overrides, 5, 5, 2, 2, 1, 3), true);
  assert.equal(overrides[2 * 5 + 2], 3);
  assert.equal(overrides[2 * 5 + 3], 3);
  assert.equal(overrides[0], NO_OVERRIDE);
  assert.equal(paintCircle(overrides, 5, 5, 2, 2, 1, 3), false);   // nothing new
});

test('overrides survive a round trip through grey values and a bone reorder', () => {
  const overrides = Int16Array.from([NO_OVERRIDE, ERASED, 0, 1, 2]);
  const { grey, order } = encodeOverrides(overrides, ['hip', 'chest', 'head']);
  assert.deepEqual(Array.from(grey), [0, 255, 1, 2, 3]);
  // Later the bones are reordered and 'chest' has been deleted.
  const decoded = decodeOverrides(grey, order, ['head', 'hip']);
  assert.deepEqual(Array.from(decoded), [NO_OVERRIDE, ERASED, 1, NO_OVERRIDE, 0]);
});

test('resampleLabels scales a map up by nearest neighbour', () => {
  const small = Int16Array.from([0, 1, 2, 3]);   // 2x2
  const big = resampleLabels(small, 2, 2, 4, 4);
  assert.deepEqual(Array.from(big.slice(0, 4)), [0, 0, 1, 1]);
  assert.deepEqual(Array.from(big.slice(12, 16)), [2, 2, 3, 3]);
});

test('capRadius grows with thickness within limits', () => {
  assert.equal(capRadius(0), 8);
  assert.equal(capRadius(10), 26);
  assert.equal(capRadius(1000), 80);
});

test("cutPieces crops each bone's pixels and adds a cap at the pivot", () => {
  // 6x1 strip, all opaque. Bone 0 owns pixels 0..2, bone 1 owns 3..5 and pivots at x=3.
  const width = 6, height = 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width; p += 1) { rgba[p * 4] = p * 40; rgba[p * 4 + 3] = 255; }
  const labels = Int16Array.from([0, 0, 0, 1, 1, 1]);
  const bones = [{ x1: 0, y1: 0 }, { x1: 3, y1: 0 }];
  const pieces = cutPieces(rgba, width, height, labels, bones, Float64Array.from([0, 1.5]));
  assert.equal(pieces.length, 2);
  assert.deepEqual([pieces[0].x, pieces[0].width, pieces[0].pixels], [0, 3, 3]);
  // The cap of radius 1.5 around x=3 pulls in pixel 2 from the first piece.
  assert.deepEqual([pieces[1].x, pieces[1].width, pieces[1].pixels], [2, 4, 4]);
  assert.equal(pieces[1].data[0], 80);        // pixel 2's red channel copied in
  // An unlabelled (erased) pixel is left out of every piece unless under a cap.
  const erased = Int16Array.from([0, -1, 0, 1, 1, 1]);
  const cut = cutPieces(rgba, width, height, erased, bones, Float64Array.from([0, 0]));
  assert.equal(cut[0].pixels, 2);
});

test('explodeOffsets pushes pieces away from the centre, nothing at spread 0', () => {
  const bones = [{ x1: 10, y1: 0 }, { x1: 0, y1: -20 }];
  const pieces = [{ bone: 0 }, { bone: 1 }];
  const zero = explodeOffsets(pieces, bones, { x: 0, y: 0 }, 0);
  assert.deepEqual(zero, [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  const out = explodeOffsets(pieces, bones, { x: 0, y: 0 }, 0.5);
  assert.deepEqual(out, [{ x: 5, y: 0 }, { x: 0, y: -10 }]);
});
