import { describe, expect, it } from 'vitest';
import { dist, twoBoneIK, type V3 } from '../src/ik';
import { Timeline, evaluateTrack } from '../src/timeline';

describe('twoBoneIK', () => {
  const hip: V3 = [0, 1, 0];
  it('keeps segment lengths and reaches a reachable target', () => {
    const target: V3 = [0.1, 0.15, 0.2];
    const r = twoBoneIK(hip, target, 0.45, 0.45, [0, 0, 1]);
    expect(r.reached).toBe(true);
    expect(dist(hip, r.mid)).toBeCloseTo(0.45, 6);
    expect(dist(r.mid, r.end)).toBeCloseTo(0.45, 6);
    expect(dist(r.end, target)).toBeCloseTo(0, 6);
  });
  it('bends the middle joint toward the pole', () => {
    const fwd = twoBoneIK(hip, [0, 0.3, 0], 0.45, 0.45, [0, 0, 1]);
    const back = twoBoneIK(hip, [0, 0.3, 0], 0.45, 0.45, [0, 0, -1]);
    expect(fwd.mid[2]).toBeGreaterThan(0.1);
    expect(back.mid[2]).toBeLessThan(-0.1);
  });
  it('clamps unreachable targets to a straight limb along the target direction', () => {
    const r = twoBoneIK(hip, [0, -5, 0], 0.45, 0.45, [0, 0, 1]);
    expect(r.reached).toBe(false);
    expect(r.end[1]).toBeCloseTo(1 - 0.9, 3);
    expect(Math.abs(r.end[2])).toBeLessThan(1e-6);
  });
  it('handles a pole parallel to the limb', () => {
    const r = twoBoneIK(hip, [0, 0.4, 0], 0.45, 0.45, [0, -1, 0]);
    expect(dist(hip, r.mid)).toBeCloseTo(0.45, 6);
  });
});

describe('Timeline.retimeCopy (time remap / slow-motion replay)', () => {
  it('copies a section at half speed after a cut', () => {
    const tl = new Timeline();
    tl.duration = 4;
    tl.key('x', 'vec', 0, [0], 'linear');
    tl.key('x', 'vec', 2, [2], 'linear');
    tl.key('x', 'vec', 3, [2], 'linear');
    tl.retimeCopy(1, 2, 3.5, 0.5);
    const tr = tl.tracks.get('x')!;
    expect(evaluateTrack(tr, 3.2)![0]).toBeCloseTo(2); // hold before the cut
    expect(evaluateTrack(tr, 3.5)![0]).toBeCloseTo(1); // replay starts at source t=1
    expect(evaluateTrack(tr, 4.5)![0]).toBeCloseTo(1.5); // half speed
    expect(evaluateTrack(tr, 5.5)![0]).toBeCloseTo(2);
    expect(tl.duration).toBeCloseTo(5.5);
  });
  it('respects a track filter and validates args', () => {
    const tl = new Timeline();
    tl.key('camera.fov', 'vec', 0, [40]);
    tl.key('obj:a.position', 'vec', 0, [0, 0, 0]);
    tl.key('obj:a.position', 'vec', 1, [1, 0, 0]);
    tl.retimeCopy(0, 1, 2, 1, (id) => !id.startsWith('camera'));
    expect(tl.tracks.get('camera.fov')!.keys).toHaveLength(1);
    expect(() => tl.retimeCopy(1, 1, 2)).toThrow();
  });
});
