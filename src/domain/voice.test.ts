import { describe, expect, it } from 'vitest';
import { fileAttachments, plainText, previewLines } from './content';
import { toMarkdown } from './markdown';
import type { JSONNode } from './types';
import { cueAt, cutPoints, joinTranscripts, peaksOf, voiceExtension, voiceName, wavBytes, withTranscript } from './voice';

const voice = (attrs: Record<string, unknown> = {}): JSONNode => ({ type: 'file', attrs: { id: 'v1', name: 'Voice message.webm', mime: 'audio/webm', size: 900, duration: 4.2, ...attrs } });
const doc = (...content: JSONNode[]): JSONNode => ({ type: 'doc', content });

describe('voice messages', () => {
  it('are named for when they were recorded, in what the browser records', () => {
    expect(voiceName(new Date(2026, 10, 20, 9, 5), 'webm')).toBe('Voice message 2026-11-20 09.05.webm');
    expect(voiceExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(voiceExtension('audio/mp4')).toBe('m4a');
    expect(voiceExtension('audio/wav')).toBe('audio');
  });

  it('keep their transcript in the entry, read back only as it should be', () => {
    const body = doc({ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }, voice());
    const words = { transcript: 'Pick up the tickets.', language: 'en', cues: [{ start: 0, text: 'Pick up the tickets.' }] };
    const done = withTranscript(body, 'v1', words);
    expect(fileAttachments(done)[0]).toMatchObject({ duration: 4.2, transcript: 'Pick up the tickets.', language: 'en', cues: words.cues, peaks: [] });
    expect(withTranscript(body, 'other', words)).toBe(body);
    expect(fileAttachments(withTranscript(done, 'v1', null))[0].transcript).toBeNull();
    const odd = fileAttachments(doc(voice({ cues: [{ start: -1, text: 'x' }, { start: 1, text: 2 }, { start: 2, text: 'ok' }], peaks: [5, 'x', 300] })))[0];
    expect(odd.cues).toEqual([{ start: 2, text: 'ok' }]);
    expect(odd.peaks).toEqual([5, 100]);
    // A video keeps nothing of a transcript.
    expect(fileAttachments(doc(voice({ mime: 'video/mp4', transcript: 'x' })))[0].transcript).toBeUndefined();
  });

  it('are found, compared and copied by their words', () => {
    const body = withTranscript(doc(voice()), 'v1', { transcript: 'Pick up the tickets.', language: 'en', cues: [] });
    expect(plainText(body)).toBe('Pick up the tickets.');
    expect(previewLines(body, undefined, true)).toEqual(['[Voice: Voice message.webm]', '“Pick up the tickets.”']);
    expect(previewLines(body)).toEqual([]);
    expect(toMarkdown(body, (_id, label) => label)).toContain('[Voice message.webm](attachment:v1)\n\n> Pick up the tickets.');
  });

  it('join their pieces’ words, moving each piece’s cues to where it starts', () => {
    const joined = joinTranscripts([
      { offset: 0, text: ' First part. ', language: 'en', cues: [{ start: 0, text: 'First part.' }] },
      { offset: 118.5, text: 'Second part.', language: 'en', cues: [{ start: 1.25, text: 'Second part.' }] },
      { offset: 230, text: '', language: null, cues: [] },
    ]);
    expect(joined).toEqual({ transcript: 'First part. Second part.', language: 'en', cues: [{ start: 0, text: 'First part.' }, { start: 119.75, text: 'Second part.' }] });
    expect(joinTranscripts([{ offset: 0, text: '你好。', language: 'zh', cues: [] }, { offset: 100, text: '再见。', language: 'zh', cues: [] }]).transcript).toBe('你好。再见。');
    expect(joinTranscripts([])).toEqual({ transcript: '', language: null, cues: [] });
  });

  it('show which cue is being said', () => {
    const cues = [{ start: 0.5, text: 'a' }, { start: 3, text: 'b' }];
    expect([0, 0.5, 2.9, 3, 99].map((t) => cueAt(cues, t))).toEqual([-1, 0, 0, 1, 1]);
  });

  it('are drawn by how loud they are along their length', () => {
    const samples = new Float32Array(400);
    samples.fill(0.5, 100, 200);
    samples.fill(0.25, 300, 400);
    expect(peaksOf(samples, 4)).toEqual([0, 100, 0, 50]);
    expect(peaksOf(new Float32Array(0))).toEqual([]);
    expect(peaksOf(new Float32Array(10), 2)).toEqual([0, 0]);
  });

  it('are cut into pieces short enough to send, between words', () => {
    const rate = 100;
    const samples = new Float32Array(rate * 300).fill(0.5);
    // Quiet a little before two minutes in.
    samples.fill(0, rate * 110, rate * 111);
    const cuts = cutPoints(samples, rate, 120);
    expect(cuts[0]).toBeGreaterThanOrEqual(rate * 110);
    expect(cuts[0]).toBeLessThan(rate * 111);
    expect(cuts).toHaveLength(2);
    expect(cuts[1] - cuts[0]).toBeLessThanOrEqual(rate * 120);
    expect(cutPoints(new Float32Array(rate * 100), rate, 120)).toEqual([]);
  });

  it('are sent as 16-bit WAV', () => {
    const bytes = wavBytes(new Float32Array([0, 1, -1, 2]));
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});
