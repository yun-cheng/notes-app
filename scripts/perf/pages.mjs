// Opens the journal, then each page in turn, with a CPU profile of each: how long until it stops changing, its elements
// and where the time went. `node scripts/perf/pages.mjs [part of a page's name]`, with `npm run dev` and the demo.
import { launch, ready } from './cdp.mjs';
const b = await launch(new URL('./.profile', import.meta.url).pathname);
await ready(b);
const only = process.argv[2];
// Resolves when the page has been still for 500ms; gives when it last changed, from now.
const settle = `new Promise((res) => { const t0 = performance.now(); let last = t0; const o = new MutationObserver(() => { last = performance.now(); }); o.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); const tick = () => performance.now() - last > 500 ? (o.disconnect(), res(Math.round(last - t0))) : setTimeout(tick, 50); setTimeout(tick, 50); })`;
const go = (url) => `(() => { history.pushState({}, '', ${JSON.stringify(url)}); dispatchEvent(new PopStateEvent('popstate')); return ${settle}; })()`;
const steps = [
  ['reload journal', async () => { await b.send('Page.navigate', { url: 'http://localhost:5191/journal' }); await new Promise(r => setTimeout(r, 300)); await b.until(`document.querySelector('.bubble')`); return b.evaluate(settle); }],
  ...['/photos', '/calendar', '/timeline', '/links', '/files', '/tags', '/trash', '/history', '/archive', '/vaults', '/journal?tag=demo-tag-home', '/search?q=coffee', '/journal/demo-gen-05000', '/journal'].map((u) => [u, () => b.evaluate(go(u))]),
];
for (const [name, fn] of steps) {
  if (only && !name.includes(only)) continue;
  const { out, wall, summary } = await b.profile(fn);
  console.log(`\n== ${name}: settled after ${out}ms (wall ${wall}ms, cpu ${summary.ms}ms) heap ${await b.evaluate('Math.round(performance.memory.usedJSHeapSize/1e6)')}MB dom ${await b.evaluate('document.getElementsByTagName("*").length')}`);
  console.log(' self:\n  ' + summary.self.slice(0, 8).join('\n  '));
  console.log(' app (inclusive):\n  ' + summary.app.slice(0, 12).join('\n  '));
}
console.log('errors', b.errors.slice(0, 5));
b.close();
