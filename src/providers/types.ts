export type GenMode = 'image' | 'video';

/** What the studio hands to a provider. Media are data URLs (from the exporter) or public URLs. */
export interface GenRequest {
  mode: GenMode;
  prompt: string;
  negativePrompt?: string;
  /** still / guidance image: data URL or https URL */
  image?: string;
  /** reference video (WebM/MP4): data URL or https URL */
  video?: string;
  /** 0..1 how far the result may drift from the greybox input (mapped where the API supports it) */
  strength?: number;
  durationSec?: number;
  aspectRatio?: string;
  /** provider-specific model id / version */
  model?: string;
  /** extra JSON merged into the provider input body */
  extra?: Record<string, unknown>;
}

export interface Credentials {
  apiKey?: string;
  /** Kling legacy key pair */
  accessKey?: string;
  secretKey?: string;
}

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface SubmitResult {
  /** provider job id, if the job is asynchronous */
  jobId?: string;
  /** URL to poll (some providers return it) */
  pollUrl?: string;
  /** where the final result is fetched once polling says done (fal) */
  resultUrl?: string;
  /** synchronous providers return outputs directly */
  outputs?: string[];
}

export interface PollResult {
  state: 'pending' | 'done' | 'failed';
  progress?: number;
  outputs?: string[];
  error?: string;
  /** done, but outputs must be fetched from this request first */
  fetchResult?: HttpRequest;
}

export type AdapterStatus = 'implemented' | 'stub';

export interface ProviderAdapter {
  id: string;
  label: string;
  status: AdapterStatus;
  modes: GenMode[];
  docs: string;
  /** upstream origin, used by the proxy allow-list */
  origin: string;
  defaultModel: Record<GenMode, string>;
  notes: string;
  needsKeyPair?: boolean;
  authHeaders(creds: Credentials): Promise<Record<string, string>>;
  buildSubmit(req: GenRequest): HttpRequest;
  parseSubmit(json: any): SubmitResult;
  buildPoll(sub: SubmitResult): HttpRequest;
  parsePoll(json: any): PollResult;
  /** only for providers where PollResult.fetchResult is used */
  parseResult?(json: any): string[];
}

export function stripDataUrl(s: string): string {
  const i = s.indexOf('base64,');
  return s.startsWith('data:') && i >= 0 ? s.slice(i + 7) : s;
}

/** Collect every http(s)/data URL found in an arbitrary JSON output. */
export function collectUrls(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') {
    if (/^(https?:|data:)/.test(x)) out.push(x);
  } else if (Array.isArray(x)) x.forEach((v) => collectUrls(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => collectUrls(v, out));
  return out;
}
