// 閃身步 (sidestep dodge) choreography. Runs INSIDE the app page (window.__studio) and authors keyframes
// with the app's own timeline: object transforms, bone rotations (via IK + aim), camera, and a slow-mo replay.
// Used by scripts/author-sidestep.mjs; the result is public/examples/sidestep.json.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function authorSidestep() {
  const S = window.__studio.studio;
  S.select(null);
  S.clearScene();
  const tl = S.timeline;
  tl.fps = 24;
  const ANKLE = 0.084;
  const yawQ = (y) => [0, Math.sin(y / 2), 0, Math.cos(y / 2)];

  // ------------------------------------------------------------ set: small dojo
  const add = (type, name, pos, yaw = 0, scale = [1, 1, 1]) => S.addObject(type, { name, position: pos, quaternion: yawQ(yaw), scale });
  add('plane', '道場地板', [0, 0, -1], 0, [3.2, 1, 2.6]);
  add('plane', '比賽墊', [0.3, 0.012, -1.2], 0, [1.4, 1, 1.4]);
  for (const [x, z] of [[-5.2, -6.0], [5.2, -6.0], [-5.2, 3.6], [6.4, 0.4]]) add('cylinder', '柱子', [x, 0, z], 0, [0.55, 3.4, 0.55]);
  add('wall', '後牆', [0, 0, -6.2], 0, [2.4, 1.3, 1]);
  add('box', '長椅', [-4.6, 0, -1.2], Math.PI / 2, [2.2, 0.42, 0.45]);
  const P = S.addObject('mannequin', { name: '主角', position: [0, 0, 0] });
  const A = S.addObject('mannequin', { name: '攻擊者', position: [0, 0, -4.2] });

  // ------------------------------------------------------------ helpers
  const fwd = (yaw) => [Math.sin(yaw), 0, Math.cos(yaw)];
  const left = (yaw) => [Math.cos(yaw), 0, -Math.sin(yaw)];
  const at = (c, yaw, f, l, y = ANKLE) => {
    const F = fwd(yaw), L = left(yaw);
    return [c[0] + F[0] * f + L[0] * l, y, c[2] + F[2] * f + L[2] * l];
  };
  const ease = {
    lin: (x) => x,
    io: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    out: (x) => 1 - Math.pow(1 - x, 3),
    in: (x) => x * x * x,
  };
  /** keys: [t, value(number|number[]), easeToNext?] -> f(t) */
  const curve = (keys) => (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0, e = 'io'] = keys[i];
      const [t1, v1] = keys[i + 1];
      if (t <= t1) {
        const k = ease[e]((t - t0) / (t1 - t0));
        return Array.isArray(v0) ? v0.map((a, j) => a + (v1[j] - a) * k) : v0 + (v1 - v0) * k;
      }
    }
    return keys[keys.length - 1][1];
  };
  /** foot path: list of [tStart, tEnd, to] steps from `start`, arcing `lift` metres mid-step */
  const footPath = (start, steps, lift = 0.07) => (t) => {
    let pos = start;
    for (const [t0, t1, to, l = lift, e = 'io'] of steps) {
      if (t < t0) return pos;
      if (t <= t1) {
        const x = (t - t0) / (t1 - t0);
        const k = ease[e](x);
        const p = pos.map((a, j) => a + (to[j] - a) * k);
        p[1] = ANKLE + 4 * x * (1 - x) * l;
        return p;
      }
      pos = to;
    }
    return pos;
  };

  const footRelL = S.restRootRelative(P, 'LeftFoot');
  const footRelR = S.restRootRelative(P, 'RightFoot');
  const KEY_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];

  /** pose one figure from a parameter set and key it at time t */
  const poseFig = (e, t, q) => {
    S.resetPose(e);
    e.root.position.set(q.c[0], 0, q.c[2]);
    e.root.rotation.set(0, q.yaw, 0);
    e.root.updateMatrixWorld(true);
    S.dropHips(e, q.drop);
    S.aimBone(e, 'Spine', q.spine, 'Spine2');
    S.aimBone(e, 'Spine2', q.chest ?? q.spine, 'Neck');
    S.aimBone(e, 'Neck', q.head, 'Head');
    S.aimBone(e, 'Head', q.head, 'HeadTop_End');
    const F = fwd(q.yaw), L = left(q.yaw);
    S.solveLimb(e, 'LeftUpLeg', 'LeftLeg', 'LeftFoot', q.footL, [F[0] + L[0] * 0.35, 0, F[2] + L[2] * 0.35]);
    S.solveLimb(e, 'RightUpLeg', 'RightLeg', 'RightFoot', q.footR, [F[0] - L[0] * 0.35, 0, F[2] - L[2] * 0.35]);
    S.setBoneRootRelative(e, 'LeftFoot', footRelL);
    S.setBoneRootRelative(e, 'RightFoot', footRelR);
    S.aimBone(e, 'LeftArm', q.la);
    S.aimBone(e, 'LeftForeArm', q.lf);
    S.aimBone(e, 'RightArm', q.ra);
    S.aimBone(e, 'RightForeArm', q.rf);
    S.time = t;
    const ez = 'linear';
    tl.key(`obj:${e.id}.position`, 'vec', t, e.root.position.toArray(), ez);
    tl.key(`obj:${e.id}.quaternion`, 'quat', t, e.root.quaternion.toArray(), ez);
    tl.key(`obj:${e.id}.scale`, 'vec', t, [1, 1, 1], ez);
    for (const b of KEY_BONES) tl.key(`bone:${e.id}:${b}`, 'quat', t, e.bones.get(b).quaternion.toArray(), ez);
    tl.key(`bone:${e.id}:Hips.position`, 'vec', t, e.bones.get('Hips').position.toArray(), ez);
  };

  // ------------------------------------------------------------ protagonist 主角 (faces -Z, its left = -X)
  const Y0 = Math.PI, Y1 = Math.PI * 1.25; // ends turned 45° toward the attacker's line
  const C0 = [0, 0, 0], C1 = [0.8, 0, -0.1];
  const L0 = at(C0, Y0, 0.22, 0.12), R0 = at(C0, Y0, -0.18, -0.16);
  const L1 = at(C1, Y1, 0.22, 0.12), R1 = at(C1, Y1, -0.18, -0.16);
  const guardArms = { la: [0.3, -0.75, 0.55], lf: [-0.25, 0.8, 0.55], ra: [-0.3, -0.85, 0.4], rf: [0.3, 0.85, 0.4] };
  const pC = curve([
    [0, C0], [2.34, C0, 'io'],
    [2.38, [-0.05, 0, 0.01], 'in'], // anticipation: weight onto the left (push) foot
    [2.52, [0.5, 0, -0.08], 'lin'], // explosive lateral drive
    [2.64, [C1[0] + 0.08, 0, C1[2] - 0.02], 'out'], // overshoot
    [2.92, C1], [9, C1],
  ]);
  const pYaw = curve([[0, Y0], [2.40, Y0, 'io'], [2.66, Y1 + 0.06, 'out'], [2.97, Y1], [9, Y1]]);
  const pDrop = curve([[0, 0.12], [0.8, 0.135], [1.6, 0.115], [2.28, 0.125, 'io'], [2.38, 0.19, 'lin'], [2.52, 0.2, 'io'], [2.66, 0.21, 'out'], [2.97, 0.13], [3.6, 0.14], [9, 0.135]]);
  // spine / head in FIGURE space (+X = its left). Slip: lean to its right (-X) and forward, head further off-line.
  const pSpine = curve([[0, [0, 1, 0.12]], [2.34, [0, 1, 0.12]], [2.39, [0.12, 1, 0.1], 'in'], [2.52, [-0.5, 1, 0.3], 'out'], [2.66, [-0.35, 1, 0.25]], [2.97, [-0.05, 1, 0.14]], [9, [-0.03, 1, 0.13]]]);
  const pHead = curve([[0, [0, 1, 0.08]], [2.34, [0, 1, 0.08]], [2.39, [0.1, 1, 0.05], 'in'], [2.50, [-0.65, 1, 0.25], 'out'], [2.67, [-0.4, 1, 0.2]], [3.02, [0.1, 1, 0.12]], [9, [0.12, 1, 0.1]]]);
  const pFootL = footPath(L0, [[2.52, 2.67, L1, 0.06, 'io']]);
  const pFootR = footPath(R0, [[2.38, 2.52, R1, 0.09, 'io']]);
  const P_q = (t) => ({ c: pC(t), yaw: pYaw(t), drop: pDrop(t), spine: pSpine(t), head: pHead(t), footL: pFootL(t), footR: pFootR(t), ...guardArms });

  // ------------------------------------------------------------ attacker 攻擊者 (faces +Z, its left = +X)
  const AX = 0.08;
  const aL = (z) => [AX + 0.12, ANKLE, z], aR = (z) => [AX - 0.12, ANKLE, z];
  const aFootL = footPath(aL(-4.0), [[1.25, 1.5, aL(-2.95), 0.12], [1.72, 1.94, aL(-1.8), 0.13], [2.14, 2.42, aL(-0.75), 0.1, 'out'], [2.84, 3.1, [AX + 0.2, ANKLE, 1.05], 0.1], [3.5, 3.75, [AX + 0.28, ANKLE, 1.2], 0.04]]);
  const aFootR = footPath(aR(-4.4), [[1.0, 1.25, aR(-3.45), 0.12], [1.5, 1.72, aR(-2.35), 0.13], [1.94, 2.14, aR(-1.3), 0.12], [2.55, 2.82, [AX - 0.18, ANKLE, 0.35], 0.12], [3.12, 3.36, [AX - 0.22, ANKLE, 1.55], 0.08]]);
  const aZ = curve([[0, -4.2], [0.95, -4.2, 'in'], [1.6, -2.85, 'lin'], [2.3, -1.3, 'lin'], [2.52, -0.72, 'lin'], [2.85, 0.15, 'lin'], [3.2, 0.9, 'out'], [3.6, 1.3], [9, 1.3]]);
  const aX = curve([[0, AX], [2.5, AX], [3.2, AX + 0.02], [9, AX]]);
  const aYaw = curve([[0, 0], [2.3, 0], [2.48, -0.3, 'out'], [2.8, -0.1], [3.4, 0], [3.9, 0.55], [9, 0.55]]);
  const aDrop = curve([[0, 0.1], [1.0, 0.12], [1.12, 0.07], [1.37, 0.08], [1.6, 0.06], [1.83, 0.08], [2.05, 0.06], [2.3, 0.12, 'io'], [2.5, 0.22, 'io'], [2.85, 0.2], [3.2, 0.17], [3.7, 0.12], [9, 0.1]]);
  const aSpine = curve([[0, [0, 1, 0.12]], [0.95, [0, 1, 0.12]], [1.3, [0, 1, 0.4]], [2.3, [0, 1, 0.42]], [2.5, [-0.08, 1, 0.75], 'out'], [2.9, [0.05, 1, 0.65]], [3.4, [0, 1, 0.3]], [3.9, [0.08, 1, 0.12]], [9, [0.08, 1, 0.12]]]);
  const aHead = curve([[0, [0, 1, 0.05]], [2.5, [0, 1, 0.15]], [2.8, [0.2, 1, 0.2]], [3.3, [0.45, 1, 0.1]], [3.9, [0.6, 1, 0.05]], [9, [0.6, 1, 0.05]]]);
  // arms: pumping during the charge, then a straight right punch at ~2.45 s
  const pump = (t, side) => {
    const ph = Math.sin((t - 1.0) * Math.PI * 2 * 1.15 + (side === 'L' ? 0 : Math.PI));
    return { a: [side === 'L' ? 0.25 : -0.25, -1, 0.15 + 0.55 * ph], f: [side === 'L' ? -0.1 : 0.1, 0.35, 1] };
  };
  const guardA = { la: [0.3, -0.75, 0.55], lf: [-0.25, 0.8, 0.55], ra: [-0.3, -0.85, 0.4], rf: [0.3, 0.85, 0.4] };
  const punchArms = { la: [0.35, -0.85, 0.1], lf: [-0.2, 0.85, 0.35], ra: [-0.08, 0.12, 1], rf: [-0.05, 0.1, 1] };
  const recoverArms = { la: [0.35, -0.9, 0.25], lf: [-0.1, 0.4, 1], ra: [-0.3, -0.85, 0.45], rf: [0.15, 0.6, 0.8] };
  const blendArms = (x, y, k) => Object.fromEntries(Object.keys(x).map((n) => [n, x[n].map((v, j) => v + (y[n][j] - v) * k)]));
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const aArms = (t) => {
    if (t < 0.95) return guardA;
    const run = { la: pump(t, 'L').a, lf: pump(t, 'L').f, ra: pump(t, 'R').a, rf: pump(t, 'R').f };
    if (t < 1.15) return blendArms(guardA, run, ease.io((t - 0.95) / 0.2));
    if (t < 2.36) return run;
    if (t < 2.52) return blendArms(run, punchArms, ease.out((t - 2.36) / 0.16));
    if (t < 2.68) return punchArms;
    return blendArms(punchArms, recoverArms, ease.io(clamp01((t - 2.68) / 0.6)));
  };
  const A_q = (t) => ({ c: [aX(t), 0, aZ(t)], yaw: aYaw(t), drop: aDrop(t), spine: aSpine(t), head: aHead(t), footL: aFootL(t), footR: aFootR(t), ...aArms(t) });

  // ------------------------------------------------------------ sample (every frame in the action, every 2nd elsewhere)
  const MAIN_END = 4.0;
  for (let f = 0; f <= MAIN_END * 24; f++) {
    const t = f / 24;
    const dense = t >= 0.9 && t <= 3.4;
    if (!dense && f % 2 && f !== MAIN_END * 24) continue;
    poseFig(P, t, P_q(t));
    poseFig(A, t, A_q(t));
  }

  // ------------------------------------------------------------ camera
  const cam = (t, pos, tgt, fov, e = 'easeInOut') => {
    tl.key('camera.position', 'vec', t, pos, e);
    tl.key('camera.target', 'vec', t, tgt, e);
    tl.key('camera.fov', 'vec', t, [fov], e);
  };
  // 3/4 front of the protagonist, from its left-front: the sidestep reads left->right across the frame
  cam(0, [-5.0, 1.8, -3.0], [0.0, 0.95, -2.0], 42);
  cam(1.6, [-4.6, 1.7, -3.4], [0.1, 0.95, -1.2], 41);
  cam(2.3, [-3.9, 1.6, -3.9], [0.25, 0.98, -0.7], 40, 'easeIn');
  cam(2.75, [-2.55, 1.4, -2.95], [0.5, 1.0, -0.4], 34, 'easeOut');
  cam(3.4, [-2.45, 1.38, -2.8], [0.55, 1.0, -0.3], 34);
  cam(MAIN_END, [-2.42, 1.37, -2.75], [0.56, 1.0, -0.28], 34, 'step');

  // ------------------------------------------------------------ slow-motion replay (time remap) from a low reverse angle
  const R0T = 2.25, R1T = 3.1, DST = MAIN_END + 0.25, SPEED = 0.45;
  tl.retimeCopy(R0T, R1T, DST, SPEED, (id) => !id.startsWith('camera'));
  const rEnd = DST + (R1T - R0T) / SPEED;
  cam(DST, [2.5, 3.3, 2.0], [0.3, 0.6, -0.5], 40, 'linear');
  cam(rEnd, [3.3, 2.9, 0.5], [0.4, 0.65, -0.45], 38, 'easeInOut');
  cam(rEnd + 0.45, [3.32, 2.89, 0.46], [0.4, 0.65, -0.45], 38);
  tl.duration = Math.round((rEnd + 0.45) * 24) / 24;
  S.applySettings({ background: '#c4c7cc', outline: true, shadows: true, grid: false });
  S.applyTime(0);
  return { duration: tl.duration, tracks: tl.tracks.size, replay: [DST, rEnd] };
}
