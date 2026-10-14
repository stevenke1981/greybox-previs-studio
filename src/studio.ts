import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { EdgeOutlinePass } from './edgePass';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Timeline } from './timeline';
import { DEFAULT_SETTINGS, type ObjectType, type ProjectData, type ProjectSettings, type SceneObjectData } from './project';
import { AIM_CHILD, HANDLE_BONES, POSES, type PoseName, type PoseSpec } from './poses';
import { twoBoneIK, type V3 } from './ik';

export interface Entry {
  id: string;
  type: ObjectType;
  name: string;
  root: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  clips?: THREE.AnimationClip[];
  clip?: string | null;
  clipSpeed: number;
  bones?: Map<string, THREE.Bone>;
  rest?: Map<string, THREE.Quaternion>;
  restHips?: THREE.Vector3;
}

export type Selection = { entry: Entry; bone?: string } | null;

const CLAY = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.88, metalness: 0 });
const CLAY_FIG = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.8, metalness: 0 });
const CLAY_JOINT = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.75, metalness: 0 });

export const shortBone = (name: string) => name.replace(/^mixamorig[:_]?/, '');

let idCounter = 0;
const newId = (type: string) => `${type}${Date.now().toString(36).slice(-4)}${(idCounter++).toString(36)}`;

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

function boxAt(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), CLAY);
  m.position.set(x, y + h / 2, z);
  return m;
}

export function buildPrimitive(type: ObjectType): THREE.Object3D {
  const g = new THREE.Group();
  switch (type) {
    case 'box':
      g.add(boxAt(1, 1, 1));
      break;
    case 'cylinder': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 40), CLAY);
      m.position.y = 0.5;
      g.add(m);
      break;
    }
    case 'sphere': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 24), CLAY);
      m.position.y = 0.5;
      g.add(m);
      break;
    }
    case 'cone': {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 40), CLAY);
      m.position.y = 0.5;
      g.add(m);
      break;
    }
    case 'plane':
      g.add(boxAt(4, 0.02, 4));
      break;
    case 'wall':
      g.add(boxAt(4, 2.6, 0.15));
      break;
    case 'stairs':
      for (let i = 0; i < 6; i++) g.add(boxAt(1.4, 0.18 * (i + 1), 0.3, 0, 0, -i * 0.3));
      break;
    case 'table':
      g.add(boxAt(1.4, 0.05, 0.8, 0, 0.72, 0));
      for (const [x, z] of [[-0.62, -0.32], [0.62, -0.32], [-0.62, 0.32], [0.62, 0.32]]) g.add(boxAt(0.06, 0.72, 0.06, x, 0, z));
      break;
    case 'chair':
      g.add(boxAt(0.48, 0.05, 0.48, 0, 0.44, 0));
      g.add(boxAt(0.48, 0.5, 0.05, 0, 0.49, -0.215));
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(boxAt(0.04, 0.44, 0.04, x, 0, z));
      break;
    default:
      g.add(boxAt(1, 1, 1));
  }
  return shadowed(g);
}

