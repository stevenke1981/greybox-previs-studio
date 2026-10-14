// Renders the sidestep example to video files + contact sheet (headless Chromium, deterministic frames).
// Usage: npm run build && npx vite preview --port 4174 &  node scripts/export-sidestep.mjs /workspace/greybox-samples
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'sidestep-out');
const only = (process.env.ONLY ?? 'contact,mp4,webm,depth,edge').split(',');
const url = (process.env.URL ?? 'http://localhost:4174/') + '?example=sidestep';
fs.mkdirSync(out, { recursive: true });
const save = (name, d) => { const b = Buffer.from(d.split(',')[1], 'base64'); fs.writeFileSync(path.join(out, name), b); console.log(new Date().toLocaleTimeString(), name, b.length); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.error('pageerror', e));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  console.log('duration', await page.evaluate(() => window.__studio.studio.timeline.duration));
  if (only.includes('contact')) {
    const times = [0.5, 1.9, 2.3, 2.42, 2.52, 2.66, 3.3, 5.2];
    for (const [i, t] of times.entries()) {
      save(`sidestep-contact-${i}.png`, await page.evaluate((tt) => { window.__studio.studio.applyTime(tt); return window.__studio.still('beauty', 640, 360); }, t));
    }
    fs.writeFileSync(path.join(out, 'sidestep-contact-times.json'), JSON.stringify(times));
  }
  if (only.includes('mp4')) save('sidestep-demo.mp4', await page.evaluate(() => window.__studio.video('mp4', 1280, 720, 'beauty')));
  if (only.includes('webm')) save('sidestep-demo.webm', await page.evaluate(() => window.__studio.video('webm', 1280, 720, 'beauty')));
  if (only.includes('depth')) save('sidestep-depth.mp4', await page.evaluate(() => window.__studio.video('mp4', 1280, 720, 'depth')));
  if (only.includes('edge')) save('sidestep-edge.mp4', await page.evaluate(() => window.__studio.video('mp4', 1280, 720, 'edge')));
} finally {
  await browser.close();
}
