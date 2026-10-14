import './style.css';
import * as THREE from 'three';
import { Studio, type Entry } from './studio';
import { applyI18n, getLang, setLang, t } from './i18n';
import { EASINGS, type Easing } from './timeline';
import { SHOT_PRESETS, shotKeys, type ShotPreset } from './shots';
import { POSE_NAMES } from './poses';
import { parseProject, serializeProject, type ObjectType } from './project';
import { blobToDataUrl, download, exportSequenceZip, exportVideo, renderPass, videoSupport, type PassName } from './exporters';
import { PROVIDERS, getProvider, runJob, type GenRequest } from './providers';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];

const studio = new Studio($('#viewport'));
let lastVideo: Blob | null = null;
let busyAbort: AbortController | null = null;

// ----------------------------------------------------------------- helpers
const exportSize = () => ({ w: Math.min(4096, Math.max(64, +$<HTMLInputElement>('#exW').value)), h: Math.min(4096, Math.max(64, +$<HTMLInputElement>('#exH').value)) });
const ease = () => $<HTMLSelectElement>('#tlEase').value as Easing;

function updateGate(): void {
  const vp = $('#viewport');
  const { w, h } = exportSize();
  const a = w / h;
  studio.aspect = a;
  const W = vp.clientWidth, H = vp.clientHeight;
  // camera FOV is defined for the export frame; Studio.withDisplayFov keeps that frame inside the viewport
  let gh = H, gw = H * a;
  if (gw > W) { gw = W; gh = W / a; }
  Object.assign($('#gate').style, { width: `${gw}px`, height: `${gh}px`, left: `${(W - gw) / 2}px`, top: `${(H - gh) / 2}px` });
}
new ResizeObserver(updateGate).observe($('#viewport'));

async function busy<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  busyAbort = new AbortController();
  $('#busy').hidden = false;
  $('#busyText').textContent = label;
  try {
    return await fn(busyAbort.signal);
  } catch (e) {
    alert(String((e as Error).message ?? e));
  } finally {
    $('#busy').hidden = true;
    busyAbort = null;
  }
}
$('#busyCancel').onclick = () => busyAbort?.abort();
const progress = (label: string) => (i: number, n: number) => ($('#busyText').textContent = `${label} ${i}/${n}`);

