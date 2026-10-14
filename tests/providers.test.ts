import { describe, expect, it, vi } from 'vitest';
import { PROVIDERS, getProvider, runJob, type GenRequest } from '../src/providers';
import { proxify } from '../src/providers/runner';
import { klingJwt } from '../src/providers/kling';
import { createHmac } from 'node:crypto';

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
const base: GenRequest = { mode: 'video', prompt: 'a person walking', image: IMG, strength: 0.6, durationSec: 5, aspectRatio: '16:9' };

/** Mock fetch that replays a script of [matcher, response] pairs and records calls. */
function mockFetch(script: Array<[RegExp, number, unknown]>) {
  const calls: { url: string; init: RequestInit; body?: any }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const i = script.findIndex(([re]) => re.test(url));
    if (i < 0) throw new Error(`unexpected ${url}`);
    const [, status, body] = script.splice(i, 1)[0];
    return new Response(JSON.stringify(body), { status });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const fast = { sleep: async () => {}, pollIntervalMs: 0 };

describe('provider registry', () => {
  it('has the six adapters with docs links', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['xai', 'replicate', 'fal', 'runway', 'luma', 'kling']);
    PROVIDERS.forEach((p) => expect(p.docs).toMatch(/^https:\/\//));
  });
});

describe('xAI Grok Imagine', () => {
  const p = getProvider('xai');
  it('builds image edit / generation requests', () => {
    const edit = p.buildSubmit({ ...base, mode: 'image' });
    expect(edit.url).toBe('https://api.x.ai/v1/images/edits');
    expect((edit.body as any).image).toEqual({ url: IMG, type: 'image_url' });
    const gen = p.buildSubmit({ mode: 'image', prompt: 'x' });
    expect(gen.url).toBe('https://api.x.ai/v1/images/generations');
    expect((gen.body as any).model).toBe('grok-imagine-image-2.0');
  });
  it('runs a video job: submit -> poll pending -> done', async () => {
    const m = mockFetch([
      [/videos\/generations$/, 200, { request_id: 'r1' }],
      [/videos\/r1$/, 200, { status: 'pending', progress: 40 }],
      [/videos\/r1$/, 200, { status: 'done', video: { url: 'https://vidgen.x.ai/v.mp4' } }],
    ]);
    const out = await runJob(p, base, { creds: { apiKey: 'xai-test' }, fetchImpl: m.fn, ...fast });
    expect(out).toEqual(['https://vidgen.x.ai/v.mp4']);
    expect(m.calls[0].body).toMatchObject({ model: 'grok-imagine-video-1.5', duration: 5, aspect_ratio: '16:9', image: { url: IMG } });
    expect((m.calls[0].init.headers as any).Authorization).toBe('Bearer xai-test');
  });
  it('returns synchronous image outputs without polling', async () => {
    const m = mockFetch([[/images\/edits$/, 200, { data: [{ url: 'https://x/img.jpg' }] }]]);
    expect(await runJob(p, { ...base, mode: 'image' }, { creds: { apiKey: 'k' }, fetchImpl: m.fn, ...fast })).toEqual(['https://x/img.jpg']);
    expect(m.calls).toHaveLength(1);
  });
  it('surfaces failures', async () => {
    const m = mockFetch([[/generations$/, 200, { request_id: 'r' }], [/videos\/r$/, 200, { status: 'failed', error: { message: 'moderated' } }]]);
    await expect(runJob(p, base, { creds: { apiKey: 'k' }, fetchImpl: m.fn, ...fast })).rejects.toThrow('moderated');
    const m2 = mockFetch([[/generations$/, 401, { error: 'bad key' }]]);
    await expect(runJob(p, base, { creds: { apiKey: 'k' }, fetchImpl: m2.fn, ...fast })).rejects.toThrow(/HTTP 401: bad key/);
  });
});

describe('Replicate', () => {
  const p = getProvider('replicate');
  it('uses the models endpoint for owner/name and versions endpoint for hashes', () => {
    expect(p.buildSubmit({ ...base, model: 'wan-video/wan-2.2-i2v-fast' }).url).toBe('https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions');
    const v = p.buildSubmit({ ...base, model: 'owner/x:abc123', extra: { control_image: '$image', seed: 1 } });
    expect(v.url).toBe('https://api.replicate.com/v1/predictions');
    expect(v.body).toMatchObject({ version: 'abc123', input: { prompt: 'a person walking', image: IMG, strength: 0.6, control_image: IMG, seed: 1 } });
  });
  it('polls urls.get and collects output URLs', async () => {
    const m = mockFetch([
      [/predictions$/, 201, { id: 'p1', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } }],
      [/predictions\/p1$/, 200, { status: 'processing' }],
      [/predictions\/p1$/, 200, { status: 'succeeded', output: ['https://replicate.delivery/a.mp4'] }],
    ]);
    expect(await runJob(p, base, { creds: { apiKey: 'r8_x' }, fetchImpl: m.fn, ...fast })).toEqual(['https://replicate.delivery/a.mp4']);
  });
});

describe('fal.ai', () => {
  const p = getProvider('fal');
  it('submits to the queue and fetches the response_url when completed', async () => {
    const m = mockFetch([
      [/queue\.fal\.run\/fal-ai\/kling-video\/v2\.1\/standard\/image-to-video$/, 200, { request_id: 'q1', status_url: 'https://queue.fal.run/fal-ai/kling-video/requests/q1/status', response_url: 'https://queue.fal.run/fal-ai/kling-video/requests/q1' }],
      [/q1\/status$/, 200, { status: 'IN_PROGRESS' }],
      [/q1\/status$/, 200, { status: 'COMPLETED' }],
      [/requests\/q1$/, 200, { video: { url: 'https://v3.fal.media/out.mp4' } }],
    ]);
    expect(await runJob(p, base, { creds: { apiKey: 'fal-k' }, fetchImpl: m.fn, ...fast })).toEqual(['https://v3.fal.media/out.mp4']);
    expect((m.calls[0].init.headers as any).Authorization).toBe('Key fal-k');
    expect(m.calls[0].body).toMatchObject({ image_url: IMG, strength: 0.6, duration: '5' });
  });
});

