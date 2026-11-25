// The production build, served by `npx vite preview --port 5192` after `npm run build`: a first sync (or `--warm`, a
// launch with the cards already there) and six ticks of a todo, as edit.mjs does on the dev server.
import { rmSync } from 'node:fs';
import { launch } from './cdp.mjs';
const dir = new URL('./.profile-prod', import.meta.url).pathname;
const fresh = !process.argv.includes('--warm');
if (fresh) rmSync(dir, { recursive: true, force: true });
const b = await launch(dir, 9336);
await b.send('Network.enable');
await b.send('Network.setCookie', { name: 'session', value: 'demo-local-session', domain: 'localhost', path: '/api', httpOnly: true, sameSite: 'Strict' });
const count = `(() => { const m = /Journal\\s*([\\d,]+)/.exec(document.querySelector('h1')?.parentElement?.innerText ?? ''); return m ? +m[1].replace(/,/g, '') : 0; })()`;
const t0 = Date.now();
await b.send('Page.navigate', { url: 'http://localhost:5192/journal' });
await new Promise(r => setTimeout(r, 1500));
await b.evaluate(`[...document.querySelectorAll('button')].find(x => x.innerText.includes('Continue as Demo'))?.click()`);
await new Promise(r => setTimeout(r, 300));
const ok = await b.until(`${count} >= 8990`, 120000);
console.log(fresh ? 'first sync' : 'reload', ok < 0 ? 'TIMED OUT' : `${Date.now() - t0} ms`, 'count', await b.evaluate(count));
await new Promise(r => setTimeout(r, 6000));
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
console.log('production: click to shown, ms:', times.join(', '));
console.log('errors', b.errors.slice(0, 3));
b.close();
