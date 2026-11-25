// Photos in a browser that has never seen them: whether any tile moves as its picture loads.
// `node scripts/perf/photo-shift.mjs`, with `npm run dev` and the demo.
import { rmSync } from 'node:fs';
import { launch } from './cdp.mjs';
const dir = new URL('./.profile-shift', import.meta.url).pathname;
rmSync(dir, { recursive: true, force: true });
const b = await launch(dir, 9335);
const count = `(() => { const m = /Journal\\s*([\\d,]+)/.exec(document.querySelector('h1')?.parentElement?.innerText ?? ''); return m ? +m[1].replace(/,/g, '') : 0; })()`;
await b.send('Page.navigate', { url: 'http://localhost:5191/demo' });
await new Promise(r => setTimeout(r, 1000));
await b.until(`${count} >= 8990`, 180000);
// Photos never seen on this device: nothing learned, so only the entries can say their shapes.
console.log('shapes known before', await b.evaluate(`Object.keys(JSON.parse(localStorage.getItem('notes-app:photo-shapes') ?? '{}')).length`));
await b.evaluate(`(() => { history.pushState({}, '', '/photos'); dispatchEvent(new PopStateEvent('popstate')); })()`);
await b.until(`document.querySelector('.photo-tile')`);
const boxes = `[...document.querySelectorAll('.photo-tile')].slice(0, 40).map(t => { const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height), !!t.querySelector('img')]; })`;
const first = await b.evaluate(boxes);
console.log('loaded at first', first.filter(x => x[4]).length, 'of', first.length);
await new Promise(r => setTimeout(r, 4000));
const later = await b.evaluate(boxes);
console.log('loaded later', later.filter(x => x[4]).length);
const moved = first.filter((x, i) => later[i] && x.slice(0, 4).some((v, k) => Math.abs(v - later[i][k]) > 1));
console.log('tiles moved', moved.length, moved.slice(0, 3), later.slice(0, 3));
b.close();
