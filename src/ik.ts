/**
 * Analytic two-bone IK (pure math, no three.js) used for leg/arm placement and foot locking.
 * Given the root joint (hip/shoulder), a target for the end joint (ankle/wrist), segment lengths and a
 * pole direction (where the middle joint should point: knee forward, elbow back), returns the middle
 * joint position and the reachable end position.
 */
export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return mul(a, 1 / l); };

export interface IKResult { mid: V3; end: V3; reached: boolean }

export function twoBoneIK(root: V3, target: V3, l1: number, l2: number, pole: V3): IKResult {
  const toT = sub(target, root);
  const dRaw = len(toT);
  const dir = dRaw > 1e-9 ? mul(toT, 1 / dRaw) : ([0, -1, 0] as V3);
  const maxReach = (l1 + l2) * 0.9999;
  const minReach = Math.abs(l1 - l2) * 1.0001 + 1e-6;
  const d = Math.min(maxReach, Math.max(minReach, dRaw));
  // distance along dir to the foot of the middle joint, and its height off the root->target line
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // pole component orthogonal to dir; fall back to any perpendicular
  let p = sub(pole, mul(dir, dot(pole, dir)));
  if (len(p) < 1e-6) p = Math.abs(dir[1]) < 0.9 ? sub([0, 1, 0], mul(dir, dir[1])) : sub([1, 0, 0], mul(dir, dir[0]));
  p = norm(p);
  const mid = add(add(root, mul(dir, a)), mul(p, h));
  const end = add(root, mul(dir, d));
  return { mid, end, reached: dRaw <= maxReach + 1e-9 && dRaw >= minReach - 1e-9 };
}

export const dist = (a: V3, b: V3) => len(sub(a, b));
