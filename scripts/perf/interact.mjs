// Rail jumps, scrolling, typing in the journal box and the search: how long each takes, the long tasks and where the
// time went. `node scripts/perf/interact.mjs [part of a step's name]`, with `npm run dev` and the demo.
import { launch, ready } from './cdp.mjs';
const b = await launch(new URL('./.profile', import.meta.url).pathname);
await ready(b);
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(Math.round(e.duration))}).observe({type:'longtask'});` });
const settle = `new Promise((res) => { const t0 = performance.now(); let last = t0; const o = new MutationObserver(() => { last = performance.now(); }); o.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); const tick = () => performance.now() - last > 400 ? (o.disconnect(), res(Math.round(last - t0))) : setTimeout(tick, 50); setTimeout(tick, 50); })`;
const go = (url) => b.evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(url)}); dispatchEvent(new PopStateEvent('popstate')); return ${settle}; })()`);
const lt = async () => { const v = await b.evaluate('window.__lt.splice(0)'); return v.length ? `long tasks ${v.length}, max ${Math.max(...v)}ms, sum ${v.reduce((a, c) => a + c, 0)}ms` : 'no long tasks'; };
const dom = () => b.evaluate('document.getElementsByTagName("*").length');
const mouse = async (type, x, y) => b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
const frame = () => b.evaluate('new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))');
const only = process.argv[2];
const step = async (name, fn) => {
  if (only && !name.includes(only)) return;
  await b.evaluate('window.__lt.splice(0)');
  const { out, summary } = await b.profile(fn);
  console.log(`\n== ${name}: ${out} | ${await lt()} | dom ${await dom()}`);
  console.log(' self:\n  ' + summary.self.slice(0, 7).join('\n  '));
  console.log(' app:\n  ' + summary.app.slice(0, 10).join('\n  '));
};
await b.send('Page.navigate', { url: 'http://localhost:5191/journal' });
await new Promise(r => setTimeout(r, 500));
await b.until(`document.querySelector('.bubble')`);
await b.evaluate(settle);
const railAt = async (f) => { const r = await b.evaluate(`(() => { const r = document.querySelector('.scroll-rail').getBoundingClientRect(); return [r.left + r.width / 2, r.top, r.height]; })()`); return [r[0], r[1] + Math.max(2, Math.min(r[2] - 2, r[2] * f))]; };
for (const f of [0, 0.5, 1]) await step(`journal rail jump to ${f}`, async () => { const [x, y] = await railAt(f); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); return `settled ${await b.evaluate(settle)}ms`; });
await step('journal wheel up x40', async () => { await go('/journal'); const t0 = Date.now(); for (let i = 0; i < 40; i++) { await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 400, deltaX: 0, deltaY: -900 }); await frame(); } return `${Date.now() - t0}ms for 40 wheels`; });
const type = async (text) => { const per = []; for (const ch of text) { const t0 = performance.now(); await b.send('Input.insertText', { text: ch }); await frame(); per.push(performance.now() - t0); } per.sort((a, c) => a - c); return `per key median ${per[per.length >> 1].toFixed(0)}ms max ${per[per.length - 1].toFixed(0)}ms`; };
await step('journal composer typing', async () => { await go('/journal'); await b.evaluate(`document.querySelector('.journal-dock [contenteditable]')?.focus()`); const r = await type('perf test typing here'); await b.evaluate(`(() => { const e = document.querySelector('.journal-dock [contenteditable]'); e.focus(); document.execCommand('selectAll'); document.execCommand('delete'); })()`); return r; });
await step('search typing', async () => { await go('/search'); await b.evaluate(`document.querySelector('input[type=search], .search input, input')?.focus()`); return type('coffee beans'); });
await step('baseline frame', async () => { const t0 = performance.now(); for (let i = 0; i < 10; i++) await frame(); return `${((performance.now() - t0) / 10).toFixed(0)}ms per frame roundtrip`; });
console.log('errors', b.errors.slice(0, 5));
b.close();
