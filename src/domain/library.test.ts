import { describe, expect, it } from 'vitest';
import { cardFiles, cardLinks, fileDays, fileKind, fileKindIn, linkDays } from './library';
import { doc, note, p, tag, text, todo } from './testFixtures';
import type { JSONNode } from './types';

const file = (id: string, name = `${id}.pdf`): JSONNode => ({ type: 'file', attrs: { id, name, mime: 'application/pdf', size: 10 } });
const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime();

describe('cardLinks', () => {
  it('takes the links on every page, in order, each once', () => {
    const card = note('n', '', { content: doc(p(text('see https://a.com and https://b.com'))), pages: [doc(p(text('https://c.com https://a.com')))] });
    expect(cardLinks(card).map((l) => l.id)).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    expect(cardLinks(tag('t', 'Tag'))).toEqual([]);
  });
});

describe('cardFiles', () => {
  it('takes the files on every page, each once, with their names', () => {
    const card = todo('t', null, { content: doc(file('f1', 'plan.pdf')), pages: [doc(file('f2'), file('f1', 'plan.pdf'))] });
    expect(cardFiles(card).map((f) => [f.id, f.name])).toEqual([
      ['f1', 'plan.pdf'],
      ['f2', 'f2.pdf'],
    ]);
  });
});

describe('linkDays', () => {
  it('groups links by the day their entry was written, newest first, and shows one in two entries under each', () => {
    const old = note('old', '', { createdAt: at('2026-11-10'), content: doc(p(text('https://same.com'))) });
    const late = note('late', '', { createdAt: at('2026-11-12', 20), content: doc(p(text('https://same.com https://x.com'))) });
    const words = note('words', '', { createdAt: at('2026-11-11'), content: doc(p(text('no link'))) });
    const days = linkDays([old, words, late]);
    expect(days.map((d) => d.day)).toEqual(['2026-11-12', '2026-11-10']);
    expect(days.flatMap((d) => d.items.map((i) => [i.id, i.card.id]))).toEqual([
      ['https://same.com', 'late'],
      ['https://x.com', 'late'],
      ['https://same.com', 'old'],
    ]);
  });
});

describe('fileDays', () => {
  it('shows a file in two entries once, with the newer', () => {
    const first = note('first', '', { createdAt: at('2026-11-01'), content: doc(file('same')) });
    const copy = note('copy', '', { createdAt: at('2026-11-05'), content: doc(file('same'), file('own')) });
    const days = fileDays([first, copy]);
    expect(days).toHaveLength(1);
    expect(days[0].items.map((i) => [i.id, i.card.id, i.day])).toEqual([
      ['same', 'copy', '2026-11-05'],
      ['own', 'copy', '2026-11-05'],
    ]);
    // A video shows on the Photos page instead.
    const clip = note('clip', '', { content: doc({ type: 'file', attrs: { id: 'v', name: 'a.mp4', mime: 'video/mp4' } }) });
    expect(fileDays([clip])).toEqual([]);
  });
});

describe('fileKind', () => {
  it('sorts files by their extension, then their type', () => {
    const kind = (name: string, mime: string | null = null) => fileKind({ name, mime });
    expect(kind('lease.pdf', 'application/pdf')).toBe('pdf');
    expect(kind('scan', 'application/pdf')).toBe('pdf');
    expect(kind('budget.csv', 'text/plain')).toBe('spreadsheet');
    expect(kind('plan.XLSX')).toBe('spreadsheet');
    expect(kind('notes.txt', 'text/plain')).toBe('document');
    expect(kind('letter', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document');
    expect(kind('deck.key')).toBe('slides');
    expect(kind('Voice message 2026-11-20 09.05.webm', 'audio/webm;codecs=opus')).toBe('audio');
    expect(kind('song.mp3', 'application/octet-stream')).toBe('audio');
    expect(kind('diagram.svg', 'image/svg+xml')).toBe('image');
    expect(kind('photos.zip', 'application/zip')).toBe('archive');
    expect(kind('data.bin', 'application/octet-stream')).toBe('other');
    expect(kind('README')).toBe('other');
  });

  it('is read from the Files page’s address only when it names one', () => {
    expect(fileKindIn(new URLSearchParams('kind=audio'))).toBe('audio');
    expect(fileKindIn(new URLSearchParams('kind=nope'))).toBeUndefined();
    expect(fileKindIn(new URLSearchParams(''))).toBeUndefined();
  });
});
