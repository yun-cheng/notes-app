/**
 * Writes the demo's voice messages, which the dev server serves in place of Google Drive (vite.config.ts), spoken by
 * the Mac's own voices, each sentence on its own so when each starts is known: `<name>.m4a`, as Safari records, and
 * `voices.json` with each one's length, its loudness along its length (as a device finds when one is added) and
 * when each sentence starts, which scripts/demoData.ts gives its transcript. Needs macOS's `say` and ffmpeg; run
 * `node scripts/demoFiles/voices.mjs` from the project folder, followed by names to write only those (keeping the rest).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = new URL('.', import.meta.url).pathname;
const RATE = 16_000;
const BARS = 48;
const GAP = 0.35;

const VOICES = {
  'errands-voice': {
    voice: 'Samantha',
    sentences: ['Quick list for Saturday.', 'Pick up the dry cleaning before noon.', 'Then basil, limes and coconut milk for the curry.', 'And call Mom about the trip.'],
  },
  'diary-voice': {
    voice: 'Karen',
    sentences: ['Long walk by the river after work.', 'The light on the water was lovely.'],
  },
  'idea-voice': {
    voice: 'Daniel',
    sentences: ['An idea for the app.', 'What if the weekly review read your voice notes back to you, as a little podcast?'],
  },
  // Sent just after the errands, and recorded quietly, as from across the room: it plays on from the one before, evened out.
  'errands-more-voice': {
    voice: 'Samantha',
    sentences: ['Oh, one more thing.', 'Stamps from the post office.'],
    gain: 0.2,
  },
};

/** Sound as 16 kHz samples, one channel, from any file ffmpeg reads. */
function samples(file) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
  return new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
}

/** How loud it is along its length, in bars from 0 to 100, as `peaksOf` in src/domain/voice.ts finds. */
function peaks(all) {
  const each = all.length / BARS;
  const levels = Array.from({ length: BARS }, (_, i) => {
    const from = Math.floor(i * each);
    const to = Math.max(from + 1, Math.floor((i + 1) * each));
    let sum = 0;
    for (let j = from; j < to; j++) sum += (all[j] / 32768) ** 2;
    return Math.sqrt(sum / (to - from));
  });
  const loudest = Math.max(...levels);
  return levels.map((l) => Math.round((l / loudest) * 100));
}

const only = process.argv.slice(2);
const facts = only.length ? JSON.parse(readFileSync(`${here}voices.json`, 'utf8')) : {};
const work = mkdtempSync(`${tmpdir()}/voices-`);
try {
  for (const [name, { voice, sentences, gain = 1 }] of Object.entries(VOICES)) {
    if (only.length && !only.includes(name)) continue;
    const parts = sentences.map((text, i) => {
      const file = `${work}/${name}-${i}.aiff`;
      execFileSync('say', ['-v', voice, '-o', file, text]);
      return { text, pcm: samples(file).map((s) => Math.round(s * gain)) };
    });
    const gap = new Int16Array(Math.round(GAP * RATE));
    const pieces = [gap, ...parts.flatMap((p) => [p.pcm, gap])];
    const all = new Int16Array(pieces.reduce((n, p) => n + p.length, 0));
    const cues = [];
    let at = 0;
    for (const p of pieces) {
      const part = parts.find((q) => q.pcm === p);
      if (part) cues.push({ start: Math.round((at / RATE) * 100) / 100, text: part.text });
      all.set(p, at);
      at += p.length;
    }
    const pcm = `${work}/${name}.pcm`;
    writeFileSync(pcm, Buffer.from(all.buffer));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', pcm, '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', `${here}${name}.m4a`]);
    facts[name] = { duration: Math.round((all.length / RATE) * 1000) / 1000, peaks: peaks(all), cues };
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(`${here}voices.json`, `${JSON.stringify(facts, null, 2)}\n`);
console.log(Object.keys(facts).map((n) => `${n}: ${facts[n].duration}s`).join('\n'));
