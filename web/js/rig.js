// The puppet rig: a grid mesh over the texture, a weight per vertex for the
// nearest few bones, and the maths that moves vertices when bones rotate
// (linear blend skinning). Pure functions on typed arrays, tested in Node.
//
// Coordinates are texture pixels throughout. A 2D affine matrix is the array
// [a, b, c, d, tx, ty], matching the canvas/DOMMatrix convention:
//   x' = a*x + c*y + tx
//   y' = b*x + d*y + ty

import { bones as skeletonBones, rootOf, jointById, depthOrder } from './skeleton.js';
import { segmentDistanceSq } from './regions.js';

// ---------- matrices ----------

export const mat = {
  identity() { return [1, 0, 0, 1, 0, 0]; },
  translate(tx, ty) { return [1, 0, 0, 1, tx, ty]; },
  rotate(radians) {
    const c = Math.cos(radians), s = Math.sin(radians);
    return [c, s, -s, c, 0, 0];
  },
  // m1 then m2 is multiply(m2, m1): the result applies m1 first.
  multiply(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  },
  apply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  },
  // Rotate about a point, then translate.
  aboutPoint(px, py, radians) {
    return mat.multiply(mat.translate(px, py), mat.multiply(mat.rotate(radians), mat.translate(-px, -py)));
  },
};

// ---------- grid mesh ----------

// isSolidCell(cx, cy) says whether a cell has any opaque pixels. Cells with none
// get no triangles, which keeps the mesh small and stops empty corners of the
// texture stretching across the picture.
export function buildGrid(width, height, cellSize, isSolidCell) {
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const stride = cols + 1;
  const vertexCount = stride * (rows + 1);
  const positions = new Float32Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const i = (r * stride + c) * 2;
      const x = Math.min(width, c * cellSize);
      const y = Math.min(height, r * cellSize);
      positions[i] = x;
      positions[i + 1] = y;
      uvs[i] = x / width;
      uvs[i + 1] = y / height;
    }
  }
  const indices = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!isSolidCell(c, r)) continue;
      const tl = r * stride + c, tr = tl + 1, bl = tl + stride, br = bl + 1;
      indices.push(tl, bl, tr, tr, bl, br);
    }
  }
  return { positions, uvs, indices: Uint16Array.from(indices), cols, rows, cellSize, vertexCount };
}

// A helper for the common case: an alpha map at some scale of the texture.
export function solidCellTester(alpha, alphaWidth, alphaHeight, alphaScale, cellSize) {
  return (cx, cy) => {
    // Look one cell further out so anti-aliased edges keep their triangles.
    const x0 = Math.max(0, Math.floor((cx - 1) * cellSize * alphaScale));
    const y0 = Math.max(0, Math.floor((cy - 1) * cellSize * alphaScale));
    const x1 = Math.min(alphaWidth, Math.ceil((cx + 2) * cellSize * alphaScale));
    const y1 = Math.min(alphaHeight, Math.ceil((cy + 2) * cellSize * alphaScale));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (alpha[y * alphaWidth + x] > 0) return true;
      }
    }
    return false;
  };
}

// ---------- bones and weights ----------

// Bones in depth order with their rest-pose segments.
export function restBones(skeleton) {
  return skeletonBones(skeleton).map((b, index) => ({
    index,
    id: b.id,
    jointId: b.to.id,
    parentId: b.from.id,
    x1: b.from.x, y1: b.from.y, x2: b.to.x, y2: b.to.y,
  }));
}

// For each vertex: up to maxBones bone indices and normalised weights.
// Weight falls off with distance to the bone segment, sharply (power 4), so a
// vertex on a limb follows that limb and only vertices near a joint blend.
// Bones much further away than the nearest are ignored outright.
export function computeWeights(positions, bones, { maxBones = 3, power = 4, reach = 2.5, margin = 12 } = {}) {
  const vertexCount = positions.length / 2;
  const indices = new Uint16Array(vertexCount * maxBones);
  const weights = new Float32Array(vertexCount * maxBones);
  if (bones.length === 0) return { indices, weights, maxBones };

  const distances = new Float64Array(bones.length);
  const order = new Int32Array(bones.length);

  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 2], y = positions[v * 2 + 1];
    for (let b = 0; b < bones.length; b += 1) {
      const bone = bones[b];
      distances[b] = Math.sqrt(segmentDistanceSq(x, y, bone.x1, bone.y1, bone.x2, bone.y2));
      order[b] = b;
    }
    const sorted = Array.from(order).sort((p, q) => distances[p] - distances[q]);
    const nearest = distances[sorted[0]];
    const limit = nearest * reach + margin;
    let total = 0;
    const take = Math.min(maxBones, sorted.length);
    for (let k = 0; k < take; k += 1) {
      const b = sorted[k];
      const d = distances[b];
      const w = d <= limit ? 1 / Math.pow(d + 1, power) : 0;
      indices[v * maxBones + k] = b;
      weights[v * maxBones + k] = w;
      total += w;
    }
    for (let k = 0; k < take; k += 1) weights[v * maxBones + k] /= total;
  }
  return { indices, weights, maxBones };
}