// ---------------------------------------------------------------- outliner
function refreshOutliner(): void {
  const ul = $('#outliner');
  ul.innerHTML = '';
  for (const e of studio.entries.values()) {
    const li = document.createElement('li');
    li.innerHTML = `${escapeHtml(e.name)}<small>${t(e.type)}</small>`;
    if (studio.selection?.entry === e) li.classList.add('on');
    li.onclick = () => studio.select({ entry: e });
    ul.appendChild(li);
  }
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --------------------------------------------------------------- properties
const vecInputs = (id: string) => $$<HTMLInputElement>(`${id} input`);
function refreshProps(): void {
  const sel = studio.selection;
  $('#noSel').hidden = !!sel;
  $('#selPanel').hidden = !sel;
  if (!sel) return;
  const e = sel.entry;
  const active = document.activeElement;
  const setIf = (el: HTMLInputElement, v: string) => { if (el !== active) el.value = v; };
  setIf($<HTMLInputElement>('#pName'), e.name);
  const r = new THREE.Euler().setFromQuaternion(e.root.quaternion);
  vecInputs('#pPos').forEach((el, i) => setIf(el, e.root.position.getComponent(i).toFixed(2)));
  vecInputs('#pRot').forEach((el, i) => setIf(el, THREE.MathUtils.radToDeg([r.x, r.y, r.z][i]).toFixed(1)));
  vecInputs('#pScale').forEach((el, i) => setIf(el, e.root.scale.getComponent(i).toFixed(2)));
  $('#figPanel').hidden = e.type !== 'mannequin';
  if (e.type === 'mannequin') {
    const clipSel = $<HTMLSelectElement>('#pClip');
    if (clipSel.options.length !== studio.clipNames().length + 1) {
      clipSel.innerHTML = `<option value="">${t('none')}</option>` + studio.clipNames().map((c) => `<option>${c}</option>`).join('');
    }
    clipSel.value = e.clip ?? '';
    setIf($<HTMLInputElement>('#pSpeed'), String(e.clipSpeed));
    $('#pBone').textContent = sel.bone ?? '—';
  }
}
$<HTMLInputElement>('#pName').oninput = (ev) => { const e = studio.selection?.entry; if (e) { e.name = (ev.target as HTMLInputElement).value; e.root.name = e.name; refreshOutliner(); } };
const applyVec = () => {
  const e = studio.selection?.entry; if (!e) return;
  const p = vecInputs('#pPos').map((x) => +x.value), r = vecInputs('#pRot').map((x) => THREE.MathUtils.degToRad(+x.value)), s = vecInputs('#pScale').map((x) => +x.value || 1);
  e.root.position.fromArray(p); e.root.rotation.set(r[0], r[1], r[2]); e.root.scale.fromArray(s);
};
[...vecInputs('#pPos'), ...vecInputs('#pRot'), ...vecInputs('#pScale')].forEach((el) => (el.oninput = applyVec));
$<HTMLSelectElement>('#pClip').onchange = (ev) => { const e = studio.selection?.entry; if (e) studio.setClip(e, (ev.target as HTMLSelectElement).value || null); };
$<HTMLInputElement>('#pSpeed').oninput = (ev) => { const e = studio.selection?.entry; if (e) { e.clipSpeed = +(ev.target as HTMLInputElement).value || 0; studio.applyTime(studio.time); } };
$('#poseBtns').innerHTML = POSE_NAMES.map((p) => `<button data-pose="${p}">${p}</button>`).join('');
$$('#poseBtns button').forEach((b) => (b.onclick = () => { const e = studio.selection?.entry; if (e) { studio.applyPose(e, b.dataset.pose as never); refreshProps(); } }));
$('#btnDup').onclick = () => { const e = studio.selection?.entry; if (e) { const d = studio.duplicate(e.id); if (d) studio.select({ entry: d }); } };
$('#btnDel').onclick = () => { const e = studio.selection?.entry; if (e) studio.removeEntry(e.id); };

// ------------------------------------------------------------------ toolbar
$<HTMLSelectElement>('#addSelect').onchange = (ev) => {
  const sel = ev.target as HTMLSelectElement;
  const type = sel.value as ObjectType;
  sel.value = '';
  if (!type) return;
  const target = studio.orbit.target;
  const e = studio.addObject(type, { name: `${t(type)} ${studio.entries.size + 1}`, position: [Math.round(target.x * 2) / 2, 0, Math.round(target.z * 2) / 2] });
  if (type === 'mannequin') studio.applyPose(e, 'stand');
  studio.select({ entry: e });
};
const setGizmoMode = (m: 'translate' | 'rotate' | 'scale') => {
  studio.gizmo.setMode(m);
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
};
$$('#modeSeg button').forEach((b) => (b.onclick = () => setGizmoMode(b.dataset.mode as never)));
$<HTMLInputElement>('#poseMode').onchange = (ev) => {
  const on = (ev.target as HTMLInputElement).checked;
  studio.setPoseMode(on);
  const e = studio.selection?.entry;
  if (on && e?.clip) studio.setClip(e, null);
  if (on) setGizmoMode('rotate');
};
$('#btnNew').onclick = () => { if (confirm('Clear scene?')) { studio.clearScene(); studio.applyTime(0); } };
$('#btnDemo').onclick = () => buildDemo();
$('#btnSave').onclick = () => download(new Blob([serializeProject(studio.toProject('greybox-project'))], { type: 'application/json' }), 'greybox-project.json');
$('#btnLoad').onclick = () => $<HTMLInputElement>('#fileLoad').click();
$<HTMLInputElement>('#fileLoad').onchange = async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try { loadProjectText(await f.text()); } catch (e) { alert(String((e as Error).message)); }
  (ev.target as HTMLInputElement).value = '';
};
function loadProjectText(text: string): void {
  const p = parseProject(text);
  studio.loadProject(p);
  syncTimelineInputs();
  syncViewInputs();
}
$$('#langSeg button').forEach((b) => (b.onclick = () => { setLang(b.dataset.lang as never); refreshLang(); }));
function refreshLang(): void {
  $$('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  fillSelect('#tlEase', EASINGS.map((e) => [e, e]), 'easeInOut');
  fillSelect('#shotSel', SHOT_PRESETS.map((s) => [s, t(s)]));
  $('#tlPlay').textContent = studio.playing ? t('pause') : t('play');
  refreshOutliner();
  refreshProps();
  refreshProvider();
}
function fillSelect(sel: string, items: [string, string][], def?: string): void {
  const el = $<HTMLSelectElement>(sel);
  const cur = el.value || def;
  el.innerHTML = items.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  if (cur) el.value = cur;
}

// -------------------------------------------------------------------- tabs
$$('.tabs button').forEach((b) => (b.onclick = () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.tab').forEach((x) => x.classList.toggle('on', x.id === `tab-${b.dataset.tab}`));
}));

