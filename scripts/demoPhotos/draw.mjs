/**
 * Draws the demo's photos (scripts/demoPhotos/*.jpg) as SVG scenes in shapes a camera or phone gives: 3:4 and 4:3,
 * 3:1 panorama, square, 9:16, 16:9, 3:2 and 4:5. Run `node scripts/demoPhotos/draw.mjs` from the repo root; on a
 * Mac it turns them into JPEGs with sips, elsewhere it leaves the SVGs to convert.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const g = (id, stops, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const svg = (w, h, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const scenes = {};

// Torii gates down a path, portrait 900x1200.
{
  const [w, h] = [900, 1200];
  let gates = '';
  for (let i = 0; i < 9; i++) {
    const s = 1 - i * 0.1; const cx = 450; const top = 120 + i * 55; const gw = 760 * s; const gh = 1000 * s;
    const x0 = cx - gw / 2; const post = 46 * s;
    gates += `<g fill="${i % 2 ? '#d2401f' : '#e4512a'}" opacity="${1 - i * 0.07}"><rect x="${x0}" y="${top}" width="${gw}" height="${50 * s}"/><rect x="${x0 + 30 * s}" y="${top + 90 * s}" width="${gw - 60 * s}" height="${30 * s}"/><rect x="${x0 + 60 * s}" y="${top}" width="${post}" height="${gh}"/><rect x="${x0 + gw - 60 * s - post}" y="${top}" width="${post}" height="${gh}"/></g>`;
  }
  scenes.torii = svg(w, h, g('sky', [[0, '#fbe3c4'], [1, '#f2b880']]) + g('path', [[0, '#7c6a58'], [1, '#3e342b']]),
    `<rect width="${w}" height="${h}" fill="url(#sky)"/><rect y="700" width="${w}" height="500" fill="#2f4a2c"/><path d="M380 700 L520 700 L760 1200 L140 1200Z" fill="url(#path)"/>${gates.split('</g>').filter(Boolean).reverse().join('</g>')}</g>`);
}
// Sunset over the sea, 1200x900.
scenes['coast-sunset'] = svg(1200, 900, g('s', [[0, '#3b2a5c'], [0.55, '#f08a5d'], [1, '#ffd27a']]) + g('sea', [[0, '#f0a066'], [1, '#2a3d66']]),
  `<rect width="1200" height="560" fill="url(#s)"/><circle cx="820" cy="560" r="110" fill="#ffe3a3"/><rect y="560" width="1200" height="340" fill="url(#sea)"/>${Array.from({ length: 14 }, (_, i) => `<rect x="${760 - i * 6}" y="${580 + i * 22}" width="${120 + i * 12}" height="5" fill="#ffe3a3" opacity="${0.8 - i * 0.05}"/>`).join('')}<path d="M0 700 Q200 640 420 720 L420 900 L0 900Z" fill="#1d1a2e"/>`);
// Beach panorama, 1800x600.
scenes['coast-panorama'] = svg(1800, 600, g('s', [[0, '#7fc4e8'], [1, '#d8eef7']]) + g('sea', [[0, '#2e8bb5'], [1, '#6cc3d5']]),
  `<rect width="1800" height="300" fill="url(#s)"/><rect y="300" width="1800" height="120" fill="url(#sea)"/><path d="M0 410 Q450 380 900 420 T1800 400 L1800 600 L0 600Z" fill="#f1dcae"/><path d="M0 405 Q450 375 900 415 T1800 395" stroke="#fff" stroke-width="8" fill="none" opacity=".8"/><path d="M1500 300 L1600 160 L1700 230 L1800 140 L1800 300Z" fill="#5d7f6e"/><circle cx="220" cy="110" r="50" fill="#fff6d0"/><g fill="#fff" opacity=".9"><ellipse cx="600" cy="120" rx="90" ry="22"/><ellipse cx="660" cy="105" rx="60" ry="22"/><ellipse cx="1150" cy="80" rx="110" ry="24"/></g>`);
// Lighthouse, portrait 900x1200.
scenes['coast-lighthouse'] = svg(900, 1200, g('s', [[0, '#a9d3ec'], [1, '#e9f4fa']]),
  `<rect width="900" height="1200" fill="url(#s)"/><path d="M0 900 L300 760 L620 820 L900 740 L900 1200 L0 1200Z" fill="#6b7f5a"/><rect y="1000" width="900" height="200" fill="#3f6f93"/><path d="M400 300 L500 300 L540 880 L360 880Z" fill="#f4f1ea"/>${[0, 1, 2].map((i) => `<path d="M${398 - i * 12} ${400 + i * 160} L${502 + i * 12} ${400 + i * 160} L${508 + i * 12} ${470 + i * 160} L${392 - i * 12} ${470 + i * 160}Z" fill="#c8402e"/>`).join('')}<rect x="395" y="230" width="110" height="70" fill="#38424a"/><rect x="410" y="245" width="80" height="40" fill="#ffe08a"/><path d="M380 230 L450 170 L520 230Z" fill="#c8402e"/>`);
// Umbrella from above, square 1000x1000.
{
  let wedges = '';
  for (let i = 0; i < 8; i++) {
    const a1 = (i / 8) * Math.PI * 2; const a2 = ((i + 1) / 8) * Math.PI * 2; const r = 300;
    wedges += `<path d="M560 460 L${560 + r * Math.cos(a1)} ${460 + r * Math.sin(a1)} L${560 + r * Math.cos(a2)} ${460 + r * Math.sin(a2)}Z" fill="${i % 2 ? '#ffffff' : '#e6463c'}"/>`;
  }
  scenes['coast-umbrella'] = svg(1000, 1000, '', `<rect width="1000" height="1000" fill="#ecd3a0"/>${Array.from({ length: 60 }, () => `<circle cx="${rnd() * 1000}" cy="${rnd() * 1000}" r="${2 + rnd() * 4}" fill="#cfb27c"/>`).join('')}<rect x="180" y="640" width="200" height="320" rx="14" fill="#3f8fc6" transform="rotate(-12 280 800)"/><rect x="190" y="660" width="180" height="40" fill="#fff" opacity=".7" transform="rotate(-12 280 800)"/><ellipse cx="600" cy="500" rx="300" ry="300" fill="#000" opacity=".12"/>${wedges}<circle cx="560" cy="460" r="16" fill="#333"/>`);
}
// Pier at night, 1600x900.
scenes['coast-pier'] = svg(1600, 900, g('s', [[0, '#0d1530'], [1, '#2b3b6b']]) + g('sea', [[0, '#1d2a4d'], [1, '#0a1022']]),
  `<rect width="1600" height="520" fill="url(#s)"/>${Array.from({ length: 80 }, () => `<circle cx="${rnd() * 1600}" cy="${rnd() * 480}" r="${rnd() * 2 + 0.6}" fill="#fff" opacity="${0.4 + rnd() * 0.6}"/>`).join('')}<circle cx="1280" cy="150" r="60" fill="#f4f0d8"/><rect y="520" width="1600" height="380" fill="url(#sea)"/><rect x="200" y="500" width="1100" height="24" fill="#3a2f2a"/>${Array.from({ length: 12 }, (_, i) => `<rect x="${220 + i * 92}" y="524" width="12" height="120" fill="#2a221e"/><circle cx="${226 + i * 92}" cy="488" r="7" fill="#ffd27a"/><rect x="${210 + i * 92}" y="660" width="32" height="${80 + (i % 3) * 30}" fill="#ffd27a" opacity=".18"/>`).join('')}`);
// Station platform, phone shape 720x1280.
scenes.station = svg(720, 1280, g('s', [[0, '#cfe0ea'], [1, '#f6f2ea']]) + g('floor', [[0, '#b9b4ab'], [1, '#6f6a62']]),
  `<rect width="720" height="1280" fill="url(#s)"/><path d="M0 0 L720 0 L720 120 L0 220Z" fill="#4a5560"/><path d="M0 760 L720 700 L720 1280 L0 1280Z" fill="url(#floor)"/><path d="M0 1000 L720 900" stroke="#f2c230" stroke-width="18"/><path d="M200 760 L360 700 L720 690 L720 760 L360 780Z" fill="#2e6e3e"/><rect x="380" y="610" width="340" height="90" fill="#e5e9ec"/><rect x="380" y="640" width="340" height="14" fill="#2e8b57"/>${[0, 1, 2, 3].map((i) => `<rect x="${400 + i * 80}" y="620" width="54" height="16" fill="#34495e"/>`).join('')}<rect x="80" y="260" width="300" height="110" rx="8" fill="#1f2a36"/><text x="230" y="330" font-family="Hiragino Sans, sans-serif" font-size="54" fill="#fff" text-anchor="middle">京都駅</text><rect x="150" y="370" width="10" height="400" fill="#4a5560"/><rect x="300" y="370" width="10" height="400" fill="#4a5560"/>`);
// Curry bowl from above, square.
scenes.curry = svg(1000, 1000, '', `<rect width="1000" height="1000" fill="#6b4a33"/>${Array.from({ length: 12 }, (_, i) => `<rect y="${i * 84}" width="1000" height="6" fill="#5a3d2a"/>`).join('')}<circle cx="500" cy="500" r="360" fill="#f3efe6"/><circle cx="500" cy="500" r="300" fill="#d98c2b"/><path d="M220 470 A300 300 0 0 1 520 210 L520 500Z" fill="#fbf8f1"/>${Array.from({ length: 22 }, () => `<circle cx="${380 + rnd() * 330}" cy="${380 + rnd() * 330}" r="${14 + rnd() * 8}" fill="#e8c27a"/>`).join('')}${Array.from({ length: 10 }, () => `<ellipse cx="${380 + rnd() * 330}" cy="${380 + rnd() * 330}" rx="26" ry="12" fill="#3d7a35" transform="rotate(${rnd() * 180} 500 500)"/>`).join('')}<rect x="760" y="120" width="40" height="420" rx="18" fill="#c9c4bb" transform="rotate(30 780 330)"/>`);
// Whiteboard with sticky notes, 1200x900.
scenes.whiteboard = svg(1200, 900, '', `<rect width="1200" height="900" fill="#d9d4cb"/><rect x="80" y="70" width="1040" height="700" rx="10" fill="#fbfbf8" stroke="#9aa0a6" stroke-width="16"/>${['To do', 'Doing', 'Done'].map((t, c) => `<text x="${210 + c * 340}" y="150" font-family="Marker Felt, Comic Sans MS, sans-serif" font-size="44" fill="#2b4d8c">${t}</text><line x1="${430 + c * 340}" y1="110" x2="${430 + c * 340}" y2="740" stroke="#c4c8cc" stroke-width="4"/>`).join('')}${Array.from({ length: 9 }, (_, i) => `<rect x="${140 + (i % 3) * 340 + (i % 2) * 20}" y="${200 + Math.floor(i / 3) * 180}" width="150" height="130" fill="${['#ffe57a', '#9fe0b4', '#ffb3c1', '#a8d0ff'][i % 4]}" transform="rotate(${(i % 3) - 1} 200 260)"/>`).join('')}<rect x="80" y="770" width="1040" height="30" fill="#b8bcc0"/>`);
// Phone wireframe sketch, 900x1200.
scenes.wireframe = svg(900, 1200, '', `<rect width="900" height="1200" fill="#f7f4ec"/>${Array.from({ length: 30 }, (_, i) => `<line x1="0" y1="${40 + i * 40}" x2="900" y2="${40 + i * 40}" stroke="#cfe0f0" stroke-width="2"/>`).join('')}<rect x="250" y="140" width="400" height="820" rx="50" fill="none" stroke="#333" stroke-width="7"/><rect x="290" y="230" width="320" height="60" fill="none" stroke="#333" stroke-width="5"/><rect x="290" y="320" width="320" height="180" fill="none" stroke="#333" stroke-width="5"/><line x1="290" y1="320" x2="610" y2="500" stroke="#333" stroke-width="4"/><line x1="610" y1="320" x2="290" y2="500" stroke="#333" stroke-width="4"/>${[0, 1, 2, 3].map((i) => `<line x1="290" y1="${550 + i * 60}" x2="${560 - i * 40}" y2="${550 + i * 60}" stroke="#333" stroke-width="5"/>`).join('')}<rect x="290" y="820" width="320" height="70" rx="35" fill="#e24a3b" opacity=".85"/><path d="M680 300 Q780 260 800 360" stroke="#e24a3b" stroke-width="6" fill="none"/><text x="640" y="250" font-family="Marker Felt, sans-serif" font-size="36" fill="#e24a3b">photo?</text>`);
// City skyline at dusk, 1600x900.
scenes.skyline = svg(1600, 900, g('s', [[0, '#1b2350'], [0.6, '#7b4b8a'], [1, '#f39a6b']]),
  `<rect width="1600" height="900" fill="url(#s)"/>${Array.from({ length: 26 }, (_, i) => { const bw = 40 + rnd() * 70; const bh = 200 + rnd() * 420; const x = i * 62; return `<rect x="${x}" y="${900 - bh}" width="${bw}" height="${bh}" fill="#141833"/>${Array.from({ length: Math.floor(bh / 40) }, (_, r) => (rnd() > 0.45 ? `<rect x="${x + 8}" y="${900 - bh + 14 + r * 40}" width="${bw - 16}" height="10" fill="#ffd27a" opacity=".75"/>` : '')).join('')}`; }).join('')}`);
// Mountain lake, 1200x800.
scenes.lake = svg(1200, 800, g('s', [[0, '#8ec5e8'], [1, '#e6f2f8']]) + g('l', [[0, '#3f7ea6'], [1, '#1e4560']]),
  `<rect width="1200" height="430" fill="url(#s)"/><path d="M0 430 L220 160 L380 330 L600 90 L820 300 L980 180 L1200 430Z" fill="#5a6f7f"/><path d="M560 140 L600 90 L650 150 L620 140 L600 160Z M190 200 L220 160 L250 205Z" fill="#fff"/><path d="M0 430 L160 330 L320 430Z M760 430 L960 300 L1200 430Z" fill="#2f5a3a"/><rect y="430" width="1200" height="370" fill="url(#l)"/><path d="M0 430 L220 640 L380 500 L600 720 L820 530 L980 620 L1200 430Z" fill="#5a6f7f" opacity=".35"/><path d="M80 760 L160 700 L200 760Z" fill="#7a4b2a"/>`);
// Family on the beach, 1000x1250 (4:5).
scenes['beach-family'] = svg(1000, 1250, g('s', [[0, '#ffd9a8'], [1, '#ffb27a']]),
  `<rect width="1000" height="700" fill="url(#s)"/><rect y="700" width="1000" height="200" fill="#4f93b8"/><rect y="900" width="1000" height="350" fill="#e9cf9a"/>${[[300, 1, '#c84b3c'], [480, 0.8, '#3f7f5f'], [640, 1.1, '#3a5a9c'], [780, 0.6, '#d9962b']].map(([x, s, c]) => `<g transform="translate(${x} ${980 - 260 * s}) scale(${s})"><circle cx="0" cy="0" r="40" fill="#5b3a2a"/><rect x="-45" y="45" width="90" height="170" rx="30" fill="${c}"/><rect x="-35" y="210" width="25" height="110" fill="#5b3a2a"/><rect x="10" y="210" width="25" height="110" fill="#5b3a2a"/></g>`).join('')}<circle cx="170" cy="220" r="80" fill="#fff1c9"/>`);

for (const [name, s] of Object.entries(scenes)) {
  const file = `${dir}${name}.svg`;
  writeFileSync(file, s);
  if (process.platform !== 'darwin') continue;
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', file, '--out', `${dir}${name}.jpg`], { stdio: 'ignore' });
  rmSync(file);
}
console.log(Object.keys(scenes).join(' '));
