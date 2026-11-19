import type { Cue } from './content';
import type { JSONNode } from './types';

/** The rate voice is sent to be transcribed at, as the model hears it: 16 kHz. */
export const VOICE_RATE = 16_000;

/** The longest piece sent to be transcribed at once, in seconds (the server takes a little more). */
export const PIECE_SECONDS = 120;

/** How many bars a voice message is drawn with. */
export const PEAK_BARS = 48;

/** A voice message's words as an entry keeps them: the text, the language heard, and when each stretch starts. */
export interface Transcript {
  transcript: string;
  language: string | null;
  cues: Cue[];
}

/** A recording's name, from when it was made: "Voice message 2026-11-20 14.32.webm". */
export function voiceName(at: Date, extension: string): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  return `Voice message ${day} ${two(at.getHours())}.${two(at.getMinutes())}.${extension}`;
}

/** The file extension for what a browser records in: webm, ogg or m4a. */
export function voiceExtension(mime: string): string {
  const type = mime.split(';')[0].trim().toLowerCase();
  return type === 'audio/webm' ? 'webm' : type === 'audio/ogg' ? 'ogg' : type === 'audio/mp4' || type === 'audio/aac' || type === 'audio/x-m4a' ? 'm4a' : 'audio';
}

/**
 * A document with a transcript put on the voice message `fileId`, wherever it is, or taken off with null. The same
 * document, unchanged, if it doesn't hold that one.
 */
export function withTranscript(doc: JSONNode, fileId: string, words: Transcript | null): JSONNode {
  let found = false;
  const visit = (node: JSONNode): JSONNode => {
    if (node.type === 'file' && node.attrs?.id === fileId) {
      found = true;
      const attrs = { ...node.attrs, transcript: words?.transcript ?? null, language: words?.language ?? null, cues: words?.cues ?? null };
      return { ...node, attrs };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  const next = visit(doc);
  return found ? next : doc;
}

/** Whether a language writes without spaces between words, so pieces of its transcript join with none. */
const unspaced = (language: string | null) => !!language && /^(zh|ja|th|lo|km|my)\b/.test(language.toLowerCase());

/**
 * The pieces of one voice message, each transcribed on its own, as one transcript: their words in order, and their
 * cues moved on by where each piece starts. The language is the one heard most.
 */
export function joinTranscripts(pieces: { offset: number; text: string; language: string | null; cues: Cue[] }[]): Transcript {
  const heard = new Map<string, number>();
  for (const p of pieces) if (p.language) heard.set(p.language, (heard.get(p.language) ?? 0) + p.text.length);
  const language = [...heard].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const transcript = pieces
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join(unspaced(language) ? '' : ' ');
  const cues = pieces.flatMap((p) => p.cues.map((c) => ({ start: Math.round((c.start + p.offset) * 100) / 100, text: c.text })));
  return { transcript, language, cues };
}

/** The cue being said at `time`: the last to start by then, or -1 before the first. */
export function cueAt(cues: readonly Cue[], time: number): number {
  let at = -1;
  for (let i = 0; i < cues.length && cues[i].start <= time + 0.05; i++) at = i;
  return at;
}

/** How loud a sound is along its length, in `bars` bars from 0 to 100, the loudest at 100. */
export function peaksOf(samples: Float32Array, bars = PEAK_BARS): number[] {
  if (!samples.length) return [];
  const each = samples.length / bars;
  const levels = Array.from({ length: bars }, (_, i) => {
    const from = Math.floor(i * each);
    const to = Math.max(from + 1, Math.floor((i + 1) * each));
    let sum = 0;
    for (let j = from; j < to && j < samples.length; j++) sum += samples[j] * samples[j];
    return Math.sqrt(sum / (to - from));
  });
  const loudest = Math.max(...levels);
  return levels.map((l) => (loudest > 0 ? Math.round((l / loudest) * 100) : 0));
}

/**
 * Where to cut a long recording into pieces to transcribe, as sample offsets after 0: no piece longer than
 * `PIECE_SECONDS`, each cut at the quietest moment in the 15 seconds before that, so it falls between words.
 */
export function cutPoints(samples: Float32Array, rate = VOICE_RATE, most = PIECE_SECONDS): number[] {
  const cuts: number[] = [];
  const window = Math.round(rate * 0.05);
  const span = Math.round(rate * 15);
  let start = 0;
  while (samples.length - start > most * rate) {
    const limit = start + most * rate;
    let best = limit;
    let quietest = Infinity;
    for (let at = limit - span; at + window <= limit; at += window) {
      let sum = 0;
      for (let j = at; j < at + window; j++) sum += samples[j] * samples[j];
      if (sum < quietest) {
        quietest = sum;
        best = at + Math.round(window / 2);
      }
    }
    cuts.push(best);
    start = best;
  }
  return cuts;
}

/** Sound as a WAV file: one channel, 16 bits, at `rate`. */
export function wavBytes(samples: Float32Array, rate = VOICE_RATE): Uint8Array<ArrayBuffer> {
  const data = samples.length * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => [...s].forEach((ch, i) => (bytes[at + i] = ch.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}