// --------------------------------------------------------------------- view
function syncViewInputs(): void {
  const s = studio.settings;
  $<HTMLInputElement>('#vOutline').checked = s.outline;
  $<HTMLInputElement>('#vAO').checked = s.ao;
  $<HTMLInputElement>('#vShadows').checked = s.shadows;
  $<HTMLInputElement>('#vGrid').checked = s.grid;
  $<HTMLInputElement>('#vBg').value = s.background;
}
const viewChange = () => studio.applySettings({
  outline: $<HTMLInputElement>('#vOutline').checked, ao: $<HTMLInputElement>('#vAO').checked,
  shadows: $<HTMLInputElement>('#vShadows').checked, grid: $<HTMLInputElement>('#vGrid').checked, background: $<HTMLInputElement>('#vBg').value,
});
['#vOutline', '#vAO', '#vShadows', '#vGrid', '#vBg'].forEach((s) => ($<HTMLInputElement>(s).oninput = viewChange));

// ----------------------------------------------------------------- timeline
const tlCanvas = $<HTMLCanvasElement>('#tlCanvas');
function syncTimelineInputs(): void {
  $<HTMLInputElement>('#tlDur').value = String(studio.timeline.duration);
  $<HTMLSelectElement>('#tlFps').value = String(studio.timeline.fps);
}
$<HTMLInputElement>('#tlDur').oninput = (ev) => { studio.timeline.duration = Math.max(0.5, +(ev.target as HTMLInputElement).value || 5); drawTimeline(); };
$<HTMLSelectElement>('#tlFps').onchange = (ev) => { studio.timeline.fps = +(ev.target as HTMLSelectElement).value; drawTimeline(); };
$('#tlPlay').onclick = () => { studio.play(!studio.playing); $('#tlPlay').textContent = studio.playing ? t('pause') : t('play'); };
$('#keySel').onclick = () => { const s = studio.selection; if (s) studio.keyEntry(s.entry, s.bone, ease()); };
$('#keyPose').onclick = () => { const e = studio.selection?.entry; if (e) studio.keyPose(e, ease()); };
$('#keyCam').onclick = () => studio.keyCamera(ease());
$('#delKey').onclick = () => { studio.timeline.removeAt(studio.time); drawTimeline(); };
$('#shotApply').onclick = () => {
  const preset = $<HTMLSelectElement>('#shotSel').value as ShotPreset;
  const subj = studio.selection?.entry.root.getWorldPosition(new THREE.Vector3()) ?? studio.orbit.target.clone();
  const subject = [subj.x, Math.max(subj.y, 0) + (studio.selection?.entry.type === 'mannequin' ? 1.1 : 0.5), subj.z];
  for (const id of ['camera.position', 'camera.target', 'camera.fov']) studio.timeline.tracks.delete(id);
  for (const k of shotKeys(preset, subject, studio.timeline.duration)) {
    const e: Easing = preset === 'orbit' ? 'linear' : ease();
    studio.timeline.key('camera.position', 'vec', k.t, k.position, e);
    studio.timeline.key('camera.target', 'vec', k.t, k.target, e);
    studio.timeline.key('camera.fov', 'vec', k.t, [k.fov], e);
  }
  studio.applyTime(studio.time);
  drawTimeline();
};

