// Authors public/examples/sidestep.json by running scripts/sidestep-choreo.js inside the built app.
// Usage: npm run build && npx vite preview --port 4174 &  node scripts/author-sidestep.mjs [reviewDir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.URL ?? 'http://localhost:4174/';
const review = process.argv[2];
const choreo = fs.readFileSync(new URL('./sidestep-choreo.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.error('pageerror', e));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const info = await page.evaluate(`${choreo}; authorSidestep()`);
  console.log(info);
  const json = await page.evaluate(() => window.__studio.project().replace('"name": "test"', '"name": "閃身步 sidestep"'));
  const out = path.resolve('public/examples/sidestep.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // round numbers to keep the file small
  fs.writeFileSync(out, JSON.stringify(JSON.parse(json, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v))));
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
  if (review) {
    fs.rmSync(review, { recursive: true, force: true });
    fs.mkdirSync(review, { recursive: true });
    const times = (process.env.TIMES ?? '0,1.3,2.0,2.38,2.46,2.54,2.62,2.7,2.8,3.1,4.8,5.6').split(',').map(Number);
    await page.evaluate(() => window.__studio.load(window.__studio.project()));
    for (const t of times) {
      const d = await page.evaluate(([tt, close]) => {
        const s = window.__studio.studio; s.applyTime(tt);
        if (close) { const [px, py, pz, tx, ty, tz] = close.split(':').map(Number); s.camera.position.set(px, py, pz); s.orbit.target.set(tx, ty, tz); s.camera.fov = 40; s.camera.lookAt(s.orbit.target); s.camera.updateProjectionMatrix(); }
        return window.__studio.still('beauty', 960, 540);
      }, [t, process.env.CLOSE ?? '']);
      fs.writeFileSync(path.join(review, `t${t.toFixed(2)}.png`), Buffer.from(d.split(',')[1], 'base64'));
    }
    console.log('review frames in', review);
    // foot-contact metrics: horizontal slide per frame while a foot is on the floor
    const m = await page.evaluate(() => {
      const s = window.__studio.studio; const out = {};
      const figs = [...s.entries.values()].filter((e) => e.type === 'mannequin');
      const prev = {};
      for (let f = 0; f <= Math.round(s.timeline.duration * 24); f++) {
        s.applyTime(f / 24);
        for (const e of figs) for (const side of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) {
          const k = `${e.name}.${side}`; const p = e.bones.get(side).getWorldPosition(e.root.position.clone());
          const o = (out[k] ??= { maxSlide: 0, minY: 9, slideFrame: 0 });
          o.minY = Math.min(o.minY, +p.y.toFixed(3));
          const q = prev[k]; prev[k] = p;
          if (q && p.y < 0.1 && q.y < 0.1 && f / 24 < 4.0) { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d > o.maxSlide) { o.maxSlide = +d.toFixed(3); o.slideFrame = f; } }
        }
      }
      return out;
    });
    console.log(JSON.stringify(m));
  }
} finally {
  await browser.close();
}
