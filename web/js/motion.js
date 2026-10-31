// Preset motions: keyframed rotations per joint, plus a root track.
//
// A motion file looks like:
//   {
//     "id": "wave", "name": "Wave hello", "duration": 2.4, "loop": true,
//     "tracks": { "right_shoulder": [[0, 0], [0.4, -100], [2.4, 0]], ... },
//     "root": [[0, 0, 0], [0.5, 0, -120], [1, 0, 0]]
//   }
// A track is named after the joint at the END of the bone it turns: the
// "right_elbow" track turns the upper arm about the shoulder.
//
// Two kinds of track:
//   relative:  [[seconds, degrees], ...]            turn from the rest pose
//   absolute:  { "absolute": true, "keys": [...] }   where the bone points
// Absolute angles are screen directions: 0 is right, 90 is down, -90 is up,
// 180 is left. They make a motion independent of how the character was drawn:
// "arm points up" is the same instruction for every character.
//
// Root keys are [seconds, dx, dy] in texture pixels. Between keys the value
// eases smoothly. Joints a motion does not mention stay still, so a motion made
// for the person template still plays on a character with extra or missing
// joints.
//
// Pure functions, tested in Node.

export function validateMotion(motion) {
  const problems = [];
  if (!motion || typeof motion !== 'object') return ['motion is not an object'];
  if (typeof motion.duration !== 'number' || motion.duration <= 0) problems.push('duration must be a positive number');
  const tracks = motion.tracks ?? {};
  for (const [joint, track] of Object.entries(tracks)) {
    const keys = trackKeys(track);
    if (!Array.isArray(keys) || keys.length === 0) { problems.push(`track "${joint}" has no keys`); continue; }
    let last = -Infinity;
    for (const key of keys) {
      if (!Array.isArray(key) || key.length !== 2 || key.some((v) => typeof v !== 'number')) {
        problems.push(`track "${joint}" has a key that is not [seconds, degrees]`);
        break;
      }
      if (key[0] < last) { problems.push(`track "${joint}" keys are not in time order`); break; }
      last = key[0];
    }
  }
  if (motion.root !== undefined) {
    if (!Array.isArray(motion.root) || motion.root.some((k) => !Array.isArray(k) || k.length !== 3)) {
      problems.push('root keys must be [seconds, dx, dy]');
    }
  }
  return problems;
}

export function trackKeys(track) {
  return Array.isArray(track) ? track : track?.keys;
}

export function trackIsAbsolute(track) {
  return !Array.isArray(track) && Boolean(track?.absolute);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// Interpolate a list of keys at time t. keys: [[time, ...values]]. Returns
// the value array (length = key length - 1).
export function sampleKeys(keys, t) {
  const width = keys[0].length - 1;
  if (t <= keys[0][0]) return keys[0].slice(1);
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last.slice(1);
  let i = 1;
  while (keys[i][0] < t) i += 1;
  const a = keys[i - 1], b = keys[i];
  const span = b[0] - a[0];
  const u = span > 0 ? smoothstep((t - a[0]) / span) : 1;
  const out = new Array(width);
  for (let k = 0; k < width; k += 1) out[k] = a[k + 1] + (b[k + 1] - a[k + 1]) * u;
  return out;
}

// Returns a pose for rig.poseTransforms: rotations in radians, root in pixels.
export function evaluateMotion(motion, seconds) {
  let t = seconds;
  if (motion.loop !== false && motion.duration > 0) {
    t = ((seconds % motion.duration) + motion.duration) % motion.duration;
  } else {
    t = Math.min(Math.max(0, seconds), motion.duration);
  }
  const rotations = {};
  const absolutes = {};
  for (const [joint, track] of Object.entries(motion.tracks ?? {})) {
    const radians = sampleKeys(trackKeys(track), t)[0] * Math.PI / 180;
    if (trackIsAbsolute(track)) absolutes[joint] = radians; else rotations[joint] = radians;
  }
  const root = { x: 0, y: 0, rotation: 0 };
  if (motion.root) {
    const [dx, dy] = sampleKeys(motion.root, t);
    root.x = dx;
    root.y = dy;
  }
  if (motion.rootRotation) {
    root.rotation = sampleKeys(motion.rootRotation, t)[0] * Math.PI / 180;
  }
  return { rotations, absolutes, root, time: t };
}
