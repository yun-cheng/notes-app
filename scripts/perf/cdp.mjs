// A small driver for a headless Chromium over the DevTools protocol, for the measurements in PERFORMANCE.md: launches the
// Chromium Playwright keeps in ~/Library/Caches/ms-playwright (`npx playwright install chromium-headless-shell` if it's missing),
// and sums CPU profiles by function.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const BIN = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
export async function launch(dir, port = 9333) {
  mkdirSync(dir, { recursive: true });
  const proc = spawn(BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1280,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    else for (const l of listeners) l(msg);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Profiler.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const errors = [];
  listeners.push((m) => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200)); });
  /** Waits in the page until `cond` (an expression) is truthy; returns ms taken. */
  const until = (cond, timeout = 60000) => evaluate(`(async () => { const t0 = performance.now(); while (!(${cond})) { if (performance.now() - t0 > ${timeout}) return -1; await new Promise(r => setTimeout(r, 20)); } return Math.round(performance.now() - t0); })()`);
  async function profile(fn, interval = 250) {
    await send('Profiler.setSamplingInterval', { interval });
    await send('Profiler.start');
    const t0 = Date.now();
    const out = await fn();
    const { profile } = await send('Profiler.stop');
    return { out, wall: Date.now() - t0, summary: summarize(profile) };
  }
  return { send, evaluate, until, profile, errors, close: () => { ws.close(); proc.kill(); } };
}
const short = (url) => url.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '');
export function summarize(p) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const dt = new Map();
  for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0));
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${short(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;
  const self = new Map(), total = new Map();
  let all = 0;
  for (const [nid, t] of dt) {
    const n = byId.get(nid); all += t;
    self.set(key(n), (self.get(key(n)) ?? 0) + t);
    const seen = new Set();
    for (let cur = nid; cur !== undefined; cur = parent.get(cur)) { const k = key(byId.get(cur)); if (seen.has(k)) continue; seen.add(k); total.set(k, (total.get(k) ?? 0) + t); }
  }
  const top = (m, filter = () => true, n = 14) => [...m].filter(([k]) => filter(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${(t / 1000).toFixed(0).padStart(6)}ms ${k}`);
  const get = (k) => Math.round([...self].filter(([x]) => x.startsWith(k)).reduce((a, [, t]) => a + t, 0) / 1000);
  return { ms: Math.round(all / 1000), idle: get('(idle)'), program: get('(program)'), gc: get('(garbage'), self: top(self, (k) => !k.startsWith('(idle)') && !k.startsWith('(program)')), app: top(total, (k) => k.includes('src/'), 18), dexie: top(total, (k) => k.includes('dexie'), 6) };
}

/** The journal's count, as its title shows it. */
export const journalCount = `(() => { const m = /Journal\\s*([\\d,]+)/.exec(document.querySelector('h1')?.parentElement?.innerText ?? ''); return m ? +m[1].replace(/,/g, '') : 0; })()`;

/** Signs the browser in as the demo account (the dev server's /demo) if it isn't, and waits for the journal to sync. */
export async function ready(b, base = 'http://localhost:5191') {
  await b.send('Page.navigate', { url: `${base}/journal` });
  await new Promise((r) => setTimeout(r, 1500));
  if (!(await b.evaluate(journalCount))) {
    await b.send('Page.navigate', { url: `${base}/demo` });
    await new Promise((r) => setTimeout(r, 1500));
  }
  if ((await b.until(`${journalCount} >= 8990`, 180000)) < 0) throw new Error('The journal never showed the demo: is `npm run dev` running and `npm run demo` done?');
}
