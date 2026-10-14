import { fal } from './fal';
import { kling } from './kling';
import { luma } from './luma';
import { replicate } from './replicate';
import { runway } from './runway';
import { xai } from './xai';
import type { ProviderAdapter } from './types';

export const PROVIDERS: ProviderAdapter[] = [xai, replicate, fal, runway, luma, kling];
export function getProvider(id: string): ProviderAdapter {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider ${id}`);
  return p;
}
export * from './types';
export { runJob } from './runner';
