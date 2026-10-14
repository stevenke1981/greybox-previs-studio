/**
 * Pure keyframe timeline (no three.js dependency so it is unit-testable).
 * A track animates one target channel; every keyframe stores a flat number array.
 *  - kind "vec":  component-wise interpolation (positions, scale, FOV, camera target)
 *  - kind "quat": spherical linear interpolation of [x, y, z, w]
 */
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step';
export const EASINGS: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'];
export type TrackKind = 'vec' | 'quat';

export interface Keyframe {
  /** time in seconds */
  t: number;
  v: number[];
  /** easing used for the segment that STARTS at this key */
  ease: Easing;
}

export interface Track {
  /** e.g. "obj:box1.position", "bone:fig1:LeftArm.quaternion", "camera.fov" */
  id: string;
  kind: TrackKind;
  keys: Keyframe[];
}

export function ease(e: Easing, x: number): number {
  const t = Math.min(1, Math.max(0, x));
  switch (e) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t * t;
    case 'easeOut':
      return 1 - Math.pow(1 - t, 3);
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'step':
      return t >= 1 ? 1 : 0;
  }
}

export function lerpArray(a: number[], b: number[], t: number): number[] {
  return a.map((av, i) => av + ((b[i] ?? av) - av) * t);
}

export function slerpQuat(a: number[], b: number[], t: number): number[] {
  let [bx, by, bz, bw] = b;
  const [ax, ay, az, aw] = a;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos;
  }
  let k0: number, k1: number;
  if (cos > 0.9995) {
    k0 = 1 - t; k1 = t;
  } else {
    const theta = Math.acos(cos);
    const s = Math.sin(theta);
    k0 = Math.sin((1 - t) * theta) / s;
    k1 = Math.sin(t * theta) / s;
  }
  const r = [ax * k0 + bx * k1, ay * k0 + by * k1, az * k0 + bz * k1, aw * k0 + bw * k1];
  const len = Math.hypot(...r) || 1;
  return r.map((c) => c / len);
}

/** Insert or replace (same time within 1e-4 s) a key, keeping keys sorted. */
export function setKey(track: Track, key: Keyframe): Track {
  const keys = track.keys.filter((k) => Math.abs(k.t - key.t) > 1e-4);
  keys.push({ t: key.t, v: [...key.v], ease: key.ease });
  keys.sort((a, b) => a.t - b.t);
  return { ...track, keys };
}

export function removeKeyAt(track: Track, t: number): Track {
  return { ...track, keys: track.keys.filter((k) => Math.abs(k.t - t) > 1e-4) };
}

/** Evaluate a track at time t. Returns undefined for an empty track. */
export function evaluateTrack(track: Track, t: number): number[] | undefined {
  const keys = track.keys;
  if (keys.length === 0) return undefined;
  if (t <= keys[0].t) return [...keys[0].v];
  const last = keys[keys.length - 1];
  if (t >= last.t) return [...last.v];
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const local = span <= 0 ? 1 : ease(a.ease, (t - a.t) / span);
  return track.kind === 'quat' ? slerpQuat(a.v, b.v, local) : lerpArray(a.v, b.v, local);
}

export class Timeline {
  tracks = new Map<string, Track>();
  duration = 5;
  fps = 24;

  key(id: string, kind: TrackKind, t: number, v: number[], e: Easing = 'easeInOut'): void {
    const tr = this.tracks.get(id) ?? { id, kind, keys: [] };
    this.tracks.set(id, setKey(tr, { t, v, ease: e }));
  }

  removeAt(t: number, prefix?: string): void {
    for (const [id, tr] of this.tracks) {
      if (prefix && !id.startsWith(prefix)) continue;
      const next = removeKeyAt(tr, t);
      if (next.keys.length) this.tracks.set(id, next);
      else this.tracks.delete(id);
    }
  }

  evaluate(t: number): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const [id, tr] of this.tracks) {
      const v = evaluateTrack(tr, t);
      if (v) out.set(id, v);
    }
    return out;
  }

  /** Sorted unique key times (optionally limited to tracks whose id starts with prefix). */
  keyTimes(prefix?: string): number[] {
    const s = new Set<number>();
    for (const [id, tr] of this.tracks) {
      if (prefix && !id.startsWith(prefix)) continue;
      tr.keys.forEach((k) => s.add(Math.round(k.t * 1000) / 1000));
    }
    return [...s].sort((a, b) => a - b);
  }

  frameCount(): number {
    return Math.max(1, Math.round(this.duration * this.fps));
  }

  /** Deterministic time of frame i (used by every exporter). */
  frameTime(i: number): number {
    return i / this.fps;
  }

  /**
   * Time remap: copy the motion in [a, b] to start at `dst`, played at `speed` (0.5 = half speed, slow motion).
   * The last key before `dst` becomes a 'step' so playback cuts straight into the copy (instant replay).
   * Values at a and b are sampled so the copy starts/ends exactly where the source did.
   */
  retimeCopy(a: number, b: number, dst: number, speed = 1, filter?: (id: string) => boolean): void {
    if (!(b > a) || speed <= 0) throw new Error('retimeCopy: need b > a and speed > 0');
    const map = (t: number) => dst + (t - a) / speed;
    for (const [id, tr] of this.tracks) {
      if (filter && !filter(id)) continue;
      const va = evaluateTrack(tr, a)!;
      const vb = evaluateTrack(tr, b)!;
      const inner = tr.keys.filter((k) => k.t > a + 1e-6 && k.t < b - 1e-6);
      const firstEase = [...tr.keys].reverse().find((k) => k.t <= a + 1e-6)?.ease ?? 'linear';
      const before = tr.keys.filter((k) => k.t < dst - 1e-6);
      let next: Track = { ...tr, keys: tr.keys.filter((k) => k.t < dst - 1e-6 || k.t > map(b) + 1e-6) };
      if (before.length) {
        const last = before[before.length - 1];
        next = setKey(next, { ...last, ease: 'step' });
      }
      next = setKey(next, { t: dst, v: va, ease: firstEase });
      for (const k of inner) next = setKey(next, { t: map(k.t), v: k.v, ease: k.ease });
      next = setKey(next, { t: map(b), v: vb, ease: 'linear' });
      this.tracks.set(id, next);
    }
    this.duration = Math.max(this.duration, map(b));
  }

  clear(): void {
    this.tracks.clear();
  }

  toJSON(): { duration: number; fps: number; tracks: Track[] } {
    return { duration: this.duration, fps: this.fps, tracks: [...this.tracks.values()] };
  }

  static fromJSON(j: { duration: number; fps: number; tracks: Track[] }): Timeline {
    const tl = new Timeline();
    tl.duration = j.duration;
    tl.fps = j.fps;
    for (const tr of j.tracks) tl.tracks.set(tr.id, { ...tr, keys: [...tr.keys].sort((a, b) => a.t - b.t) });
    return tl;
  }
}