/** Depth shader that supports skinned meshes: near = white, far = black (ControlNet convention). */
function makeDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 1 }, uFar: { value: 20 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      varying float vViewZ;
      void main() {
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        vViewZ = -mvPosition.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNear; uniform float uFar; varying float vViewZ;
      void main() {
        float d = 1.0 - clamp((vViewZ - uNear) / (uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(vec3(d), 1.0);
      }`,
  });
}

export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 300);
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  readonly timeline = new Timeline();
  readonly entries = new Map<string, Entry>();
  settings: ProjectSettings = { ...DEFAULT_SETTINGS };
  selection: Selection = null;
  poseMode = false;
  time = 0;
  playing = false;
  /** aspect ratio of the "film gate" used for exports and the viewport overlay */
  aspect = 16 / 9;
  onChange: () => void = () => {};
  onSelect: (s: Selection) => void = () => {};
  onTime: (t: number) => void = () => {};

  private grid: THREE.GridHelper;
  private ground: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private composer: EffectComposer;
  private outline: EdgeOutlinePass;
  private gtao: GTAOPass;
  private template?: THREE.Group;
  private templateClips: THREE.AnimationClip[] = [];
  private handles = new THREE.Group();
  private ray = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private exportRenderer?: THREE.WebGLRenderer;
  private exportComposer?: { composer: EffectComposer; outline: EdgeOutlinePass; w: number; h: number };
  private depthMat = makeDepthMaterial();
  private normalMat = new THREE.MeshNormalMaterial();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(this.settings.background);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a85, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(5, 9, 6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -12;
    this.sun.shadow.camera.right = 12;
    this.sun.shadow.camera.top = 12;
    this.sun.shadow.camera.bottom = -12;
    this.sun.shadow.radius = 6;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-6, 4, -5);
    this.scene.add(fill);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.name = '__ground';
    this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(40, 40, 0x8c9096, 0xa9adb3);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.grid.position.y = 0.001;
    this.scene.add(this.grid);
    this.handles.name = '__handles';
    this.scene.add(this.handles);

    this.camera.position.set(4, 2.2, 7);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 1, 0);
    this.orbit.enableDamping = true;
    this.orbit.update();

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.8);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value;
      if (!(e as unknown as { value: boolean }).value) this.onChange();
    });
    this.gizmo.addEventListener('objectChange', () => this.onChange());
    this.scene.add(this.gizmo.getHelper());

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 16, 16);
    this.gtao.enabled = this.settings.ao;
    this.composer.addPass(this.gtao);
    this.outline = this.makeOutline(this.camera);
    this.outline.thickness = Math.min(2, window.devicePixelRatio);
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());

    this.bindPicking();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private makeOutline(cam: THREE.Camera): EdgeOutlinePass {
    return new EdgeOutlinePass(this.scene, cam, () => [this.grid, this.gizmo.getHelper(), this.handles]);
  }

  async loadMannequin(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.template = gltf.scene;
    this.templateClips = gltf.animations;
  }

  clipNames(): string[] {
    return this.templateClips.map((c) => c.name);
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ objects
  addObject(type: ObjectType, data?: Partial<SceneObjectData>): Entry {
    let root: THREE.Object3D;
    const entry: Entry = { id: data?.id ?? newId(type), type, name: data?.name ?? type, root: null as unknown as THREE.Object3D, clipSpeed: data?.clipSpeed ?? 1 };
    if (type === 'mannequin') {
      if (!this.template) throw new Error('mannequin model not loaded');
      root = skeletonClone(this.template);
      root.traverse((c) => {
        const m = c as THREE.SkinnedMesh;
        if (m.isMesh) {
          m.material = /joint/i.test(m.name) ? CLAY_JOINT : CLAY_FIG;
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = false;
        }
      });
      entry.bones = new Map();
      entry.rest = new Map();
      root.traverse((c) => {
        if ((c as THREE.Bone).isBone) {
          const s = shortBone(c.name);
          entry.bones!.set(s, c as THREE.Bone);
          entry.rest!.set(s, c.quaternion.clone());
        }
      });
      entry.restHips = entry.bones.get('Hips')?.position.clone();
      entry.mixer = new THREE.AnimationMixer(root);
      entry.clips = this.templateClips;
      entry.clip = data?.clip ?? null;
    } else {
      root = buildPrimitive(type);
    }
    entry.root = root;
    root.name = entry.name;
    root.userData.entryId = entry.id;
    if (data?.position) root.position.fromArray(data.position);
    if (data?.quaternion) root.quaternion.fromArray(data.quaternion);
    if (data?.scale) root.scale.fromArray(data.scale);
    this.scene.add(root);
    this.entries.set(entry.id, entry);
    if (entry.bones && data?.pose) {
      for (const [b, q] of Object.entries(data.pose)) entry.bones.get(b)?.quaternion.fromArray(q);
    }
    if (entry.clip) this.setClip(entry, entry.clip);
    this.refreshOutline();
    this.onChange();
    return entry;
  }

  removeEntry(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (this.selection?.entry === e) this.select(null);
    e.mixer?.stopAllAction();
    this.scene.remove(e.root);
    this.entries.delete(id);
    for (const tid of [...this.timeline.tracks.keys()]) if (tid.startsWith(`obj:${id}.`) || tid.startsWith(`bone:${id}:`)) this.timeline.tracks.delete(tid);
    this.refreshOutline();
    this.onChange();
  }

  duplicate(id: string): Entry | undefined {
    const e = this.entries.get(id);
    if (!e) return;
    const d = this.entryData(e);
    return this.addObject(e.type, { ...d, id: undefined, name: `${e.name} copy`, position: [d.position[0] + 1, d.position[1], d.position[2]] });
  }

  clearScene(): void {
    for (const id of [...this.entries.keys()]) this.removeEntry(id);
    this.timeline.clear();
  }

  setClip(e: Entry, clip: string | null): void {
    if (!e.mixer) return;
    e.mixer.stopAllAction();
    e.clip = clip;
    if (clip) {
      const c = e.clips?.find((x) => x.name === clip);
      if (c) {
        const a = e.mixer.clipAction(c);
        a.play();
      }
    } else if (e.rest) {
      for (const [b, q] of e.rest) e.bones!.get(b)!.quaternion.copy(q);
      if (e.restHips) e.bones!.get('Hips')!.position.copy(e.restHips);
    }
    this.applyTime(this.time);
  }

  applyPose(e: Entry, name: PoseName): void {
    this.applyPoseSpec(e, POSES[name]);
  }

  /** Reset every bone (and the hips offset) of a mannequin to its bind pose. */
  resetPose(e: Entry): void {
    if (!e.bones || !e.rest) return;
    if (e.clip) this.setClip(e, null);
    for (const [b, q] of e.rest) e.bones.get(b)!.quaternion.copy(q);
    if (e.restHips) e.bones.get('Hips')!.position.copy(e.restHips);
    e.root.updateMatrixWorld(true);
  }

  applyPoseSpec(e: Entry, spec: PoseSpec): void {
    if (!e.bones || !e.rest) return;
    this.resetPose(e);
    for (const [boneName, dir] of spec.aims) this.aimBone(e, boneName, dir);
    if (spec.hipsDrop) this.dropHips(e, spec.hipsDrop);
    this.onChange();
  }

  /** Rotate `bone` so that the direction bone -> child points along `dir` (figure space, +Z forward, +X = figure's left). */
  aimBone(e: Entry, boneName: string, dir: number[], childName = AIM_CHILD[boneName]): void {
    const bone = e.bones?.get(boneName);
    const child = e.bones?.get(childName);
    if (!bone || !child || !bone.parent) return;
    const rootQ = e.root.getWorldQuaternion(new THREE.Quaternion());
    this.aimBoneWorld(bone, child, new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().applyQuaternion(rootQ));
  }

  private aimBoneWorld(bone: THREE.Bone, child: THREE.Object3D, want: THREE.Vector3): void {
    bone.updateMatrixWorld(true);
    const bw = bone.getWorldPosition(new THREE.Vector3());
    const cur = child.getWorldPosition(new THREE.Vector3()).sub(bw);
    if (cur.lengthSq() < 1e-12) return;
    const delta = new THREE.Quaternion().setFromUnitVectors(cur.normalize(), want.clone().normalize());
    const bwq = bone.getWorldQuaternion(new THREE.Quaternion());
    const pwq = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(pwq.multiply(delta.multiply(bwq)));
    bone.updateMatrixWorld(true);
  }

  /** Lower (or raise, negative) the hips by `m` metres in world space. */
  dropHips(e: Entry, m: number): void {
    const hips = e.bones?.get('Hips');
    if (!hips?.parent) return;
    const w = hips.getWorldPosition(new THREE.Vector3());
    w.y -= m;
    hips.position.copy(hips.parent.worldToLocal(w));
    hips.updateMatrixWorld(true);
  }

  /**
   * Two-bone IK: place the `end` joint (e.g. LeftFoot) at `target` (world) by rotating `upper` and `lower`,
   * bending toward `pole` (world direction, e.g. knee forward). Returns the reached end position.
   */
  solveLimb(e: Entry, upper: string, lower: string, end: string, target: number[], pole: number[]): number[] | undefined {
    const u = e.bones?.get(upper), l = e.bones?.get(lower), en = e.bones?.get(end);
    if (!u || !l || !en) return;
    e.root.updateMatrixWorld(true);
    const pu = u.getWorldPosition(new THREE.Vector3());
    const pl = l.getWorldPosition(new THREE.Vector3());
    const pe = en.getWorldPosition(new THREE.Vector3());
    const r = twoBoneIK(pu.toArray() as V3, target as V3, pu.distanceTo(pl), pl.distanceTo(pe), pole as V3);
    this.aimBoneWorld(u, l, new THREE.Vector3(...r.mid).sub(pu));
    this.aimBoneWorld(l, en, new THREE.Vector3(...r.end).sub(new THREE.Vector3(...r.mid)));
    return en.getWorldPosition(new THREE.Vector3()).toArray();
  }

  /** Set a bone's WORLD orientation relative to the figure root (used to keep feet flat on the floor). */
  setBoneRootRelative(e: Entry, boneName: string, rel: THREE.Quaternion): void {
    const b = e.bones?.get(boneName);
    if (!b?.parent) return;
    const world = e.root.getWorldQuaternion(new THREE.Quaternion()).multiply(rel);
    b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    b.updateMatrixWorld(true);
  }

  /** A bone's bind-pose world orientation relative to the figure root. */
  restRootRelative(e: Entry, boneName: string): THREE.Quaternion {
    const keep = new Map<string, THREE.Quaternion>();
    const hipsPos = e.bones!.get('Hips')!.position.clone();
    for (const [n, b] of e.bones!) keep.set(n, b.quaternion.clone());
    this.resetPose(e);
    const q = e.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(e.bones!.get(boneName)!.getWorldQuaternion(new THREE.Quaternion()));
    for (const [n, b] of e.bones!) b.quaternion.copy(keep.get(n)!);
    e.bones!.get('Hips')!.position.copy(hipsPos);
    e.root.updateMatrixWorld(true);
    return q;
  }

  // ---------------------------------------------------------------- selection
  select(sel: Selection): void {
    this.selection = sel;
    this.gizmo.detach();
    if (sel) {
      const target = sel.bone ? sel.entry.bones?.get(sel.bone) : sel.entry.root;
      if (target) this.gizmo.attach(target);
      if (sel.bone) this.gizmo.setMode('rotate');
      this.gizmo.setSpace(sel.bone ? 'local' : 'world');
    }
    this.rebuildHandles();
    this.onSelect(sel);
  }

  setPoseMode(on: boolean): void {
    this.poseMode = on;
    const sel = this.selection;
    if (sel && !on && sel.bone) this.select({ entry: sel.entry });
    else this.rebuildHandles();
  }

  private rebuildHandles(): void {
    this.handles.clear();
    const e = this.selection?.entry;
    if (!this.poseMode || !e?.bones) return;
    const geo = new THREE.SphereGeometry(0.035, 12, 8);
    for (const b of HANDLE_BONES) {
      if (!e.bones.has(b)) continue;
      const active = this.selection?.bone === b;
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: active ? 0xff5a1f : 0x1f8fff, depthTest: false, transparent: true, opacity: 0.9 }));
      m.renderOrder = 999;
      m.userData.bone = b;
      this.handles.add(m);
    }
  }

  private updateHandles(): void {
    const e = this.selection?.entry;
    if (!e?.bones) return;
    for (const h of this.handles.children) e.bones.get(h.userData.bone)?.getWorldPosition(h.position);
  }

  private bindPicking(): void {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (ev) => (down = { x: ev.clientX, y: ev.clientY }));
    el.addEventListener('pointerup', (ev) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4 || this.gizmo.dragging) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      this.withDisplayFov(() => this.ray.setFromCamera(ndc, this.camera));
      if (this.handles.children.length) {
        const h = this.ray.intersectObjects(this.handles.children, false)[0];
        if (h && this.selection) return this.select({ entry: this.selection.entry, bone: h.object.userData.bone });
      }
      const roots = [...this.entries.values()].map((e) => e.root);
      const hit = this.ray.intersectObjects(roots, true)[0];
      if (!hit) return this.select(null);
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.entryId) o = o.parent;
      const entry = o ? this.entries.get(o.userData.entryId) : undefined;
      this.select(entry ? { entry } : null);
    });
  }

  // ----------------------------------------------------------------- settings
  applySettings(s: Partial<ProjectSettings>): void {
    this.settings = { ...this.settings, ...s };
    (this.scene.background as THREE.Color).set(this.settings.background);
    this.grid.visible = this.settings.grid;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.sun.castShadow = this.settings.shadows;
    this.outline.enabled = this.settings.outline;
    this.gtao.enabled = this.settings.ao;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  private refreshOutline(): void {
    /* edge pass works on the whole frame; nothing to track */
  }

  // ----------------------------------------------------------------- timeline
  /** Record keys for an entry (transform, or a single bone when `bone` is given) at the current time. */
  keyEntry(e: Entry, bone?: string, ease: import('./timeline').Easing = 'easeInOut'): void {
    const t = this.time;
    if (bone && e.bones?.get(bone)) {
      this.timeline.key(`bone:${e.id}:${bone}`, 'quat', t, e.bones.get(bone)!.quaternion.toArray(), ease);
    } else {
      this.timeline.key(`obj:${e.id}.position`, 'vec', t, e.root.position.toArray(), ease);
      this.timeline.key(`obj:${e.id}.quaternion`, 'quat', t, e.root.quaternion.toArray(), ease);
      this.timeline.key(`obj:${e.id}.scale`, 'vec', t, e.root.scale.toArray(), ease);
    }
    this.onChange();
  }

  /** Key every posed bone of a mannequin (all bones that differ from rest or already have tracks). */
  keyPose(e: Entry, ease: import('./timeline').Easing = 'easeInOut'): void {
    if (!e.bones || !e.rest) return;
    for (const [b, bone] of e.bones) {
      const rest = e.rest.get(b)!;
      if (bone.quaternion.angleTo(rest) > 1e-3 || this.timeline.tracks.has(`bone:${e.id}:${b}`)) {
        this.timeline.key(`bone:${e.id}:${b}`, 'quat', this.time, bone.quaternion.toArray(), ease);
      }
    }
    const hips = e.bones.get('Hips');
    if (hips) this.timeline.key(`bone:${e.id}:Hips.position`, 'vec', this.time, hips.position.toArray(), ease);
    this.onChange();
  }

  keyCamera(ease: import('./timeline').Easing = 'easeInOut'): void {
    const t = this.time;
    this.timeline.key('camera.position', 'vec', t, this.camera.position.toArray(), ease);
    this.timeline.key('camera.target', 'vec', t, this.orbit.target.toArray(), ease);
    this.timeline.key('camera.fov', 'vec', t, [this.camera.fov], ease);
    this.onChange();
  }

  /** Evaluate the whole scene deterministically at time t (used by playback AND exporters). */
  applyTime(t: number): void {
    this.time = t;
    for (const e of this.entries.values()) {
      if (e.mixer && e.clip) e.mixer.setTime(t * e.clipSpeed);
    }
    const vals = this.timeline.evaluate(t);
    for (const [id, v] of vals) {
      if (id.startsWith('obj:')) {
        const [eid, prop] = id.slice(4).split('.');
        const e = this.entries.get(eid);
        if (!e) continue;
        if (prop === 'position') e.root.position.fromArray(v);
        else if (prop === 'quaternion') e.root.quaternion.fromArray(v);
        else if (prop === 'scale') e.root.scale.fromArray(v);
      } else if (id.startsWith('bone:')) {
        const [, eid, rest] = id.split(':');
        const e = this.entries.get(eid);
        if (!e?.bones || e.clip) continue;
        if (rest.endsWith('.position')) e.bones.get(rest.slice(0, -9))?.position.fromArray(v);
        else e.bones.get(rest)?.quaternion.fromArray(v);
      }
    }
    const cp = vals.get('camera.position');
    const ct = vals.get('camera.target');
    const cf = vals.get('camera.fov');
    if (cp) this.camera.position.fromArray(cp);
    if (ct) this.orbit.target.fromArray(ct);
    if (cf) this.camera.fov = cf[0];
    if (cp || ct || cf) {
      this.camera.lookAt(this.orbit.target);
      this.camera.updateProjectionMatrix();
    }
    this.scene.updateMatrixWorld(true);
    this.onTime(t);
  }

  play(on: boolean): void {
    this.playing = on;
    this.clock.getDelta();
  }

  private tick(): void {
    const dt = this.clock.getDelta();
    if (this.playing) {
      let t = this.time + dt;
      if (t > this.timeline.duration) t = 0;
      this.applyTime(t);
    } else {
      this.orbit.update();
    }
    this.updateHandles();
    this.withDisplayFov(() => this.composer.render());
  }

  /**
   * camera.fov is the vertical FOV of the EXPORT frame (aspect = this.aspect). When the viewport is
   * narrower than the export frame, widen the viewport FOV temporarily so the whole frame (the white
   * gate) stays visible. Exports therefore never depend on the window size.
   */
  withDisplayFov<T>(fn: () => T): T {
    const base = this.camera.fov;
    if (this.camera.aspect >= this.aspect) return fn();
    const k = this.aspect / this.camera.aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) * k));
    this.camera.updateProjectionMatrix();
    try {
      return fn();
    } finally {
      this.camera.fov = base;
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ export
  private getExportRenderer(w: number, h: number): THREE.WebGLRenderer {
    if (!this.exportRenderer) {
      this.exportRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.exportRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    const r = this.exportRenderer;
    r.shadowMap.enabled = this.settings.shadows;
    const cur = r.getSize(new THREE.Vector2());
    if (r.getPixelRatio() !== 1) r.setPixelRatio(1);
    if (cur.x !== w || cur.y !== h) r.setSize(w, h, false);
    return r;
  }

  /**
   * Render one frame at w x h into the export canvas and return it.
   * pass: "beauty" | "depth" | "normal". The canvas is reused, read it before the next call.
   */
  renderExport(w: number, h: number, pass: 'beauty' | 'depth' | 'normal' = 'beauty', transparent = false): HTMLCanvasElement {
    const r = this.getExportRenderer(w, h);
    const cam = this.camera.clone();
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const hidden: THREE.Object3D[] = [this.gizmo.getHelper(), this.handles];
    if (pass !== 'beauty' || transparent) hidden.push(this.grid);
    if (transparent) hidden.push(this.ground);
    const vis = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const bg = this.scene.background;
    try {
      if (pass === 'beauty') {
        this.scene.background = transparent ? null : bg;
        r.setClearColor(0x000000, transparent ? 0 : 1);
        if (this.settings.outline && !transparent) {
          if (!this.exportComposer || this.exportComposer.w !== w || this.exportComposer.h !== h) {
            const composer = new EffectComposer(r);
            composer.setPixelRatio(1);
            composer.setSize(w, h);
            const rp = new RenderPass(this.scene, cam);
            composer.addPass(rp);
            const outline = this.makeOutline(cam);
            composer.addPass(outline);
            composer.setSize(w, h);
            composer.addPass(new OutputPass());
            this.exportComposer = { composer, outline, w, h };
          }
          const { composer, outline } = this.exportComposer;
          (composer.passes[0] as RenderPass).camera = cam;
          outline.camera = cam;
          outline.thickness = Math.max(1, h / 560);
          composer.render();
        } else {
          r.render(this.scene, cam);
        }
      } else {
        this.scene.background = new THREE.Color(0x000000);
        if (pass === 'depth') {
          const { near, far } = this.depthRange(cam);
          this.depthMat.uniforms.uNear.value = near;
          this.depthMat.uniforms.uFar.value = far;
          this.scene.overrideMaterial = this.depthMat;
        } else {
          this.scene.overrideMaterial = this.normalMat;
        }
        r.setClearColor(0x000000, 1);
        const shadows = r.shadowMap.enabled;
        r.shadowMap.enabled = false;
        r.render(this.scene, cam);
        r.shadowMap.enabled = shadows;
      }
    } finally {
      this.scene.overrideMaterial = null;
      this.scene.background = bg;
      hidden.forEach((o, i) => (o.visible = vis[i]));
    }
    return r.domElement;
  }

  /** near/far for the depth pass: tight around the scene objects as seen from the camera. */
  private depthRange(cam: THREE.PerspectiveCamera): { near: number; far: number } {
    const box = new THREE.Box3();
    for (const e of this.entries.values()) box.expandByObject(e.root);
    if (box.isEmpty()) return { near: 0.5, far: 20 };
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const d = sphere.center.distanceTo(cam.position);
    return { near: Math.max(0.05, d - sphere.radius * 1.2), far: d + sphere.radius * 1.6 };
  }

  // ---------------------------------------------------------------- project IO
  entryData(e: Entry): SceneObjectData {
    const d: SceneObjectData = {
      id: e.id,
      type: e.type,
      name: e.name,
      position: e.root.position.toArray(),
      quaternion: e.root.quaternion.toArray(),
      scale: e.root.scale.toArray(),
    };
    if (e.bones && e.rest) {
      d.clip = e.clip ?? null;
      d.clipSpeed = e.clipSpeed;
      if (!e.clip) {
        d.pose = {};
        for (const [b, bone] of e.bones) if (bone.quaternion.angleTo(e.rest.get(b)!) > 1e-4) d.pose[b] = bone.quaternion.toArray();
      }
    }
    return d;
  }

  toProject(name = 'untitled'): ProjectData {
    return {
      format: 'greybox-previs-studio',
      version: 1,
      name,
      objects: [...this.entries.values()].map((e) => this.entryData(e)),
      camera: { position: this.camera.position.toArray(), target: this.orbit.target.toArray(), fov: this.camera.fov },
      timeline: this.timeline.toJSON(),
      settings: { ...this.settings },
    };
  }

  loadProject(p: ProjectData): void {
    this.select(null);
    this.clearScene();
    for (const o of p.objects) this.addObject(o.type, o);
    this.camera.position.fromArray(p.camera.position);
    this.orbit.target.fromArray(p.camera.target);
    this.camera.fov = p.camera.fov;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    const tl = Timeline_fromJSON(p.timeline);
    this.timeline.tracks = tl.tracks;
    this.timeline.duration = tl.duration;
    this.timeline.fps = tl.fps;
    this.applySettings(p.settings);
    this.applyTime(0);
    this.onChange();
  }
}

function Timeline_fromJSON(j: ProjectData['timeline']): Timeline {
  return Timeline.fromJSON(j);
}
