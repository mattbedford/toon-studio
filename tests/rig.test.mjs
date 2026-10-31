// Unit tests for the rig maths and motion evaluation.
// Run with:  node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mat, buildGrid, restBones, computeWeights, poseTransforms, skin } from '../web/js/rig.js';
import { validateMotion, sampleKeys, evaluateMotion } from '../web/js/motion.js';
import { applyTemplate } from '../web/js/skeleton.js';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (...parts) => JSON.parse(readFileSync(join(here, '..', 'web', ...parts), 'utf8'));
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

test('mat composes like the canvas: rotate about a point keeps that point fixed', () => {
  const m = mat.aboutPoint(10, 20, Math.PI / 2);
  const [x, y] = mat.apply(m, 10, 20);
  close(x, 10); close(y, 20);
  // A point one unit to the right of the pivot turns 90 degrees clockwise on screen (y down): to below.
  const [x2, y2] = mat.apply(m, 11, 20);
  close(x2, 10); close(y2, 21);
});

test('mat.multiply applies the right-hand matrix first', () => {
  const m = mat.multiply(mat.translate(5, 0), mat.rotate(Math.PI / 2));
  const [x, y] = mat.apply(m, 1, 0);   // rotate (1,0) -> (0,1), then shift x by 5
  close(x, 5); close(y, 1);
});

test('buildGrid covers the texture and skips empty cells', () => {
  const grid = buildGrid(100, 50, 25, (cx, cy) => cx === 0 && cy === 0);
  assert.equal(grid.cols, 4);
  assert.equal(grid.rows, 2);
  assert.equal(grid.vertexCount, 5 * 3);
  assert.equal(grid.indices.length, 6);                       // one cell, two triangles
  assert.equal(grid.positions[grid.positions.length - 2], 100);
  assert.equal(grid.positions[grid.positions.length - 1], 50);
  close(grid.uvs[grid.uvs.length - 2], 1);
  close(grid.uvs[grid.uvs.length - 1], 1);
});

test('computeWeights gives a vertex on a bone fully to that bone', () => {
  const skeleton = applyTemplate(readJson('templates', 'humanoid.json'), 1000, 1000);
  const bones = restBones(skeleton);
  const hand = skeleton.joints.find((j) => j.id === 'left_hand');
  const elbow = skeleton.joints.find((j) => j.id === 'left_elbow');
  const midpoint = [(hand.x + elbow.x) / 2, (hand.y + elbow.y) / 2];
  const { indices, weights, maxBones } = computeWeights(Float32Array.from(midpoint), bones);
  const forearm = bones.findIndex((b) => b.jointId === 'left_hand');
  assert.equal(indices[0], forearm);
  assert.ok(weights[0] > 0.97, `weight ${weights[0]}`);
  let total = 0;
  for (let k = 0; k < maxBones; k += 1) total += weights[k];
  close(total, 1);
});

test('poseTransforms: rest pose is the identity, a rotation carries the chain', () => {
  const skeleton = applyTemplate(readJson('templates', 'humanoid.json'), 1000, 1000);
  const bones = restBones(skeleton);
  const rest = poseTransforms(skeleton, bones, { rotations: {}, root: { x: 0, y: 0, rotation: 0 } });
  for (const m of rest.joints.values()) assert.deepEqual(Array.from(m).map((v) => Math.round(v * 1e6) / 1e6), [1, 0, 0, 1, 0, 0]);

  const posed = poseTransforms(skeleton, bones, { rotations: { left_shoulder: Math.PI / 2 }, root: { x: 0, y: 0, rotation: 0 } });
  const chest = skeleton.joints.find((j) => j.id === 'chest');
  const hand = skeleton.joints.find((j) => j.id === 'left_hand');
  // The chest (pivot of the shoulder bone) does not move; the hand does, and so does its bone matrix.
  const [cx, cy] = mat.apply(posed.joints.get('left_shoulder'), chest.x, chest.y);
  close(cx, chest.x); close(cy, chest.y);
  const [hx, hy] = mat.apply(posed.joints.get('left_hand'), hand.x, hand.y);
  assert.ok(Math.hypot(hx - hand.x, hy - hand.y) > 100);
  // A root shift moves everything.
  const shifted = poseTransforms(skeleton, bones, { rotations: {}, root: { x: 0, y: -50, rotation: 0 } });
  const [rx, ry] = mat.apply(shifted.joints.get('right_foot'), 10, 10);
  close(rx, 10); close(ry, -40);
});

test('skin blends vertex positions by bone weights', () => {
  const rest = Float32Array.from([0, 0, 10, 0]);
  const boneMats = Float32Array.from([...mat.translate(0, 0), ...mat.translate(0, 100)]);
  const weighting = { maxBones: 2, indices: Uint16Array.from([0, 1, 0, 1]), weights: Float32Array.from([1, 0, 0.5, 0.5]) };
  const out = skin(rest, boneMats, weighting, new Float32Array(4));
  assert.deepEqual(Array.from(out), [0, 0, 10, 50]);
});

