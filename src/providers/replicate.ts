import { collectUrls, type ProviderAdapter } from './types';

/**
 * Replicate (generic). Model is either "owner/name" (official models endpoint) or a version hash.
 * POST /v1/predictions {version,input} | POST /v1/models/{owner}/{name}/predictions {input}
 * Poll GET /v1/predictions/{id}. Docs: https://replicate.com/docs/reference/http
 */
export const replicate: ProviderAdapter = {
  id: 'replicate',
  label: 'Replicate',
  status: 'implemented',
  modes: ['image', 'video'],
  docs: 'https://replicate.com/docs/reference/http',
  origin: 'https://api.replicate.com',
  defaultModel: { image: 'black-forest-labs/flux-depth-pro', video: 'wan-video/wan-2.2-i2v-fast' },
  notes: 'Input keys differ per model. Defaults: prompt, image (data URL), strength. Use "extra JSON" to rename/add fields (e.g. {"control_image": "$image"}).',
  async authHeaders(c) {
    return { Authorization: `Bearer ${c.apiKey ?? ''}` };
  },
  buildSubmit(req) {
    const model = req.model || this.defaultModel[req.mode];
    const input: Record<string, unknown> = { prompt: req.prompt };
    if (req.negativePrompt) input.negative_prompt = req.negativePrompt;
    if (req.image) input.image = req.image;
    if (req.video) input.video = req.video;
    if (req.strength !== undefined) input.strength = req.strength;
    for (const [k, v] of Object.entries(req.extra ?? {})) {
      input[k] = v === '$image' ? req.image : v === '$video' ? req.video : v;
    }
    if (/^[\w.-]+\/[\w.-]+$/.test(model)) {
      return { method: 'POST', url: `${this.origin}/v1/models/${model}/predictions`, body: { input } };
    }
    const version = model.includes(':') ? model.split(':')[1] : model;
    return { method: 'POST', url: `${this.origin}/v1/predictions`, body: { version, input } };
  },
  parseSubmit(json) {
    if (!json?.id) throw new Error(json?.detail ?? 'Replicate: no prediction id');
    return { jobId: json.id, pollUrl: json.urls?.get };
  },
  buildPoll(sub) {
    return { method: 'GET', url: sub.pollUrl ?? `${this.origin}/v1/predictions/${sub.jobId}` };
  },
  parsePoll(json) {
    if (json?.status === 'succeeded') return { state: 'done', outputs: collectUrls(json.output) };
    if (json?.status === 'failed' || json?.status === 'canceled') return { state: 'failed', error: String(json.error ?? json.status) };
    return { state: 'pending' };
  },
};