function drawTimeline(): void {
  const dpr = window.devicePixelRatio || 1;
  const W = tlCanvas.clientWidth, H = tlCanvas.clientHeight;
  tlCanvas.width = W * dpr; tlCanvas.height = H * dpr;
  const c = tlCanvas.getContext('2d')!;
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);
  const dur = studio.timeline.duration, fps = studio.timeline.fps;
  const x = (tt: number) => 8 + (tt / dur) * (W - 16);
  c.fillStyle = '#7d848e'; c.font = '10px sans-serif';
  for (let s = 0; s <= dur + 1e-6; s += dur > 20 ? 5 : 1) {
    c.fillRect(x(s), 0, 1, 8); c.fillText(`${s}s`, x(s) + 2, 9);
  }
  c.fillStyle = '#3a3f47';
  if ((W - 16) / (dur * fps) > 3) for (let f = 0; f <= dur * fps; f++) c.fillRect(x(f / fps), 10, 1, 3);
  const rows: [string, string, string][] = [['camera.', '#4b9dff', 'CAM']];
  const sel = studio.selection?.entry;
  if (sel) rows.push([`obj:${sel.id}.`, '#ffb020', sel.name], [`bone:${sel.id}:`, '#ff6f6f', 'pose']);
  rows.push(['', '#9aa1ab', 'ALL']);
  rows.forEach(([prefix, col, label], ri) => {
    const y = 18 + ri * 11;
    c.fillStyle = '#6a717b'; c.fillText(label.slice(0, 10), W - 60, y + 7);
    c.fillStyle = col;
    for (const kt of studio.timeline.keyTimes(prefix || undefined)) {
      c.beginPath(); c.moveTo(x(kt), y); c.lineTo(x(kt) + 4, y + 4); c.lineTo(x(kt), y + 8); c.lineTo(x(kt) - 4, y + 4); c.fill();
    }
  });
  c.fillStyle = '#ff4d4d';
  c.fillRect(x(studio.time) - 1, 0, 2, H);
}
let scrubbing = false;
const scrub = (ev: PointerEvent) => {
  const r = tlCanvas.getBoundingClientRect();
  const dur = studio.timeline.duration, fps = studio.timeline.fps;
  const tt = Math.min(dur, Math.max(0, ((ev.clientX - r.left - 8) / (r.width - 16)) * dur));
  studio.play(false);
  $('#tlPlay').textContent = t('play');
  studio.applyTime(Math.round(tt * fps) / fps);
};
tlCanvas.onpointerdown = (ev) => { scrubbing = true; tlCanvas.setPointerCapture(ev.pointerId); scrub(ev); };
tlCanvas.onpointermove = (ev) => scrubbing && scrub(ev);
tlCanvas.onpointerup = () => (scrubbing = false);
new ResizeObserver(drawTimeline).observe(tlCanvas);

// ------------------------------------------------------------------- export
$$('#resPresets button').forEach((b) => (b.onclick = () => {
  const [w, h] = b.dataset.r!.split('x');
  $<HTMLInputElement>('#exW').value = w; $<HTMLInputElement>('#exH').value = h; updateGate();
}));
['#exW', '#exH'].forEach((s) => ($<HTMLInputElement>(s).oninput = updateGate));
$$('[data-still]').forEach((b) => (b.onclick = async () => {
  const pass = b.dataset.still as PassName;
  const { w, h } = exportSize();
  const blob = await renderPass(studio, w, h, pass, pass === 'beauty' && $<HTMLInputElement>('#exTransparent').checked);
  download(blob, `greybox_${pass}_${String(Math.round(studio.time * studio.timeline.fps)).padStart(4, '0')}.png`);
}));
$('#btnSeq').onclick = () => busy('ZIP', async (signal) => {
  const passes = $$<HTMLInputElement>('#seqPasses input:checked').map((i) => i.value as PassName);
  const blob = await exportSequenceZip(studio, { ...exportSize(), passes: passes.length ? passes : ['beauty'], signal, onProgress: progress('ZIP') });
  download(blob, 'greybox_sequence.zip');
});
$('#btnVideo').onclick = () => busy('Video', async (signal) => {
  const format = $<HTMLSelectElement>('#vidFormat').value as 'webm' | 'mp4';
  const blob = await exportVideo(studio, { ...exportSize(), format, pass: $<HTMLSelectElement>('#vidPass').value as PassName, signal, onProgress: progress('Video') });
  lastVideo = blob;
  download(blob, `greybox_previs.${format}`);
});
videoSupport().then((s) => {
  $('#vidSupport').textContent = s.webcodecs
    ? `WebCodecs ✓ · WebM ${s.webm ? 'VP9' : 'VP8'} · MP4 ${s.mp4 ? '✓' : '✗ (use WebM / ZIP + ffmpeg)'}`
    : 'WebCodecs ✗ → MediaRecorder (real-time WebM)';
  if (!s.mp4) $<HTMLSelectElement>('#vidFormat').options[1].disabled = true;
});