describe('Runway', () => {
  const p = getProvider('runway');
  it('chooses image_to_video or video_to_video and sends the version header', async () => {
    expect(p.buildSubmit(base).url).toBe('https://api.dev.runwayml.com/v1/image_to_video');
    const v2v = p.buildSubmit({ ...base, video: 'https://x/a.mp4' });
    expect(v2v.url).toBe('https://api.dev.runwayml.com/v1/video_to_video');
    expect(v2v.body).toMatchObject({ model: 'gen4_aleph', videoUri: 'https://x/a.mp4' });
    expect(await p.authHeaders({ apiKey: 'k' })).toEqual({ Authorization: 'Bearer k', 'X-Runway-Version': '2024-11-06' });
    const m = mockFetch([[/image_to_video$/, 200, { id: 't1' }], [/tasks\/t1$/, 200, { status: 'RUNNING', progress: 0.5 }], [/tasks\/t1$/, 200, { status: 'SUCCEEDED', output: ['https://dnznrvs05pmza.cloudfront.net/o.mp4'] }]]);
    expect(await runJob(p, base, { creds: { apiKey: 'k' }, fetchImpl: m.fn, ...fast })).toHaveLength(1);
    expect(m.calls[0].body).toMatchObject({ model: 'gen4_turbo', promptImage: IMG, ratio: '1280:720', duration: 5 });
  });
});

describe('Luma', () => {
  const p = getProvider('luma');
  it('requires public URLs and maps keyframes', async () => {
    expect(() => p.buildSubmit(base)).toThrow(/public https/);
    const r = p.buildSubmit({ ...base, image: 'https://cdn/x.png' });
    expect(r.body).toMatchObject({ model: 'ray-2', keyframes: { frame0: { type: 'image', url: 'https://cdn/x.png' } } });
    const m = mockFetch([[/generations$/, 201, { id: 'g1', state: 'queued' }], [/generations\/g1$/, 200, { state: 'completed', assets: { video: 'https://storage.cdn-luma.com/v.mp4' } }]]);
    expect(await runJob(p, { ...base, image: 'https://cdn/x.png' }, { creds: { apiKey: 'luma-k' }, fetchImpl: m.fn, ...fast })).toEqual(['https://storage.cdn-luma.com/v.mp4']);
  });
});

describe('Kling', () => {
  const p = getProvider('kling');
  it('signs a valid HS256 JWT', async () => {
    const tok = await klingJwt('AK', 'SK', 1_700_000_000);
    const [h, pl, sig] = tok.split('.');
    expect(JSON.parse(Buffer.from(pl, 'base64url').toString())).toEqual({ iss: 'AK', exp: 1_700_001_800, nbf: 1_699_999_995 });
    expect(sig).toBe(createHmac('sha256', 'SK').update(`${h}.${pl}`).digest('base64url'));
  });
  it('strips the data URL prefix and maps strength to cfg_scale', async () => {
    const r = p.buildSubmit(base);
    expect(r.body).toMatchObject({ model_name: 'kling-v2-1', image: 'iVBORw0KGgo=', cfg_scale: 0.4, duration: '5' });
    const m = mockFetch([
      [/image2video$/, 200, { code: 0, data: { task_id: 'k1' } }],
      [/image2video\/k1$/, 200, { code: 0, data: { task_status: 'processing' } }],
      [/image2video\/k1$/, 200, { code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.klingai.com/o.mp4' }] } } }],
    ]);
    expect(await runJob(p, base, { creds: { accessKey: 'AK', secretKey: 'SK' }, fetchImpl: m.fn, ...fast })).toEqual(['https://cdn.klingai.com/o.mp4']);
    expect((m.calls[0].init.headers as any).Authorization).toMatch(/^Bearer ey/);
  });
});

describe('proxy mode', () => {
  it('rewrites URLs and never sends keys from the browser', async () => {
    const p = getProvider('runway');
    expect(proxify(p, 'https://api.dev.runwayml.com/v1/tasks/1?a=b', 'http://localhost:8787/')).toBe('http://localhost:8787/runway/api.dev.runwayml.com/v1/tasks/1?a=b');
    const m = mockFetch([[/localhost:8787\/runway\/api\.dev\.runwayml\.com\/v1\/image_to_video$/, 200, { id: 't' }], [/tasks\/t$/, 200, { status: 'SUCCEEDED', output: ['u'] }]]);
    await runJob(p, base, { creds: { apiKey: 'SHOULD_NOT_LEAK' }, proxyBase: 'http://localhost:8787', fetchImpl: m.fn, ...fast });
    expect(JSON.stringify(m.calls.map((c) => c.init.headers))).not.toContain('SHOULD_NOT_LEAK');
  });
  it('supports cancellation', async () => {
    const ac = new AbortController();
    const m = mockFetch([[/generations$/, 200, { request_id: 'r' }]]);
    ac.abort();
    await expect(runJob(getProvider('xai'), base, { creds: { apiKey: 'k' }, fetchImpl: m.fn, signal: ac.signal, ...fast })).rejects.toThrow('cancelled');
  });
});
