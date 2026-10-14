/** Camera shot presets: produce camera keyframes (position / target / fov) around a subject. */
export type ShotPreset = 'dolly' | 'orbit' | 'crane' | 'pushIn' | 'static';
export const SHOT_PRESETS: ShotPreset[] = ['pushIn', 'dolly', 'orbit', 'crane', 'static'];

export interface CamKey {
  t: number;
  position: number[];
  target: number[];
  fov: number;
}

/** subject = [x, y, z] point to frame; duration in seconds. */
export function shotKeys(preset: ShotPreset, subject: number[], duration: number): CamKey[] {
  const [sx, sy, sz] = subject;
  const tgt = [sx, sy, sz];
  switch (preset) {
    case 'pushIn':
      return [
        { t: 0, position: [sx + 2.5, sy + 1.2, sz + 7], target: tgt, fov: 40 },
        { t: duration, position: [sx + 0.8, sy + 0.3, sz + 2.6], target: tgt, fov: 32 },
      ];
    case 'dolly':
      return [
        { t: 0, position: [sx - 4, sy + 0.4, sz + 4.5], target: [sx - 1.5, sy, sz], fov: 40 },
        { t: duration, position: [sx + 4, sy + 0.4, sz + 4.5], target: [sx + 1.5, sy, sz], fov: 40 },
      ];
    case 'orbit': {
      const n = 8;
      const r = 5;
      return Array.from({ length: n + 1 }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return {
          t: (i / n) * duration,
          position: [sx + Math.sin(a) * r, sy + 1.2, sz + Math.cos(a) * r],
          target: tgt,
          fov: 40,
        };
      });
    }
    case 'crane':
      return [
        { t: 0, position: [sx + 1.5, sy - 0.6, sz + 4], target: tgt, fov: 45 },
        { t: duration, position: [sx + 1.5, sy + 5, sz + 5], target: [sx, sy - 0.5, sz], fov: 45 },
      ];
    case 'static':
      return [{ t: 0, position: [sx + 3, sy + 1, sz + 5], target: tgt, fov: 40 }];
  }
}
