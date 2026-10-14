import { describe, expect, it } from 'vitest';
import { Timeline, ease, evaluateTrack, slerpQuat, setKey, type Track } from '../src/timeline';
import { shotKeys, SHOT_PRESETS } from '../src/shots';

describe('easing', () => {
  it('maps endpoints and is monotonic', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(ease(e, 0)).toBeCloseTo(0);
      expect(ease(e, 1)).toBeCloseTo(1);
      let prev = -1;
      for (let x = 0; x <= 1; x += 0.05) { const v = ease(e, x); expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
    }
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5);
    expect(ease('step', 0.99)).toBe(0);
  });
});

describe('track evaluation', () => {
  const tr: Track = { id: 'x', kind: 'vec', keys: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 2, v: [2, 4, -2], ease: 'linear' }] };
  it('interpolates linearly and clamps outside the range', () => {
    expect(evaluateTrack(tr, 1)).toEqual([1, 2, -1]);
    expect(evaluateTrack(tr, -5)).toEqual([0, 0, 0]);
    expect(evaluateTrack(tr, 99)).toEqual([2, 4, -2]);
  });
  it('honours per-segment easing', () => {
    const e = setKey({ ...tr, keys: [] }, { t: 0, v: [0], ease: 'easeIn' });
    const t2 = setKey(e, { t: 1, v: [1], ease: 'linear' });
    expect(evaluateTrack(t2, 0.5)![0]).toBeCloseTo(0.125);
  });
  it('step easing holds the value', () => {
    const s: Track = { id: 's', kind: 'vec', keys: [{ t: 0, v: [1], ease: 'step' }, { t: 1, v: [5], ease: 'linear' }] };
    expect(evaluateTrack(s, 0.9)).toEqual([1]);
    expect(evaluateTrack(s, 1)).toEqual([5]);
  });
  it('slerps quaternions along the shortest arc with unit length', () => {
    const half = Math.SQRT1_2;
    const q = slerpQuat([0, 0, 0, 1], [0, half, 0, half], 0.5); // 0 -> 90deg about Y
    expect(Math.hypot(...q)).toBeCloseTo(1);
    expect(2 * Math.acos(q[3]) * 180 / Math.PI).toBeCloseTo(45, 3);
    const neg = slerpQuat([0, 0, 0, 1], [0, -half, 0, -half], 0.5); // same rotation, opposite sign
    expect(neg[1]).toBeCloseTo(q[1]);
  });
  it('setKey replaces keys at the same time and keeps them sorted', () => {
    let t: Track = { id: 'a', kind: 'vec', keys: [] };
    t = setKey(t, { t: 2, v: [2], ease: 'linear' });
    t = setKey(t, { t: 0, v: [0], ease: 'linear' });
    t = setKey(t, { t: 2, v: [3], ease: 'linear' });
    expect(t.keys.map((k) => k.t)).toEqual([0, 2]);
    expect(t.keys[1].v).toEqual([3]);
  });
});

describe('Timeline', () => {
  it('evaluates all tracks, removes keys and steps frames deterministically', () => {
    const tl = new Timeline();
    tl.fps = 24; tl.duration = 2;
    tl.key('camera.fov', 'vec', 0, [40], 'linear');
    tl.key('camera.fov', 'vec', 2, [20], 'linear');
    tl.key('obj:a.position', 'vec', 1, [1, 2, 3]);
    expect(tl.evaluate(1).get('camera.fov')![0]).toBeCloseTo(30);
    expect(tl.keyTimes()).toEqual([0, 1, 2]);
    expect(tl.keyTimes('obj:')).toEqual([1]);
    expect(tl.frameCount()).toBe(48);
    expect(tl.frameTime(12)).toBeCloseTo(0.5);
    tl.removeAt(1);
    expect(tl.tracks.has('obj:a.position')).toBe(false);
  });
  it('round-trips through JSON', () => {
    const tl = new Timeline();
    tl.key('bone:f:LeftArm', 'quat', 0.5, [0, 0, 0, 1]);
    const back = Timeline.fromJSON(JSON.parse(JSON.stringify(tl.toJSON())));
    expect(back.toJSON()).toEqual(tl.toJSON());
  });
});

describe('shot presets', () => {
  it('produce keys spanning the duration', () => {
    for (const p of SHOT_PRESETS) {
      const k = shotKeys(p, [0, 1, 0], 4);
      expect(k[0].t).toBe(0);
      if (p !== 'static') expect(k[k.length - 1].t).toBe(4);
      k.forEach((x) => expect(x.position).toHaveLength(3));
    }
  });
});
