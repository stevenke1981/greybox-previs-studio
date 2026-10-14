import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseProject, serializeProject, ProjectError, type ProjectData } from '../src/project';
import { edgeMap } from '../src/edges';

const sample: ProjectData = {
  format: 'greybox-previs-studio',
  version: 1,
  name: 'shot01',
  objects: [
    { id: 'fig1', type: 'mannequin', name: '主角', position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], clip: 'walk', clipSpeed: 1 },
    { id: 'box1', type: 'box', name: 'box', position: [1, 0, -1], quaternion: [0, 0.7071, 0, 0.7071], scale: [2, 1, 1] },
    { id: 'fig2', type: 'mannequin', name: 'B', position: [0, 0, 2], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], clip: null, pose: { LeftArm: [0.1, 0, 0, 0.995] } },
  ],
  camera: { position: [4, 2, 7], target: [0, 1, 0], fov: 40 },
  timeline: {
    duration: 4, fps: 24,
    tracks: [
      { id: 'camera.fov', kind: 'vec', keys: [{ t: 0, v: [40], ease: 'linear' }, { t: 4, v: [30], ease: 'easeInOut' }] },
      { id: 'bone:fig2:LeftArm', kind: 'quat', keys: [{ t: 1, v: [0, 0, 0, 1], ease: 'easeInOut' }] },
    ],
  },
  settings: { ...DEFAULT_SETTINGS, ao: true },
};

describe('project JSON', () => {
  it('round-trips losslessly', () => {
    expect(parseProject(serializeProject(sample))).toEqual(sample);
  });
  it('fills default settings for older files', () => {
    const { settings: _s, ...noSettings } = sample;
    void _s;
    expect(parseProject(JSON.stringify(noSettings)).settings).toEqual(DEFAULT_SETTINGS);
  });
  it('rejects malformed files with readable errors', () => {
    expect(() => parseProject('nope')).toThrow(ProjectError);
    expect(() => parseProject(JSON.stringify({ ...sample, format: 'x' }))).toThrow(/format/);
    expect(() => parseProject(JSON.stringify({ ...sample, version: 2 }))).toThrow(/version/);
    const dup = { ...sample, objects: [sample.objects[0], sample.objects[0]] };
    expect(() => parseProject(JSON.stringify(dup))).toThrow(/duplicate/);
    const bad = { ...sample, objects: [{ ...sample.objects[0], position: [0, 0] }] };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/transform/);
    const badTrack = { ...sample, timeline: { ...sample.timeline, tracks: [{ id: 'x', kind: 'foo', keys: [] }] } };
    expect(() => parseProject(JSON.stringify(badTrack))).toThrow(/track/);
  });
});

describe('edge map', () => {
  it('finds a depth discontinuity', () => {
    const w = 8, h = 8;
    const normal = new Uint8ClampedArray(w * h * 4).fill(128);
    const depth = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) depth.fill(x < 4 ? 255 : 0, (y * w + x) * 4, (y * w + x) * 4 + 4);
    const e = edgeMap(normal, depth, w, h);
    expect(e[(3 * w + 4) * 4]).toBe(255);
    expect(e[(3 * w + 1) * 4]).toBe(0);
    expect(e[(3 * w + 6) * 4]).toBe(0);
  });
});
