// Headless verification: renders the demo scene, exports stills/passes/video/zip and saves them.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/verify.mjs [outDir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'verify-out');
const url = process.env.URL ?? 'http://localhost:4173/';
fs.mkdirSync(out, { recursive: true });
const save = (name, dataUrl) => {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`saved ${name} ${buf.length} bytes`);
  return buf;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => { errors.push(`dialog: ${d.message()}`); d.dismiss(); });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.evaluate(() => window.__studio.studio.applyTime(1.5));
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(out, 'screenshot-ui.png') });
console.log('saved screenshot-ui.png');

// select the walker + pose mode to show bone handles
await page.evaluate(() => {
  const s = window.__studio.studio;
  const fig = [...s.entries.values()].find((e) => e.name === '配角');
  s.select({ entry: fig });
  document.querySelector('#poseMode').click();
  s.select({ entry: fig, bone: 'RightForeArm' });
});
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(out, 'screenshot-pose.png') });
await page.evaluate(() => { document.querySelector('#poseMode').click(); window.__studio.studio.select(null); });

await page.click('[data-tab="ai"]');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'screenshot-ai.png') });
await page.click('[data-tab="props"]');

for (const pass of ['beauty', 'depth', 'normal', 'edge']) {
  save(`still-${pass}.png`, await page.evaluate((p) => window.__studio.still(p, 1280, 720), pass));
}
save('still-transparent.png', await page.evaluate(() => window.__studio.still('beauty', 1280, 720, true)));
const sup = await page.evaluate(() => window.__studio.support());
console.log('video support', JSON.stringify(sup));
save('previs.webm', await page.evaluate(() => window.__studio.video('webm', 640, 360)));
if (sup.mp4) save('previs.mp4', await page.evaluate(() => window.__studio.video('mp4', 640, 360)));
save('sequence.zip', await page.evaluate(() => window.__studio.zip(['beauty', 'depth'], 320, 180)));

// project round-trip through the UI loader
const proj = await page.evaluate(() => { window.__studio.studio.applyTime(0); return window.__studio.project(); });
fs.writeFileSync(path.join(out, 'project.json'), proj);
const reloaded = await page.evaluate((p) => { window.__studio.load(p); return window.__studio.project(); }, proj);
const ok = reloaded === proj;
if (!ok) fs.writeFileSync(path.join(out, 'project-reloaded.json'), reloaded);
console.log('project round-trip identical:', ok);

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exitCode = 1;
