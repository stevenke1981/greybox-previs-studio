import type { ProviderAdapter } from './types';

/**
 * Runway API (Gen-4). Base https://api.dev.runwayml.com, header X-Runway-Version: 2024-11-06.
 * image->video: POST /v1/image_to_video {model, promptImage, promptText, ratio, duration}
 * video->video: POST /v1/video_to_video {model: gen4_aleph, videoUri, promptText}
 * Poll GET /v1/tasks/{id}. Docs: https://docs.dev.runwayml.com/api/
 */
export const runway: ProviderAdapter = {
  id: 'runway',
  label: 'Runway (Gen-4)',
  status: 'implemented',
  modes: ['video'],
  docs: 'https://docs.dev.runwayml.com/api/',
  origin: 'https://api.dev.runwayml.com',
  defaultModel: { image: '', video: 'gen4_turbo' },
  notes: 'With a reference video the adapter uses video_to_video (gen4_aleph); otherwise image_to_video. Data URIs have size limits (use a hosted URL for large videos).',
  async authHeaders(c) {
    return { Authorization: `Bearer ${c.apiKey ?? ''}`, 'X-Runway-Version': '2024-11-06' };
  },
  buildSubmit(req) {
    const ratio = (req.extra?.ratio as string) ?? '1280:720';
    if (req.video) {
      return {
        method: 'POST',
        url: `${this.origin}/v1/video_to_video`,
        body: { model: req.model && req.model !== 'gen4_turbo' ? req.model : 'gen4_aleph', videoUri: req.video, promptText: req.prompt, ratio, ...req.extra },
      };
    }
    if (!req.image) throw new Error('Runway needs an input image or video');
    const body: Record<string, unknown> = {
      model: req.model || this.defaultModel.video,
      promptImage: req.image,
      promptText: req.prompt,
      ratio,
      ...req.extra,
    };
    if (req.durationSec) body.duration = req.durationSec >= 8 ? 10 : 5;
    return { method: 'POST', url: `${this.origin}/v1/image_to_video`, body };
  },
  parseSubmit(json) {
    if (!json?.id) throw new Error(json?.error ?? 'Runway: no task id');
    return { jobId: json.id };
  },
  buildPoll(sub) {
    return { method: 'GET', url: `${this.origin}/v1/tasks/${sub.jobId}` };
  },
  parsePoll(json) {
    if (json?.status === 'SUCCEEDED') return { state: 'done', outputs: json.output ?? [] };
    if (json?.status === 'FAILED' || json?.status === 'CANCELLED') return { state: 'failed', error: json.failure ?? json.status };
    return { state: 'pending', progress: json?.progress };
  },
};