test('bundled motions are valid and evaluate to sensible poses', () => {
  const index = readJson('motions', 'index.json');
  for (const entry of index.motions) {
    const motion = readJson('motions', entry.file);
    assert.deepEqual(validateMotion(motion), [], entry.id);
    const start = evaluateMotion(motion, 0);
    for (const value of Object.values(start.rotations)) close(value, 0);
    const later = evaluateMotion(motion, motion.duration * 0.3);
    assert.ok(Object.values(later.rotations).some((v) => Math.abs(v) > 0.01), `${entry.id} does nothing`);
    close(evaluateMotion(motion, motion.duration * 2.5).time, motion.duration * 0.5);   // loops
  }
});

test('sampleKeys eases between keys and clamps outside them', () => {
  const keys = [[0, 0], [1, 10]];
  assert.deepEqual(sampleKeys(keys, -1), [0]);
  assert.deepEqual(sampleKeys(keys, 5), [10]);
  close(sampleKeys(keys, 0.5)[0], 5);
  assert.ok(sampleKeys(keys, 0.25)[0] < 2.5);   // slow start
});

test('validateMotion catches malformed files', () => {
  assert.ok(validateMotion({ duration: 0, tracks: {} }).length > 0);
  assert.ok(validateMotion({ duration: 1, tracks: { a: [[1, 0], [0, 0]] } }).some((p) => /order/.test(p)));
  assert.ok(validateMotion({ duration: 1, tracks: { a: [[0, 'x']] } }).length > 0);
});

test('computeWeightsFromLabels: inside a region one bone, at a seam a blend, empty space falls back', async () => {
  const { computeWeightsFromLabels } = await import('../web/js/rig.js');
  // 10x1 label strip: pixels 0..4 belong to bone 0, 5..9 to bone 1. Scale 1.
  const labels = Int16Array.from([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  const bones = [{ x1: 0, y1: 0, x2: 4, y2: 0 }, { x1: 5, y1: 0, x2: 9, y2: 0 }];
  const positions = Float32Array.from([1, 0, 4.5, 0, 8, 0, 30, 0]);
  const w = computeWeightsFromLabels(positions, bones, labels, 10, 1, 1, 1.5);
  assert.equal(w.indices[0], 0); assert.ok(w.weights[0] > 0.99);                 // deep inside region 0
  assert.ok(w.weights[3] > 0.3 && w.weights[3] < 0.7, `seam weight ${w.weights[3]}`);   // at the seam
  assert.equal(w.indices[6], 1); assert.ok(w.weights[6] > 0.99);                 // deep inside region 1
  assert.equal(w.indices[9], 1); assert.equal(w.weights[9], 1);                  // far away: nearest bone
});

test('absolute targets point a bone where asked, whatever its parents did', async () => {
  const { poseTransforms, restAngle } = await import('../web/js/rig.js');
  const skeleton = applyTemplate(readJson('templates', 'humanoid.json'), 1000, 1000);
  const bones = restBones(skeleton);
  // Turn the upper arm by some relative amount, then demand the forearm points straight up.
  const pose = { rotations: { right_elbow: 0.7 }, absolutes: { right_hand: -Math.PI / 2 }, root: { x: 0, y: 0, rotation: 0.1 } };
  const posed = poseTransforms(skeleton, bones, pose);
  const elbow = skeleton.joints.find((j) => j.id === 'right_elbow');
  const hand = skeleton.joints.find((j) => j.id === 'right_hand');
  const m = posed.joints.get('right_hand');
  const [ex, ey] = mat.apply(m, elbow.x, elbow.y);
  const [hx, hy] = mat.apply(m, hand.x, hand.y);
  close(Math.atan2(hy - ey, hx - ex), -Math.PI / 2, 1e-6);
  assert.ok(restAngle(skeleton, 'head') < 0, 'head bone points up at rest');
});

test('evaluateMotion separates relative and absolute tracks', () => {
  const motion = { duration: 1, loop: true, tracks: { a: [[0, 10], [1, 10]], b: { absolute: true, keys: [[0, -90], [1, -90]] } } };
  assert.deepEqual(validateMotion(motion), []);
  const pose = evaluateMotion(motion, 0.5);
  close(pose.rotations.a, 10 * Math.PI / 180);
  close(pose.absolutes.b, -Math.PI / 2);
  assert.equal(pose.rotations.b, undefined);
});

test('at a joint the parent territory stays rigid and the child side blends', async () => {
  const { computeWeightsFromLabels } = await import('../web/js/rig.js');
  // Bone 0 (parent, ends at joint "a") owns pixels 0..4; bone 1 (child of "a") owns 5..9.
  const labels = Int16Array.from([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  const bones = [
    { jointId: 'a', parentId: 'root', x1: 0, y1: 0, x2: 4, y2: 0 },
    { jointId: 'b', parentId: 'a', x1: 5, y1: 0, x2: 9, y2: 0 },
  ];
  const positions = Float32Array.from([4, 0, 5.5, 0]);
  const w = computeWeightsFromLabels(positions, bones, labels, 10, 1, 1, 2);
  assert.equal(w.indices[0], 0); assert.equal(w.weights[0], 1);            // parent side: rigid
  assert.equal(w.indices[3], 1); assert.ok(w.weights[3] < 1);               // child side: blends
});
