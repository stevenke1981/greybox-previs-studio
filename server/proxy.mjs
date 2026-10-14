#!/usr/bin/env node
// Tiny optional CORS proxy for Greybox Previs Studio. No dependencies (Node >= 18).
// Browser calls  http://localhost:8787/<provider>/<upstream-host>/<path>
// The proxy checks the host against an allow-list, injects the API key from env vars, and forwards.
// Keys never reach the browser. Run: `npm run proxy` (reads .env in the repo root if present).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const b64url = (b) => Buffer.from(b).toString('base64url');
function klingJwt(ak, sk) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 }))}`;
  return `${data}.${crypto.createHmac('sha256', sk).update(data).digest('base64url')}`;
}

/** provider id -> allowed upstream hosts + auth header factory */
export const PROVIDERS = {
  xai: { hosts: ['api.x.ai'], auth: () => ({ authorization: `Bearer ${process.env.XAI_API_KEY ?? ''}` }), key: 'XAI_API_KEY' },
  replicate: { hosts: ['api.replicate.com'], auth: () => ({ authorization: `Bearer ${process.env.REPLICATE_API_TOKEN ?? ''}` }), key: 'REPLICATE_API_TOKEN' },
  fal: { hosts: ['queue.fal.run'], auth: () => ({ authorization: `Key ${process.env.FAL_KEY ?? ''}` }), key: 'FAL_KEY' },
  runway: {
    hosts: ['api.dev.runwayml.com'],
    auth: () => ({ authorization: `Bearer ${process.env.RUNWAYML_API_SECRET ?? ''}`, 'x-runway-version': '2024-11-06' }),
    key: 'RUNWAYML_API_SECRET',
  },
  luma: { hosts: ['api.lumalabs.ai'], auth: () => ({ authorization: `Bearer ${process.env.LUMAAI_API_KEY ?? ''}` }), key: 'LUMAAI_API_KEY' },
  kling: {
    hosts: ['api-singapore.klingai.com', 'api.klingai.com'],
    auth: () => {
      const { KLING_ACCESS_KEY: ak, KLING_SECRET_KEY: sk, KLING_API_KEY: k } = process.env;
      return { authorization: `Bearer ${ak && sk ? klingJwt(ak, sk) : (k ?? '')}` };
    },
    key: 'KLING_API_KEY or KLING_ACCESS_KEY+KLING_SECRET_KEY',
  },
};

const allowed = (process.env.PROXY_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type,accept');
    res.setHeader('access-control-max-age', '600');
  }
}

export function route(urlPath) {
  const [, provider, host, ...rest] = urlPath.split('/');
  const p = PROVIDERS[provider];
  if (!p || !p.hosts.includes(host)) return null;
  return { provider, p, target: `https://${host}/${rest.join('/')}` };
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.auth().authorization.trim().includes(' ')]))));
  }
  const r = route(new URL(req.url, 'http://x').pathname);
  if (!r || !['GET', 'POST'].includes(req.method)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'host or provider not allowed' }));
  }
  const search = new URL(req.url, 'http://x').search;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const upstream = await fetch(r.target + search, {
      method: req.method,
      headers: { accept: 'application/json', ...(chunks.length ? { 'content-type': 'application/json' } : {}), ...r.p.auth() },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PROXY_PORT ?? 8787);
  server.listen(port, '127.0.0.1', () => console.log(`greybox proxy on http://127.0.0.1:${port} (origins: ${allowed.join(', ')})`));
}
