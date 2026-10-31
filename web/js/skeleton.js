// The skeleton model: joints with names, positions and parents.
//
// Every function here returns a new skeleton and never mutates the one it was
// given. That keeps undo trivial (keep the old one) and keeps this file free
// of DOM so it can be tested with Node's test runner (tests/skeleton.test.mjs).
//
// Shape of a skeleton:
//   {
//     version: 1,
//     template: 'humanoid' | 'blob' | 'quadruped' | 'empty' | null,
//     joints: [
//       { id: 'hip', name: 'Hip', x: 412, y: 980, parent: null, landmark: 'mid_hip' },
//       ...
//     ]
//   }
// x and y are pixels in texture.png. Exactly one joint has parent null: the
// root. A bone is the segment from a joint's parent to that joint, so every
// joint except the root defines one bone and the bone is named after it.

export const SKELETON_VERSION = 1;

export function emptySkeleton(template = null) {
  return { version: SKELETON_VERSION, template, joints: [] };
}

// A template holds joints with positions in [0, 1] of the texture box.
export function applyTemplate(template, textureWidth, textureHeight) {
  const joints = template.joints.map((j) => ({
    id: j.id,
    name: j.name,
    x: Math.round(j.x * textureWidth),
    y: Math.round(j.y * textureHeight),
    parent: j.parent ?? null,
    landmark: j.landmark ?? null,
  }));
  const skeleton = { version: SKELETON_VERSION, template: template.id, joints };
  const problems = validate(skeleton);
  if (problems.length) throw new Error(`Template "${template.id}" is invalid: ${problems.join('; ')}`);
  return skeleton;
}

export function jointById(skeleton, id) {
  return skeleton.joints.find((j) => j.id === id) ?? null;
}

export function rootOf(skeleton) {
  return skeleton.joints.find((j) => j.parent === null) ?? null;
}

export function childrenOf(skeleton, id) {
  return skeleton.joints.filter((j) => j.parent === id);
}

// Every joint whose parent chain includes `id`, not including `id` itself.
export function descendantsOf(skeleton, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const child of childrenOf(skeleton, current)) {
      out.push(child);
      stack.push(child.id);
    }
  }
  return out;
}

// Joints ordered so every parent comes before its children, and each
// child directly follows its own branch (a tree walk), which reads naturally
// in a list: Hips, Chest, Head, Left shoulder, Left elbow, Left hand, ...
export function depthOrder(skeleton) {
  const root = rootOf(skeleton);
  if (!root) return [];
  const out = [];
  const walk = (joint) => {
    out.push(joint);
    for (const child of childrenOf(skeleton, joint.id)) walk(child);
  };
  walk(root);
  return out;
}

export function depthOf(skeleton, id) {
  let depth = 0;
  let joint = jointById(skeleton, id);
  while (joint && joint.parent !== null) {
    depth += 1;
    joint = jointById(skeleton, joint.parent);
  }
  return depth;
}

// Bones in depth order: { id, from: parentJoint, to: joint }.
export function bones(skeleton) {
  return depthOrder(skeleton)
    .filter((j) => j.parent !== null)
    .map((j) => ({ id: j.id, from: jointById(skeleton, j.parent), to: j }));
}

export function uniqueId(skeleton, base) {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'joint';
  if (!jointById(skeleton, slug)) return slug;
  let n = 2;
  while (jointById(skeleton, `${slug}_${n}`)) n += 1;
  return `${slug}_${n}`;
}

export function addJoint(skeleton, { name, x, y, parent, landmark = null }) {
  if (parent !== null && !jointById(skeleton, parent)) throw new Error(`No joint "${parent}" to attach to`);
  if (parent === null && rootOf(skeleton)) throw new Error('There is already a root joint');
  const id = uniqueId(skeleton, name);
  const joint = { id, name, x: Math.round(x), y: Math.round(y), parent, landmark };
  return { ...skeleton, joints: [...skeleton.joints, joint] };
}

export function moveJoint(skeleton, id, x, y) {
  return update(skeleton, id, (j) => ({ ...j, x: Math.round(x), y: Math.round(y) }));
}

export function renameJoint(skeleton, id, name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A joint needs a name');
  return update(skeleton, id, (j) => ({ ...j, name: trimmed }));
}

// Children of a deleted joint attach to its parent, so the chain stays whole.
export function deleteJoint(skeleton, id) {
  const joint = jointById(skeleton, id);
  if (!joint) return skeleton;
  if (joint.parent === null) throw new Error('The root joint cannot be deleted');
  const joints = skeleton.joints
    .filter((j) => j.id !== id)
    .map((j) => (j.parent === id ? { ...j, parent: joint.parent } : j));
  return { ...skeleton, joints };
}

export function setParent(skeleton, id, parentId) {
  const joint = jointById(skeleton, id);
  if (!joint) throw new Error(`No joint "${id}"`);
  if (joint.parent === null) throw new Error('The root joint cannot be attached to anything');
  if (parentId === id) throw new Error('A joint cannot attach to itself');
  if (!jointById(skeleton, parentId)) throw new Error(`No joint "${parentId}"`);
  if (descendantsOf(skeleton, id).some((d) => d.id === parentId)) {
    throw new Error('That would make a loop: the chosen joint hangs off this one');
  }
  return update(skeleton, id, (j) => ({ ...j, parent: parentId }));
}

// Mirror positions across the texture's vertical centre line. Handy when a
// template was built for a character facing the other way.
export function mirrorX(skeleton, textureWidth) {
  return { ...skeleton, joints: skeleton.joints.map((j) => ({ ...j, x: textureWidth - j.x })) };
}

export function validate(skeleton) {
  const problems = [];
  const ids = new Set();
  let roots = 0;
  for (const j of skeleton.joints) {
    if (ids.has(j.id)) problems.push(`duplicate id "${j.id}"`);
    ids.add(j.id);
    if (j.parent === null) roots += 1;
    if (typeof j.x !== 'number' || typeof j.y !== 'number') problems.push(`joint "${j.id}" has no position`);
    if (!j.name) problems.push(`joint "${j.id}" has no name`);
  }
  for (const j of skeleton.joints) {
    if (j.parent !== null && !ids.has(j.parent)) problems.push(`joint "${j.id}" attaches to missing "${j.parent}"`);
  }
  if (skeleton.joints.length && roots !== 1) problems.push(`expected one root joint, found ${roots}`);
  if (skeleton.joints.length && depthOrder(skeleton).length !== skeleton.joints.length) problems.push('joints form a loop');
  return problems;
}

function update(skeleton, id, fn) {
  if (!jointById(skeleton, id)) throw new Error(`No joint "${id}"`);
  return { ...skeleton, joints: skeleton.joints.map((j) => (j.id === id ? fn(j) : j)) };
}