// ------------------------------------------------------------------------ AI
const keyStoreKey = (id: string) => `gps.key.${id}`;
const memKeys = new Map<string, { apiKey?: string; accessKey?: string; secretKey?: string }>();
fillSelect('#aiProvider', PROVIDERS.map((p) => [p.id, p.label]));
function refreshProvider(): void {
  const p = getProvider($<HTMLSelectElement>('#aiProvider').value);
  $('#aiStatus').textContent = `${t('status')}: ${t(p.status)} · ${p.modes.map((m) => t(m)).join('/')}`;
  $<HTMLAnchorElement>('#aiDocs').href = p.docs;
  $('#aiNotes').textContent = p.notes;
  $('#aiKeyPair').hidden = !p.needsKeyPair;
  const stored = memKeys.get(p.id) ?? JSON.parse(localStorage.getItem(keyStoreKey(p.id)) ?? '{}');
  $<HTMLInputElement>('#aiKey').value = stored.apiKey ?? '';
  $<HTMLInputElement>('#aiAk').value = stored.accessKey ?? '';
  $<HTMLInputElement>('#aiSk').value = stored.secretKey ?? '';
  $<HTMLInputElement>('#aiRemember').checked = !!localStorage.getItem(keyStoreKey(p.id));
  const mode = $<HTMLSelectElement>('#aiMode');
  if (!p.modes.includes(mode.value as never)) mode.value = p.modes[0];
  $<HTMLInputElement>('#aiModel').value = p.defaultModel[mode.value as 'image' | 'video'];
}
$<HTMLSelectElement>('#aiProvider').onchange = refreshProvider;
$<HTMLSelectElement>('#aiMode').onchange = () => {
  const p = getProvider($<HTMLSelectElement>('#aiProvider').value);
  $<HTMLInputElement>('#aiModel').value = p.defaultModel[$<HTMLSelectElement>('#aiMode').value as 'image' | 'video'];
};
$<HTMLSelectElement>('#aiConn').onchange = (ev) => ($('#aiProxy').hidden = (ev.target as HTMLSelectElement).value !== 'proxy');
$<HTMLSelectElement>('#aiSource').onchange = (ev) => ($('#aiUrl').hidden = (ev.target as HTMLSelectElement).value !== 'url');
$<HTMLInputElement>('#aiStrength').oninput = (ev) => ($('#aiStrengthOut').textContent = (ev.target as HTMLInputElement).value);
const saveKeys = () => {
  const id = $<HTMLSelectElement>('#aiProvider').value;
  const k = { apiKey: $<HTMLInputElement>('#aiKey').value.trim() || undefined, accessKey: $<HTMLInputElement>('#aiAk').value.trim() || undefined, secretKey: $<HTMLInputElement>('#aiSk').value.trim() || undefined };
  memKeys.set(id, k);
  if ($<HTMLInputElement>('#aiRemember').checked) localStorage.setItem(keyStoreKey(id), JSON.stringify(k));
  else localStorage.removeItem(keyStoreKey(id));
  return k;
};
['#aiKey', '#aiAk', '#aiSk', '#aiRemember'].forEach((s) => ($<HTMLInputElement>(s).onchange = saveKeys));
const log = (m: string) => { const el = $('#aiLog'); el.textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`; el.scrollTop = el.scrollHeight; };
let aiAbort: AbortController | null = null;
$('#aiCancel').onclick = () => aiAbort?.abort();
$('#aiGo').onclick = async () => {
  const p = getProvider($<HTMLSelectElement>('#aiProvider').value);
  const creds = saveKeys();
  const useProxy = $<HTMLSelectElement>('#aiConn').value === 'proxy';
  if (!useProxy && !creds.apiKey && !(creds.accessKey && creds.secretKey)) return log(`⚠ ${t('apiKey')}?`);
  let extra: Record<string, unknown> = {};
  const extraText = $<HTMLTextAreaElement>('#aiExtra').value.trim();
  if (extraText) { try { extra = JSON.parse(extraText); } catch { return log('⚠ extra JSON invalid'); } }
  const src = $<HTMLSelectElement>('#aiSource').value;
  const req: GenRequest = {
    mode: $<HTMLSelectElement>('#aiMode').value as 'image' | 'video',
    prompt: $<HTMLTextAreaElement>('#aiPrompt').value,
    negativePrompt: $<HTMLInputElement>('#aiNeg').value || undefined,
    strength: +$<HTMLInputElement>('#aiStrength').value,
    durationSec: +$<HTMLInputElement>('#aiDur').value,
    aspectRatio: $<HTMLSelectElement>('#aiAspect').value,
    model: $<HTMLInputElement>('#aiModel').value.trim() || undefined,
    extra,
  };
  const { w, h } = exportSize();
  if (src === 'beauty' || src === 'depth' || src === 'edge') req.image = await blobToDataUrl(await renderPass(studio, w, h, src));
  else if (src === 'video') { if (!lastVideo) return log('⚠ export a video first'); req.video = await blobToDataUrl(lastVideo); }
  else if (src === 'url') { const u = $<HTMLInputElement>('#aiUrl').value.trim(); if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) req.video = u; else req.image = u; }
  aiAbort = new AbortController();
  $<HTMLButtonElement>('#aiGo').disabled = true; $<HTMLButtonElement>('#aiCancel').disabled = false;
  log(`${p.label} · ${req.mode} · ${req.model ?? ''}`);
  try {
    const urls = await runJob(p, req, {
      creds, proxyBase: useProxy ? $<HTMLInputElement>('#aiProxy').value : undefined, signal: aiAbort.signal,
      onStatus: (m, pr) => log(pr !== undefined ? `${m} ${Math.round(pr * 100)}%` : m),
    });
    log(`done: ${urls.length} output(s)`);
    for (const u of urls) {
      const isVid = req.mode === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(u);
      const el = document.createElement(isVid ? 'video' : 'img') as HTMLVideoElement & HTMLImageElement;
      el.src = u; if (isVid) { el.controls = true; el.loop = true; }
      const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.download = ''; a.textContent = '⬇ ' + u.slice(0, 60);
      $('#aiResults').prepend(el, a);
    }
  } catch (e) {
    log(`✗ ${(e as Error).message}${/Failed to fetch|NetworkError/i.test(String(e)) ? ' — CORS? use the local proxy (npm run proxy)' : ''}`);
  } finally {
    $<HTMLButtonElement>('#aiGo').disabled = false; $<HTMLButtonElement>('#aiCancel').disabled = true;
  }
};

// ---------------------------------------------------------------- shortcuts
window.addEventListener('keydown', (ev) => {
  if ((ev.target as HTMLElement).closest('input,textarea,select')) return;
  if (ev.key === 'w') setGizmoMode('translate');
  else if (ev.key === 'e') setGizmoMode('rotate');
  else if (ev.key === 'r') setGizmoMode('scale');
  else if (ev.key === ' ') { ev.preventDefault(); $('#tlPlay').click(); }
  else if (ev.key === 'k') $('#keySel').click();
  else if (ev.key === 'Delete' || ev.key === 'Backspace') $('#btnDel').click();
  else if (ev.key === 'Escape') studio.select(null);
});

// -------------------------------------------------------------------- wiring
let changeQueued = false;
studio.onChange = () => {
  if (changeQueued) return;
  changeQueued = true;
  requestAnimationFrame(() => { changeQueued = false; refreshOutliner(); refreshProps(); drawTimeline(); });
};
studio.onSelect = () => { refreshOutliner(); refreshProps(); drawTimeline(); };
let lastTimeDraw = 0;
studio.onTime = (tt) => {
  $('#tlTime').textContent = `${tt.toFixed(2)}s · f${Math.round(tt * studio.timeline.fps)}`;
  const now = performance.now();
  if (now - lastTimeDraw > 30) { lastTimeDraw = now; drawTimeline(); if (studio.selection) refreshProps(); }
};

// ---------------------------------------------------------------------- demo
function buildDemo(): void {
  studio.select(null);
  studio.clearScene();
  studio.timeline.duration = 4;
  studio.timeline.fps = 24;
  const add = (type: ObjectType, name: string, pos: number[], rotY = 0, scale?: number[]): Entry =>
    studio.addObject(type, { name, position: pos, quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY).toArray(), scale: scale ?? [1, 1, 1] });
  add('plane', '地台', [0, 0, -1], 0, [3, 1, 2]);
  add('wall', '背牆', [0, 0, -4], 0, [2.5, 1.2, 1]);
  add('wall', '側牆', [-5, 0, -1], Math.PI / 2, [1.5, 1.2, 1]);
  add('stairs', '樓梯', [3.4, 0, -2.2], -Math.PI / 2);
  add('box', '櫃台', [-2.4, 0, -1.5], 0, [2.2, 1.05, 0.7]);
  add('table', '桌子', [2, 0, 1.4]);
  add('chair', '椅子', [2, 0, 2.15], Math.PI);
  add('cylinder', '柱子', [-3.6, 0, -3.2], 0, [0.6, 3.2, 0.6]);
  const walker = add('mannequin', '主角', [-1.8, 0, 1.2], Math.PI / 2);
  studio.setClip(walker, 'walk');
  const stander = add('mannequin', '配角', [1.2, 0, -0.6], -0.5);
  studio.applyPose(stander, 'think');
  const sitter = add('mannequin', '路人', [2, 0, 2.15], Math.PI);
  studio.applyPose(sitter, 'sit');
  studio.time = 0;
  studio.timeline.key(`obj:${walker.id}.position`, 'vec', 0, [-1.8, 0, 1.2], 'linear');
  studio.timeline.key(`obj:${walker.id}.position`, 'vec', 4, [1.0, 0, 1.2], 'linear');
  studio.timeline.key('camera.position', 'vec', 0, [-0.5, 1.6, 7.5], 'easeInOut');
  studio.timeline.key('camera.target', 'vec', 0, [-0.8, 1.0, 0.6], 'easeInOut');
  studio.timeline.key('camera.fov', 'vec', 0, [42], 'easeInOut');
  studio.timeline.key('camera.position', 'vec', 4, [1.6, 1.45, 4.6], 'easeInOut');
  studio.timeline.key('camera.target', 'vec', 4, [0.6, 1.0, 0.8], 'easeInOut');
  studio.timeline.key('camera.fov', 'vec', 4, [34], 'easeInOut');
  syncTimelineInputs();
  studio.applyTime(0);
}

// ---------------------------------------------------------------------- boot
applyI18n();
refreshLang();
syncTimelineInputs();
syncViewInputs();
updateGate();
studio.loadMannequin(`${import.meta.env.BASE_URL}models/Xbot.glb`).then(() => {
  buildDemo();
  (window as any).__ready = true;
}).catch((e) => alert(`Failed to load mannequin: ${e}`));

// test / automation hook (used by the Playwright verification script)
(window as any).__studio = {
  studio,
  async still(pass: PassName, w = 1280, h = 720, transparent = false) { return blobToDataUrl(await renderPass(studio, w, h, pass, transparent)); },
  async video(format: 'webm' | 'mp4' = 'webm', w = 640, h = 360, pass: PassName = 'beauty') { lastVideo = await exportVideo(studio, { w, h, format, pass }); return blobToDataUrl(lastVideo); },
  async zip(passes: PassName[] = ['beauty'], w = 320, h = 180) { return blobToDataUrl(await exportSequenceZip(studio, { w, h, passes })); },
  project: () => serializeProject(studio.toProject('test')),
  load: (s: string) => loadProjectText(s),
  support: videoSupport,
};
