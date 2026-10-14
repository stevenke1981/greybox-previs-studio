import type { ProviderAdapter } from './types';

/**
 * xAI Grok Imagine.
 * Images: POST /v1/images/generations (text-to-image) and POST /v1/images/edits (image + prompt).
 * Video:  POST /v1/videos/generations -> { request_id }, poll GET /v1/videos/{request_id}.
 * Docs: https://docs.x.ai/developers/rest-api-reference/inference/images
 *       https://docs.x.ai/developers/rest-api-reference/inference/videos
 */
export const xai: ProviderAdapter = {
  id: 'xai',
  label: 'xAI Grok Imagine',
  status: 'implemented',
  modes: ['image', 'video'],
  docs: 'https://docs.x.ai/developers/model-capabilities/imagine',
  origin: 'https://api.x.ai',
  defaultModel: { image: 'grok-imagine-image-2.0', video: 'grok-imagine-video-1.5' },
  notes: 'Image: greybox still -> /images/edits. Video: still -> image-to-video (/videos/generations). Strength is not an API parameter; describe it in the prompt.',
  async authHeaders(c) {
    return { Authorization: `Bearer ${c.apiKey ?? ''}` };
  },
  buildSubmit(req) {
    const model = req.model || this.defaultModel[req.mode];
    if (req.mode === 'image') {
      if (req.image) {
        return {
          method: 'POST',
          url: `${this.origin}/v1/images/edits`,
          body: { model, prompt: req.prompt, image: { url: req.image, type: 'image_url' }, response_format: 'url', ...req.extra },
        };
      }
      return {
        method: 'POST',
        url: `${this.origin}/v1/images/generations`,
        body: { model, prompt: req.prompt, aspect_ratio: req.aspectRatio, response_format: 'url', ...req.extra },
      };
    }
    const body: Record<string, unknown> = { model, prompt: req.prompt, ...req.extra };
    if (req.durationSec) body.duration = Math.round(req.durationSec);
    if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
    if (req.image) body.image = { url: req.image };
    return { method: 'POST', url: `${this.origin}/v1/videos/generations`, body };
  },
  parseSubmit(json) {
    if (Array.isArray(json?.data)) {
      return { outputs: json.data.map((d: any) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : '')).filter(Boolean) };
    }
    if (!json?.request_id) throw new Error(json?.error?.message ?? json?.error ?? 'xAI: no request_id');
    return { jobId: json.request_id };
  },
  buildPoll(sub) {
    return { method: 'GET', url: `${this.origin}/v1/videos/${sub.jobId}` };
  },
  parsePoll(json) {
    if (json?.status === 'done') return { state: 'done', outputs: json.video?.url ? [json.video.url] : [] };
    if (json?.status === 'failed' || json?.status === 'expired') return { state: 'failed', error: json?.error?.message ?? json.status };
    return { state: 'pending', progress: typeof json?.progress === 'number' ? json.progress / 100 : undefined };
  },
};
