import { collectUrls, type ProviderAdapter } from './types';

/**
 * fal.ai queue API (generic). POST https://queue.fal.run/{model_id} -> {request_id,status_url,response_url}
 * Poll status_url until COMPLETED, then GET response_url. Docs: https://docs.fal.ai/model-apis/model-endpoints/queue
 */
export const fal: ProviderAdapter = {
  id: 'fal',
  label: 'fal.ai',
  status: 'implemented',
  modes: ['image', 'video'],
  docs: 'https://docs.fal.ai/model-apis/model-endpoints/queue',
  origin: 'https://queue.fal.run',
  defaultModel: { image: 'fal-ai/flux-general/image-to-image', video: 'fal-ai/kling-video/v2.1/standard/image-to-video' },
  notes: 'Defaults: prompt, image_url, video_url, strength. Each model has its own schema; use extra JSON to adapt.',
  async authHeaders(c) {
    return { Authorization: `Key ${c.apiKey ?? ''}` };
  },
  buildSubmit(req) {
    const model = req.model || this.defaultModel[req.mode];
    const body: Record<string, unknown> = { prompt: req.prompt };
    if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
    if (req.image) body.image_url = req.image;
    if (req.video) body.video_url = req.video;
    if (req.strength !== undefined) body.strength = req.strength;
    if (req.durationSec && req.mode === 'video') body.duration = String(Math.round(req.durationSec));
    if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
    for (const [k, v] of Object.entries(req.extra ?? {})) body[k] = v === '$image' ? req.image : v === '$video' ? req.video : v;
    return { method: 'POST', url: `${this.origin}/${model}`, body };
  },
  parseSubmit(json) {
    if (!json?.request_id) throw new Error(json?.detail ?? 'fal: no request_id');
    return { jobId: json.request_id, pollUrl: json.status_url, resultUrl: json.response_url };
  },
  buildPoll(sub) {
    return { method: 'GET', url: sub.pollUrl! };
  },
  parsePoll(json) {
    if (json?.status === 'COMPLETED') {
      if (json.error) return { state: 'failed', error: String(json.error) };
      const resultUrl = typeof json.response_url === 'string' ? json.response_url : undefined;
      return { state: 'done', fetchResult: resultUrl ? { method: 'GET', url: resultUrl } : undefined };
    }
    if (json?.status === 'FAILED' || json?.status === 'ERROR') return { state: 'failed', error: String(json.error ?? json.status) };
    return { state: 'pending' };
  },
  parseResult(json) {
    return collectUrls(json?.video ?? json?.images ?? json?.image ?? json);
  },
};
