import { stripDataUrl, type Credentials, type ProviderAdapter } from './types';

function b64url(bytes: Uint8Array | string): string {
  const s = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HS256 JWT exactly as documented by Kling: iss=accessKey, exp=now+1800, nbf=now-5. */
export async function klingJwt(accessKey: string, secretKey: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: accessKey, exp: nowSec + 1800, nbf: nowSec - 5 }));
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

/**
 * Kling AI image-to-video (v1 task API). POST /v1/videos/image2video, poll GET /v1/videos/image2video/{task_id}.
 * Base https://api-singapore.klingai.com. Image is a URL or RAW base64 (no data: prefix).
 * Docs: https://app.klingai.com/global/dev/document-api  (community mirror of the reference:
 * https://github.com/aself101/kling-api/blob/main/docs/KLING_API_REFERENCE.md)
 */
export const kling: ProviderAdapter = {
  id: 'kling',
  label: 'Kling AI',
  status: 'implemented',
  modes: ['video'],
  docs: 'https://app.klingai.com/global/dev/document-api',
  origin: 'https://api-singapore.klingai.com',
  defaultModel: { image: '', video: 'kling-v2-1' },
  notes: 'Auth: API key, or Access Key + Secret Key (an HS256 JWT is signed locally/in the proxy). strength -> cfg_scale (1 - strength).',
  needsKeyPair: true,
  async authHeaders(c: Credentials) {
    if (c.accessKey && c.secretKey) return { Authorization: `Bearer ${await klingJwt(c.accessKey, c.secretKey)}` };
    return { Authorization: `Bearer ${c.apiKey ?? ''}` };
  },
  buildSubmit(req) {
    if (!req.image) throw new Error('Kling image2video needs an input image');
    const body: Record<string, unknown> = {
      model_name: req.model || this.defaultModel.video,
      image: req.image.startsWith('data:') ? stripDataUrl(req.image) : req.image,
      prompt: req.prompt,
      mode: 'std',
      duration: req.durationSec && req.durationSec >= 8 ? '10' : '5',
      ...req.extra,
    };
    if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
    if (req.strength !== undefined) body.cfg_scale = Math.round((1 - req.strength) * 100) / 100;
    return { method: 'POST', url: `${this.origin}/v1/videos/image2video`, body };
  },
  parseSubmit(json) {
    const id = json?.data?.task_id;
    if (json?.code !== 0 || !id) throw new Error(json?.message ?? 'Kling: no task_id');
    return { jobId: id };
  },
  buildPoll(sub) {
    return { method: 'GET', url: `${this.origin}/v1/videos/image2video/${sub.jobId}` };
  },
  parsePoll(json) {
    const d = json?.data;
    if (d?.task_status === 'succeed') return { state: 'done', outputs: (d.task_result?.videos ?? []).map((v: any) => v.url) };
    if (d?.task_status === 'failed') return { state: 'failed', error: d.task_status_msg ?? 'failed' };
    return { state: 'pending' };
  },
};
