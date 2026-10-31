// Unit tests for the pure skeleton and region modules.
// Run with:  node --test tests/
// No browser needed: these modules never touch the DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyTemplate, addJoint, moveJoint, renameJoint, deleteJoint, setParent,
  bones, depthOrder, rootOf, mirrorX, validate, uniqueId, emptySkeleton,
} from '../web/js/skeleton.js';
import { segmentDistanceSq, labelPixels, labelCounts } from '../web/js/regions.js';

const here = dirname(fileURLToPath(import.meta.url));
const loadTemplate = (name) => JSON.parse(readFileSync(join(here, '..', 'web', 'templates', `${name}.json`), 'utf8'));

test('every bundled template is valid and has exactly one root', () => {
  const index = JSON.parse(readFileSync(join(here, '..', 'web', 'templates', 'index.json'), 'utf8'));
  for (const entry of index.templates) {
    const skeleton = applyTemplate(loadTemplate(entry.id), 1000, 1500);
    assert.deepEqual(validate(skeleton), [], entry.id);
    assert.ok(rootOf(skeleton), entry.id);
    assert.equal(skeleton.template, entry.id);
  }
});

test('applyTemplate scales fractions to texture pixels', () => {
  const skeleton = applyTemplate(loadTemplate('humanoid'), 1000, 2000);
  const head = skeleton.joints.find((j) => j.id === 'head');
  assert.equal(head.x, 500);
  assert.equal(head.y, 240);
});

test('addJoint attaches under a parent and gets a unique id', () => {
  let s = applyTemplate(loadTemplate('empty'), 100, 100);
  s = addJoint(s, { name: 'Head', x: 50, y: 10, parent: 'body' });
  s = addJoint(s, { name: 'Head', x: 60, y: 10, parent: 'body' });
  assert.deepEqual(s.joints.map((j) => j.id), ['body', 'head', 'head_2']);
  assert.equal(bones(s).length, 2);
  assert.throws(() => addJoint(s, { name: 'Another root', x: 0, y: 0, parent: null }));
  assert.throws(() => addJoint(s, { name: 'Lost', x: 0, y: 0, parent: 'nope' }));
});

test('deleteJoint hands children to the grandparent and refuses the root', () => {
  let s = applyTemplate(loadTemplate('humanoid'), 100, 100);
  s = deleteJoint(s, 'left_elbow');
  const hand = s.joints.find((j) => j.id === 'left_hand');
  assert.equal(hand.parent, 'left_shoulder');
  assert.deepEqual(validate(s), []);
  assert.throws(() => deleteJoint(s, 'hip'), /root/);
});

test('setParent refuses loops and self, and reattaches otherwise', () => {
  const s = applyTemplate(loadTemplate('humanoid'), 100, 100);
  assert.throws(() => setParent(s, 'chest', 'head'), /loop/);
  assert.throws(() => setParent(s, 'chest', 'chest'));
  assert.throws(() => setParent(s, 'hip', 'chest'), /root/);
  const moved = setParent(s, 'left_hand', 'chest');
  assert.equal(moved.joints.find((j) => j.id === 'left_hand').parent, 'chest');
  assert.deepEqual(validate(moved), []);
});

test('functions never mutate their input', () => {
  const s = applyTemplate(loadTemplate('blob'), 100, 100);
  const snapshot = JSON.stringify(s);
  moveJoint(s, 'head', 1, 2);
  renameJoint(s, 'head', 'Noggin');
  deleteJoint(s, 'head');
  setParent(s, 'left_hand', 'chest');
  mirrorX(s, 100);
  assert.equal(JSON.stringify(s), snapshot);
});

test('depthOrder lists every parent before its children', () => {
  const s = applyTemplate(loadTemplate('quadruped'), 100, 100);
  const order = depthOrder(s).map((j) => j.id);
  assert.equal(order.length, s.joints.length);
  for (const j of s.joints) {
    if (j.parent !== null) assert.ok(order.indexOf(j.parent) < order.indexOf(j.id), j.id);
  }
});

test('mirrorX flips across the vertical centre', () => {
  const s = mirrorX(applyTemplate(loadTemplate('humanoid'), 1000, 1000), 1000);
  const leftHand = s.joints.find((j) => j.id === 'left_hand');
  assert.equal(leftHand.x, 800);
});

test('validate reports the obvious mistakes', () => {
  const broken = { version: 1, template: null, joints: [
    { id: 'a', name: 'A', x: 0, y: 0, parent: 'b' },
    { id: 'b', name: 'B', x: 0, y: 0, parent: 'a' },
  ] };
  const problems = validate(broken);
  assert.ok(problems.some((p) => /root/.test(p)));
  assert.deepEqual(validate(emptySkeleton()), []);
  assert.equal(uniqueId(emptySkeleton(), 'Left hand!'), 'left_hand');
});

test('segmentDistanceSq measures to the nearest point of the segment', () => {
  assert.equal(segmentDistanceSq(0, 5, 0, 0, 0, 10), 0);
  assert.equal(segmentDistanceSq(3, 5, 0, 0, 0, 10), 9);
  assert.equal(segmentDistanceSq(0, 14, 0, 0, 0, 10), 16);
  assert.equal(segmentDistanceSq(3, 4, 0, 0, 0, 0), 25);
});

test('labelPixels gives each opaque pixel to the nearest bone', () => {
  // 4 wide, 1 tall; bone 0 lies at x=0, bone 1 at x=3; pixel 2 is transparent.
  const alpha = Uint8Array.from([255, 255, 0, 255]);
  const segments = [{ x1: 0, y1: 0, x2: 0, y2: 0 }, { x1: 3, y1: 0, x2: 3, y2: 0 }];
  const labels = labelPixels(alpha, 4, 1, segments);
  assert.deepEqual(Array.from(labels), [0, 0, -1, 1]);
  assert.deepEqual(Array.from(labelCounts(labels, 2)), [2, 1]);
});
