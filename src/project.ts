import type { Track } from './timeline';

export type ObjectType =
  | 'mannequin' | 'box' | 'cylinder' | 'sphere' | 'cone' | 'plane' | 'stairs' | 'wall' | 'table' | 'chair';

export const PRIMITIVE_TYPES: ObjectType[] = ['box', 'cylinder', 'sphere', 'cone', 'plane', 'stairs', 'wall', 'table', 'chair'];

export interface SceneObjectData {
  id: string;
  type: ObjectType;
  name: string;
  position: number[];
  quaternion: number[];
  scale: number[];
  /** mannequin only: animation clip playing (driven by timeline time) */
  clip?: string | null;
  clipSpeed?: number;
  /** mannequin only: local bone quaternions keyed by short bone name, e.g. "LeftArm" */
  pose?: Record<string, number[]>;
}

export interface CameraData {
  position: number[];
  target: number[];
  fov: number;
}

export interface ProjectSettings {
  outline: boolean;
  ao: boolean;
  shadows: boolean;
  grid: boolean;
  background: string;
}

export interface ProjectData {
  format: 'greybox-previs-studio';
  version: 1;
  name: string;
  objects: SceneObjectData[];
  camera: CameraData;
  timeline: { duration: number; fps: number; tracks: Track[] };
  settings: ProjectSettings;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  outline: true,
  ao: false,
  shadows: true,
  grid: true,
  background: '#bfc3c8',
};

function isNumArray(x: unknown, len?: number): x is number[] {
  return Array.isArray(x) && x.every((n) => typeof n === 'number' && Number.isFinite(n)) && (len === undefined || x.length === len);
}

export class ProjectError extends Error {}

/** Parse + validate a project JSON string (throws ProjectError with a readable message). */
export function parseProject(text: string): ProjectData {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectError('Not valid JSON');
  }
  if (raw?.format !== 'greybox-previs-studio') throw new ProjectError('Unknown file format');
  if (raw.version !== 1) throw new ProjectError(`Unsupported version ${raw.version}`);
  if (!Array.isArray(raw.objects)) throw new ProjectError('objects must be an array');
  const ids = new Set<string>();
  for (const o of raw.objects) {
    if (typeof o.id !== 'string' || !o.id) throw new ProjectError('object without id');
    if (ids.has(o.id)) throw new ProjectError(`duplicate object id ${o.id}`);
    ids.add(o.id);
    if (!isNumArray(o.position, 3) || !isNumArray(o.quaternion, 4) || !isNumArray(o.scale, 3)) {
      throw new ProjectError(`bad transform on ${o.id}`);
    }
  }
  const cam = raw.camera;
  if (!cam || !isNumArray(cam.position, 3) || !isNumArray(cam.target, 3) || typeof cam.fov !== 'number') {
    throw new ProjectError('bad camera');
  }
  const tl = raw.timeline;
  if (!tl || typeof tl.duration !== 'number' || typeof tl.fps !== 'number' || !Array.isArray(tl.tracks)) {
    throw new ProjectError('bad timeline');
  }
  for (const tr of tl.tracks) {
    if (typeof tr.id !== 'string' || (tr.kind !== 'vec' && tr.kind !== 'quat') || !Array.isArray(tr.keys)) {
      throw new ProjectError('bad track');
    }
    for (const k of tr.keys) if (typeof k.t !== 'number' || !isNumArray(k.v)) throw new ProjectError(`bad key in ${tr.id}`);
  }
  return {
    format: 'greybox-previs-studio',
    version: 1,
    name: typeof raw.name === 'string' ? raw.name : 'untitled',
    objects: raw.objects,
    camera: cam,
    timeline: tl,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

export function serializeProject(p: ProjectData): string {
  return JSON.stringify(p, null, 2);
}
