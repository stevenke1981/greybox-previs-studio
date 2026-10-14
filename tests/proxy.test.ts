import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { route, PROVIDERS } from '../server/proxy.mjs';

describe('proxy routing', () => {
  it('only forwards to allow-listed hosts for each provider', () => {
    expect(route('/xai/api.x.ai/v1/videos/generations').target).toBe('https://api.x.ai/v1/videos/generations');
    expect(route('/xai/evil.example.com/steal')).toBeNull();
    expect(route('/fal/api.x.ai/v1')).toBeNull();
    expect(route('/nope/api.x.ai/v1')).toBeNull();
    expect(Object.keys(PROVIDERS).sort()).toEqual(['fal', 'kling', 'luma', 'replicate', 'runway', 'xai']);
  });
  it('injects the key from env', () => {
    process.env.FAL_KEY = 'fk';
    expect(PROVIDERS.fal.auth()).toEqual({ authorization: 'Key fk' });
    process.env.KLING_ACCESS_KEY = 'a'; process.env.KLING_SECRET_KEY = 's';
    expect(PROVIDERS.kling.auth().authorization).toMatch(/^Bearer ey/);
  });
});
