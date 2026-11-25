// A first sign-in from an empty browser: how long until the whole demo has synced, and where the time went.
// `node scripts/perf/first-sync.mjs`, with `npm run dev` and the demo.
import { rmSync } from 'node:fs';
import { launch } from './cdp.mjs';
const dir = new URL('./.profile-cold', import.meta.url).pathname;
rmSync(dir, { recursive: true, force: true });
const b = await launch(dir, 9334);
await b.send('Network.enable');
const reqs = new Map(); const done = [];

const pulls = [];
const started = new Map();
const count = `(() => { const m = /Journal\\s*([\\d,]+)/.exec(document.querySelector('h1')?.parentElement?.innerText ?? ''); return m ? +m[1].replace(/,/g, '') : 0; })()`;
b.onEvent?.(() => {});
const { out, summary } = await b.profile(async () => {
  const t0 = Date.now();
  await b.send('Page.navigate', { url: 'http://localhost:5191/demo' });
  await new Promise(r => setTimeout(r, 1000));
  await b.until(`${count} >= 8990`, 180000);
  return Date.now() - t0;
}, 1000);
console.log('cold sync', out, 'ms; profiled', summary.ms, 'idle', summary.idle, 'program', summary.program, 'gc', summary.gc);
console.log('pulls', await b.evaluate(`(() => { const p = performance.getEntriesByType('resource').filter(e => e.name.includes('/sync/pull')); return { n: p.length, total: Math.round(p.reduce((a, e) => a + e.duration, 0)), max: Math.round(Math.max(...p.map(e => e.duration))), first: Math.round(p[0]?.startTime), last: Math.round(p.at(-1)?.responseEnd), bytes: p.reduce((a, e) => a + e.transferSize, 0) }; })()`));
console.log(' self:\n  ' + summary.self.slice(0, 14).join('\n  '));
console.log(' app:\n  ' + summary.app.slice(0, 16).join('\n  '));
b.close();
