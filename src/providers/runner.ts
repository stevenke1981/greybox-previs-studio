import type { Credentials, GenRequest, HttpRequest, ProviderAdapter } from './types';

export interface RunOptions {
  creds: Credentials;
  /** when set, requests go to `${proxyBase}/${provider.id}${path}` and the proxy injects the key */
  proxyBase?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStatus?: (msg: string, progress?: number) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Rewrite an upstream URL to go through the local proxy. */
export function proxify(provider: ProviderAdapter, url: string, proxyBase: string): string {
  const u = new URL(url);
  return `${proxyBase.replace(/\/$/, '')}/${provider.id}/${u.host}${u.pathname}${u.search}`;
}

async function send(p: ProviderAdapter, r: HttpRequest, o: RunOptions): Promise<any> {
  const f = o.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json', ...(r.headers ?? {}) };
  let url = r.url;
  if (o.proxyBase) url = proxify(p, r.url, o.proxyBase);
  else Object.assign(headers, await p.authHeaders(o.creds));
  if (r.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await f(url, {
    method: r.method,
    headers,
    body: r.body !== undefined ? JSON.stringify(r.body) : undefined,
    signal: o.signal,
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok && res.status !== 202) {
    const msg = json?.error?.message ?? json?.error ?? json?.detail ?? json?.message ?? text.slice(0, 300);
    throw new Error(`${p.label} HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return json;
}

/** Submit -> poll -> outputs (URLs). Pure orchestration; network is injectable for tests. */
export async function runJob(p: ProviderAdapter, req: GenRequest, o: RunOptions): Promise<string[]> {
  if (p.status === 'stub') throw new Error(`${p.label} adapter is a stub`);
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const interval = o.pollIntervalMs ?? 5000;
  const deadline = Date.now() + (o.timeoutMs ?? 15 * 60_000);
  o.onStatus?.('submitting');
  const sub = p.parseSubmit(await send(p, p.buildSubmit(req), o));
  if (sub.outputs) return sub.outputs;
  o.onStatus?.(`queued ${sub.jobId ?? ''}`);
  for (;;) {
    if (o.signal?.aborted) throw new Error('cancelled');
    if (Date.now() > deadline) throw new Error('timed out');
    await sleep(interval);
    const pr = p.parsePoll(await send(p, p.buildPoll(sub), o));
    if (pr.state === 'failed') throw new Error(pr.error ?? 'generation failed');
    if (pr.state === 'done') {
      if (pr.fetchResult || (sub.resultUrl && p.parseResult)) {
        const r = pr.fetchResult ?? { method: 'GET' as const, url: sub.resultUrl! };
        return p.parseResult!(await send(p, r, o));
      }
      return pr.outputs ?? [];
    }
    o.onStatus?.('running', pr.progress);
  }
}
