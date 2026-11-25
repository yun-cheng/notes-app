// Ticks a todo six times: from the click to the bubble showing it, in milliseconds.
// `node scripts/perf/edit.mjs`, with `npm run dev` and the demo.
import { launch, ready } from './cdp.mjs';
const b = await launch(new URL('./.profile', import.meta.url).pathname);
await ready(b);
await b.send('Page.navigate', { url: 'http://localhost:5191/journal' });
await new Promise(r => setTimeout(r, 500)); await b.until(`document.querySelector('.bubble')`); await new Promise(r => setTimeout(r, 7000));
await b.evaluate(`(() => { const all = [...document.querySelectorAll('.bubble--todo .check')].filter(e => !e.querySelector('input').disabled); all.at(-1).scrollIntoView({ block: 'center' }); window.__box = all.at(-1); })()`);
await new Promise(r => setTimeout(r, 800));
const times = [];
for (let i = 0; i < 6; i++) {
  const [x, y] = await b.evaluate(`(() => { const r = window.__box.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await b.evaluate(`(() => { const bubble = window.__box.closest('.bubble'); window.__was = bubble.classList.contains('is-done'); addEventListener('pointerdown', (e) => { window.__t0 = e.timeStamp; }, { capture: true, once: true }); window.__seen = new Promise(res => { const o = new MutationObserver(() => { if (bubble.classList.contains('is-done') !== window.__was) { o.disconnect(); requestAnimationFrame(() => res(Math.round(performance.now() - window.__t0))); } }); o.observe(bubble, { attributes: true }); }); })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  times.push(await b.evaluate('window.__seen'));
  await new Promise(r => setTimeout(r, 700));
}
console.log('click to shown, ms:', times.join(', '));
b.close();
