import type { ProviderAdapter } from './types';

/**
 * Luma Dream Machine API. POST /dream-machine/v1/generations (video, Ray 2) and
 * /dream-machine/v1/generations/image (Photon). Poll GET /dream-machine/v1/generations/{id}.
 * Image inputs MUST be public https URLs (data URLs are not accepted).
 * Docs: https://docs.lumalabs.ai/docs/video-generation
 */
export const luma: ProviderAdapter = {
  id: 'luma',
  label: 'Luma Dream Machine',
  status: 'implemented',
  modes: ['image', 'video'],
  docs: 'https://docs.lumalabs.ai/docs/video-generation',
  origin: 'https://api.lumalabs.ai',
  defaultModel: { image: 'photon-1', video: 'ray-2' },
  notes: 'Luma only accepts public image URLs. Upload the exported still somewhere (or paste a URL) — data URLs are rejected by the API.',
  async authHeaders(c) {
    return { Authorization: `Bearer ${c.apiKey ?? ''}` };
  },
  buildSubmit(req) {
    if (req.image && req.image.startsWith('data:')) {
      throw new Error('Luma needs a public https image URL (paste it in "Input URL").');
    }
    if (req.mode === 'image') {
      const body: Record<string, unknown> = { prompt: req.prompt, model: req.model || this.defaultModel.image, aspect_ratio: req.aspectRatio ?? '16:9', ...req.extra };
      if (req.image) body.image_ref = [{ url: req.image, weight: req.strength !== undefined ? 1 - req.strength : 0.85 }];
      return { method: 'POST', url: `${this.origin}/dream-machine/v1/generations/image`, body };
    }
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      model: req.model || this.defaultModel.video,
      aspect_ratio: req.aspectRatio ?? '16:9',
      ...req.extra,
    };
    if (req.image) body.keyframes = { frame0: { type: 'image', url: req.image } };
    if (req.durationSec) body.duration = req.durationSec >= 8 ? '9s' : '5s';
    return { method: 'POST', url: `${this.origin}/dream-machine/v1/generations`, body };
  },
  parseSubmit(json) {
    if (!json?.id) throw new Error(json?.detail ?? 'Luma: no generation id');
    return { jobId: json.id };
  },
  buildPoll(sub) {
    return { method: 'GET', url: `${this.origin}/dream-machine/v1/generations/${sub.jobId}` };
  },
  parsePoll(json) {
    if (json?.state === 'completed') return { state: 'done', outputs: [json.assets?.video ?? json.assets?.image].filter(Boolean) };
    if (json?.state === 'failed') return { state: 'failed', error: json.failure_reason ?? 'failed' };
    return { state: 'pending' };
  },
};
