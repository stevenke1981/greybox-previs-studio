/**
 * Pose presets expressed as WORLD directions in figure space (figure faces +Z, its left is +X).
 * Each entry aims bone -> child along a direction, so presets do not depend on the rig's local axes.
 */
export type PoseName = 'tpose' | 'apose' | 'stand' | 'walk' | 'run' | 'sit' | 'crouch' | 'point' | 'cheer' | 'think';
export const POSE_NAMES: PoseName[] = ['stand', 'apose', 'tpose', 'walk', 'run', 'sit', 'crouch', 'point', 'cheer', 'think'];

export interface PoseSpec {
  aims: Array<[bone: string, dir: [number, number, number]]>;
  /** lower the hips by this many metres */
  hipsDrop?: number;
}

const armsDown: PoseSpec['aims'] = [
  ['LeftArm', [0.22, -1, 0.02]], ['LeftForeArm', [0.12, -1, 0.15]],
  ['RightArm', [-0.22, -1, 0.02]], ['RightForeArm', [-0.12, -1, 0.15]],
];

export const POSES: Record<PoseName, PoseSpec> = {
  tpose: { aims: [] },
  apose: { aims: [['LeftArm', [1, -0.9, 0]], ['LeftForeArm', [1, -0.9, 0]], ['RightArm', [-1, -0.9, 0]], ['RightForeArm', [-1, -0.9, 0]]] },
  stand: { aims: armsDown },
  walk: {
    aims: [
      ['LeftUpLeg', [0.03, -1, 0.4]], ['LeftLeg', [0, -1, 0.1]],
      ['RightUpLeg', [-0.03, -1, -0.3]], ['RightLeg', [0, -1, -0.55]],
      ['LeftArm', [0.18, -1, -0.35]], ['LeftForeArm', [0.1, -1, -0.1]],
      ['RightArm', [-0.18, -1, 0.35]], ['RightForeArm', [-0.1, -0.8, 0.6]],
    ],
    hipsDrop: 0.03,
  },
  run: {
    aims: [
      ['Spine', [0, 1, 0.25]],
      ['LeftUpLeg', [0.03, -0.6, 1]], ['LeftLeg', [0, -1, -0.15]],
      ['RightUpLeg', [-0.03, -1, -0.5]], ['RightLeg', [0, -0.3, -1]],
      ['LeftArm', [0.15, -1, -0.6]], ['LeftForeArm', [0.1, 0.4, -1]],
      ['RightArm', [-0.15, -1, 0.5]], ['RightForeArm', [-0.1, 0.8, 1]],
    ],
    hipsDrop: 0.1,
  },
  sit: {
    aims: [
      ['LeftUpLeg', [0.12, -0.05, 1]], ['LeftLeg', [0.02, -1, 0.05]],
      ['RightUpLeg', [-0.12, -0.05, 1]], ['RightLeg', [-0.02, -1, 0.05]],
      ['LeftArm', [0.2, -1, 0.25]], ['LeftForeArm', [0.05, -0.25, 1]],
      ['RightArm', [-0.2, -1, 0.25]], ['RightForeArm', [-0.05, -0.25, 1]],
    ],
    hipsDrop: 0.46,
  },
  crouch: {
    aims: [
      ['Spine', [0, 1, 0.45]],
      ['LeftUpLeg', [0.2, -0.35, 1]], ['LeftLeg', [0.05, -1, -0.35]],
      ['RightUpLeg', [-0.2, -0.35, 1]], ['RightLeg', [-0.05, -1, -0.35]],
      ['LeftArm', [0.25, -1, 0.6]], ['LeftForeArm', [0, -0.6, 1]],
      ['RightArm', [-0.25, -1, 0.6]], ['RightForeArm', [0, -0.6, 1]],
    ],
    hipsDrop: 0.42,
  },
  point: {
    aims: [
      ['LeftArm', [0.22, -1, 0.02]], ['LeftForeArm', [0.12, -1, 0.15]],
      ['RightArm', [-0.25, 0.12, 1]], ['RightForeArm', [-0.2, 0.15, 1]],
      ['Head', [-0.15, 1, 0.2]],
    ],
  },
  cheer: { aims: [['LeftArm', [0.55, 1, 0]], ['LeftForeArm', [0.3, 1, 0.05]], ['RightArm', [-0.55, 1, 0]], ['RightForeArm', [-0.3, 1, 0.05]]] },
  think: {
    aims: [
      ['LeftArm', [0.2, -1, 0.15]], ['LeftForeArm', [-0.6, 0.1, 1]],
      ['RightArm', [-0.15, -1, 0.3]], ['RightForeArm', [0.15, 1, 0.45]],
      ['Head', [0.05, 1, 0.3]],
    ],
  },
};

/** child bone used to measure the direction of each aimable bone */
export const AIM_CHILD: Record<string, string> = {
  LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', RightArm: 'RightForeArm', RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', RightUpLeg: 'RightLeg', RightLeg: 'RightFoot',
  Spine: 'Neck', Head: 'HeadTop_End', Neck: 'Head',
};

export const HANDLE_BONES = [
  'Hips', 'Spine', 'Spine2', 'Neck', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
];
