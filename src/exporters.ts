import { zipSync } from 'fflate';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMTarget } from 'webm-muxer';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4Target } from 'mp4-muxer';
import type { Studio } from './studio';
import { edgeMap } from './edges';

export type PassName = 'beauty' | 'depth' | 'normal' | 'edge';

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type));
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

function pixels(c: HTMLCanvasElement): Uint8ClampedArray {
  const tmp = document.createElement('canvas');
  tmp.width = c.width;
  tmp.height = c.height;
  const ctx = tmp.getContext('2d')!;
  ctx.drawImage(c, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

/** Render one pass at the current timeline time and return a PNG blob. */
export async function renderPass(studio: Studio, w: number, h: number, pass: PassName, transparent = false): Promise<Blob> {
  if (pass !== 'edge') return canvasToBlob(studio.renderExport(w, h, pass, transparent));
  const n = pixels(studio.renderExport(w, h, 'normal'));
  const d = pixels(studio.renderExport(w, h, 'depth'));
  const out = edgeMap(n, d, w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return canvasToBlob(c);
}

export interface SequenceOptions {
  w: number;
  h: number;
  passes: PassName[];
  onProgress?: (i: number, n: number) => void;
  signal?: AbortSignal;
}

/** PNG image sequence (one folder per pass) zipped. Frames are stepped deterministically. */
export async function exportSequenceZip(studio: Studio, o: SequenceOptions): Promise<Blob> {
  const tl = studio.timeline;
  const n = tl.frameCount();
  const files: Record<string, Uint8Array> = {};
  const t0 = studio.time;
  try {
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) throw new Error('cancelled');
      studio.applyTime(tl.frameTime(i));
      for (const p of o.passes) {
        const b = await renderPass(studio, o.w, o.h, p);
        files[`${p}/${p}_${String(i).padStart(5, '0')}.png`] = new Uint8Array(await b.arrayBuffer());
      }
      o.onProgress?.(i + 1, n);
    }
  } finally {
    studio.applyTime(t0);
  }
  files['README.txt'] = new TextEncoder().encode(`Greybox Previs Studio sequence\nframes: ${n}\nfps: ${tl.fps}\nsize: ${o.w}x${o.h}\nffmpeg -framerate ${tl.fps} -i beauty/beauty_%05d.png -c:v libx264 -pix_fmt yuv420p out.mp4\n`);
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export interface VideoOptions {
  w: number;
  h: number;
  format: 'webm' | 'mp4';
  pass?: PassName;
  bitrate?: number;
  onProgress?: (i: number, n: number) => void;
  signal?: AbortSignal;
}

export async function videoSupport(): Promise<{ webcodecs: boolean; webm: boolean; mp4: boolean }> {
  if (typeof VideoEncoder === 'undefined') return { webcodecs: false, webm: typeof MediaRecorder !== 'undefined', mp4: false };
  const vp9 = await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: 1280, height: 720, bitrate: 4e6 }).catch(() => ({ supported: false }));
  const avc = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1280, height: 720, bitrate: 4e6 }).catch(() => ({ supported: false }));
  return { webcodecs: true, webm: !!vp9.supported, mp4: !!avc.supported };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Deterministic video export: every frame i is rendered at t = i / fps and encoded with an explicit
 * timestamp (WebCodecs), so output does not depend on real-time performance.
 * Falls back to MediaRecorder (real-time, WebM) on browsers without WebCodecs.
 */
export async function exportVideo(studio: Studio, o: VideoOptions): Promise<Blob> {
  const w = even(o.w);
  const h = even(o.h);
  const tl = studio.timeline;
  const fps = tl.fps;
  const n = tl.frameCount();
  const pass = o.pass ?? 'beauty';
  const bitrate = o.bitrate ?? Math.round(w * h * fps * 0.15);
  const t0 = studio.time;
  const sup = await videoSupport();

  const frameCanvas = async (): Promise<HTMLCanvasElement> => {
    if (pass === 'beauty' || pass === 'depth' || pass === 'normal') return studio.renderExport(w, h, pass);
    const img = await createImageBitmap(await renderPass(studio, w, h, pass));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c;
  };

  try {
    if (!sup.webcodecs) return await exportVideoMediaRecorder(studio, w, h, n, fps, frameCanvas, o);
    if (o.format === 'mp4' && !sup.mp4) throw new Error('H.264 encoding is not supported in this browser; export WebM or a PNG sequence.');
    let muxer: WebMMuxer<WebMTarget> | MP4Muxer<MP4Target>;
    let codec: string;
    if (o.format === 'mp4') {
      muxer = new MP4Muxer({ target: new MP4Target(), video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
      codec = 'avc1.640028';
    } else {
      muxer = new WebMMuxer({ target: new WebMTarget(), video: { codec: sup.webm ? 'V_VP9' : 'V_VP8', width: w, height: h, frameRate: fps } });
      codec = sup.webm ? 'vp09.00.10.08' : 'vp8';
    }
    let encodeError: unknown = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => (muxer as any).addVideoChunk(chunk, meta),
      error: (e) => (encodeError = e),
    });
    enc.configure({ codec, width: w, height: h, bitrate, framerate: fps });
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) throw new Error('cancelled');
      if (encodeError) throw encodeError;
      studio.applyTime(tl.frameTime(i));
      const c = await frameCanvas();
      const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      o.onProgress?.(i + 1, n);
    }
    await enc.flush();
    enc.close();
    if (encodeError) throw encodeError;
    muxer.finalize();
    const buf = (muxer.target as WebMTarget | MP4Target).buffer;
    return new Blob([buf], { type: o.format === 'mp4' ? 'video/mp4' : 'video/webm' });
  } finally {
    studio.applyTime(t0);
  }
}

async function exportVideoMediaRecorder(
  studio: Studio, w: number, h: number, n: number, fps: number,
  frameCanvas: () => Promise<HTMLCanvasElement>, o: VideoOptions,
): Promise<Blob> {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  const stream = out.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: o.bitrate ?? 8e6 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start();
  for (let i = 0; i < n; i++) {
    if (o.signal?.aborted) break;
    studio.applyTime(studio.timeline.frameTime(i));
    ctx.drawImage(await frameCanvas(), 0, 0);
    track.requestFrame();
    o.onProgress?.(i + 1, n);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await done;
  return new Blob(chunks, { type: 'video/webm' });
}