// Weights from a pixel label map (regions.labelPixels): each vertex looks at
// the opaque pixels within `radius` of itself and takes its weights from how
// many belong to each bone. Inside a region that is one bone at full weight;
// only vertices within `radius` of a seam blend, so a swinging arm cannot
// drag the body. Vertices with no opaque pixels nearby (empty corners of the
// grid) fall back to the nearest bone by distance.
//   labels: Int16Array, width x height, at `scale` times texture resolution
//   radius: in texture pixels
export function computeWeightsFromLabels(positions, bones, labels, width, height, scale, radius, { maxBones = 3 } = {}) {
  const vertexCount = positions.length / 2;
  const indices = new Uint16Array(vertexCount * maxBones);
  const weights = new Float32Array(vertexCount * maxBones);
  if (bones.length === 0) return { indices, weights, maxBones };

  const counts = new Float64Array(bones.length);
  const r = Math.max(1, radius * scale);
  const r2 = r * r;

  for (let v = 0; v < vertexCount; v += 1) {
    const cx = positions[v * 2] * scale, cy = positions[v * 2 + 1] * scale;
    counts.fill(0);
    let total = 0;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const label = labels[y * width + x];
        if (label < 0) continue;
        const w = 1 - Math.sqrt(d2) / (r + 1);   // nearer pixels count a little more
        counts[label] += w;
        total += w;
      }
    }

    if (total === 0) {
      // Nothing opaque nearby: nearest bone wins outright.
      let best = 0, bestD = Infinity;
      for (let b = 0; b < bones.length; b += 1) {
        const bone = bones[b];
        const d = segmentDistanceSq(positions[v * 2], positions[v * 2 + 1], bone.x1, bone.y1, bone.x2, bone.y2);
        if (d < bestD) { bestD = d; best = b; }
      }
      indices[v * maxBones] = best;
      weights[v * maxBones] = 1;
      continue;
    }

    // Keep the strongest few. At a joint, only the child's side bends: a vertex
    // whose main bone is the parent of a neighbouring bone stays rigid, so a
    // swinging arm bends at the shoulder without tugging a wedge of torso.
    let order = Array.from(counts.keys()).filter((b) => counts[b] > 0).sort((a, b) => counts[b] - counts[a]).slice(0, maxBones);
    const dominant = order[0];
    order = order.filter((b) => b === dominant || parentBoneIndex(bones, b) !== dominant);
    let kept = 0;
    for (const b of order) kept += counts[b];
    order.forEach((b, k) => {
      indices[v * maxBones + k] = b;
      weights[v * maxBones + k] = counts[b] / kept;
    });
  }
  return { indices, weights, maxBones };
}

// Index of the bone that ends at this bone's parent joint, or -1 at the root.
function parentBoneIndex(bones, index) {
  const parentJoint = bones[index].parentId;
  if (parentJoint === undefined || parentJoint === null) return -1;
  return bones.findIndex((b) => b.jointId === parentJoint);
}

// ---------- posing ----------

// The direction a bone points at rest, in radians (0 right, positive clockwise on screen).
export function restAngle(skeleton, jointId) {
  const joint = jointById(skeleton, jointId);
  const parent = joint && joint.parent !== null ? jointById(skeleton, joint.parent) : null;
  if (!parent) return 0;
  return Math.atan2(joint.y - parent.y, joint.x - parent.x);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// pose: { rotations: { [jointId]: radians }, absolutes: { [jointId]: radians }, root: { x, y, rotation } }
// A rotation turns the joint's bone about the joint's parent, measured from
// the rest pose, and carries everything hanging off it. An absolute is the
// direction the bone should point on screen; the rotation needed is worked
// out from the rest direction and whatever its parents have already turned.
// The root's rotation turns the whole character about the root joint;
// root.x/y shift it.
// Returns { joints: Map<jointId, matrix>, bones: Float32Array(boneCount * 6) }.
export function poseTransforms(skeleton, bones, pose) {
  const rotations = pose.rotations ?? {};
  const absolutes = pose.absolutes ?? {};
  const root = rootOf(skeleton);
  const joints = new Map();
  if (!root) return { joints, bones: new Float32Array(0) };

  const rootRotation = pose.root?.rotation ?? 0;
  const rootShift = mat.translate(pose.root?.x ?? 0, pose.root?.y ?? 0);
  const rootSpin = mat.aboutPoint(root.x, root.y, rootRotation);
  joints.set(root.id, mat.multiply(rootShift, rootSpin));
  const turned = new Map([[root.id, rootRotation]]);   // total turn along the chain so far

  for (const joint of depthOrder(skeleton)) {
    if (joint.parent === null) continue;
    const parent = jointById(skeleton, joint.parent);
    const inherited = turned.get(joint.parent);
    let delta;
    if (absolutes[joint.id] !== undefined) {
      delta = wrapAngle(absolutes[joint.id] - restAngle(skeleton, joint.id) - inherited);
    } else {
      delta = rotations[joint.id] ?? 0;
    }
    turned.set(joint.id, inherited + delta);
    const local = mat.aboutPoint(parent.x, parent.y, delta);
    joints.set(joint.id, mat.multiply(joints.get(joint.parent), local));
  }

  const boneMats = new Float32Array(bones.length * 6);
  bones.forEach((bone, i) => boneMats.set(joints.get(bone.jointId), i * 6));
  return { joints, bones: boneMats };
}

// Linear blend skinning: each vertex is the weighted sum of its bones' transforms
// applied to its rest position. Writes into `out` (same length as rest).
export function skin(rest, boneMats, weighting, out) {
  const { indices, weights, maxBones } = weighting;
  const vertexCount = rest.length / 2;
  for (let v = 0; v < vertexCount; v += 1) {
    const x = rest[v * 2], y = rest[v * 2 + 1];
    let px = 0, py = 0;
    for (let k = 0; k < maxBones; k += 1) {
      const w = weights[v * maxBones + k];
      if (w === 0) continue;
      const m = indices[v * maxBones + k] * 6;
      px += w * (boneMats[m] * x + boneMats[m + 2] * y + boneMats[m + 4]);
      py += w * (boneMats[m + 1] * x + boneMats[m + 3] * y + boneMats[m + 5]);
    }
    out[v * 2] = px;
    out[v * 2 + 1] = py;
  }
  return out;
}
