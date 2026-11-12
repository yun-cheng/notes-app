import { describe, expect, it } from 'vitest';
import { decodeEntries, encodeEntries, entriesText, toEntries } from './clipboard';
import { parseEntries } from './entry';
import { doc, link, note, p, text, todo } from './testFixtures';
import type { DiaryCard } from './types';

const names: Record<string, string> = { w: 'work', h: 'home' };
const tagName = (id: string) => names[id];
const linkTitle = (_id: string, label: string) => label;

describe('copying entries', () => {
  const plan = todo('t', '2026-11-20', { title: 'Plan trip', tags: ['w'], content: doc(p(text('Book the train'))) });
  const done = todo('d', null, { title: 'Call mum', status: 'done' });
  const idea = note('n', '', { content: doc(p(text('Big '), text('idea', [{ type: 'bold' }])), p(link('x', 'Other note'))), tags: ['w', 'h', 'gone'] });
  const day: DiaryCard = { ...note('dy', ''), type: 'diary', date: '2026-11-11', content: doc(p(text('Quiet day'))) };

  it('writes todos the way the journal box reads them, and notes as Markdown', () => {
    expect(entriesText([plan, done, idea], tagName, linkTitle)).toBe(
      ['[ ] Plan trip @2026-11-20 #work\nBook the train', '[x] Call mum', 'Big **idea**\n\n[[Other note]]\n#work #home'].join('\n\n'),
    );
    const call = todo('c', null, { title: 'Call dad' });
    expect(entriesText([done, call, plan], tagName, linkTitle)).toBe('[x] Call mum\n[ ] Call dad\n\n[ ] Plan trip @2026-11-20 #work\nBook the train');
  });

  it('carries a due time and repeat both ways', () => {
    const gym = todo('g', '2026-11-16', { title: 'Gym', dueTime: '18:00', repeat: { unit: 'week', every: 2 } });
    const text = entriesText([gym], tagName, linkTitle);
    expect(text).toBe('[ ] Gym @2026-11-16 @18:00 @every-2-weeks');
    expect(parseEntries(text, '2026-11-12')).toMatchObject([{ title: 'Gym', due: '2026-11-16', dueTime: '18:00', repeat: { unit: 'week', every: 2 } }]);
    expect(decodeEntries(encodeEntries(toEntries([gym], tagName)))).toMatchObject([{ dueTime: '18:00', repeat: { unit: 'week', every: 2 } }]);
  });

  it('drops a time or repeat it does not understand, and keeps the todo', () => {
    const raw = JSON.stringify({ app: 'notes', version: 1, entries: [{ kind: 'todo', title: 'X', content: { type: 'doc' }, tags: [], due: '2026-11-16', dueTime: '25:00', repeat: { unit: 'hour', every: 1 } }] });
    expect(decodeEntries(raw)).toEqual([{ kind: 'todo', title: 'X', content: { type: 'doc' }, tags: [], due: '2026-11-16' }]);
  });

  it('reads back as the same todos when typed into the journal', () => {
    const back = parseEntries(entriesText([plan, done], tagName, linkTitle), '2026-11-12');
    expect(back.map((e) => [e.kind, e.title, e.due, e.done ?? false, e.tags])).toEqual([
      ['todo', 'Plan trip', '2026-11-20', false, ['work']],
      ['todo', 'Call mum', null, true, []],
    ]);
  });

  it('keeps everything in the exact copy, with tags by name and a diary entry as a note', () => {
    const entries = toEntries([plan, done, idea, day], tagName);
    expect(entries.map((e) => [e.kind, e.tags])).toEqual([
      ['todo', ['work']],
      ['todo', []],
      ['note', ['work', 'home']],
      ['note', []],
    ]);
    expect(decodeEntries(encodeEntries(entries))).toEqual(entries);
  });

  it('takes nothing that isn’t an exact copy from this app', () => {
    const one = encodeEntries(toEntries([plan], tagName));
    const tamper = (fn: (data: { entries: Record<string, unknown>[] } & Record<string, unknown>) => void) => {
      const data = JSON.parse(one);
      fn(data);
      return decodeEntries(JSON.stringify(data));
    };
    expect(decodeEntries('')).toBeNull();
    expect(decodeEntries('not json')).toBeNull();
    expect(decodeEntries('{"entries":[]}')).toBeNull();
    expect(tamper((d) => (d.app = 'other'))).toBeNull();
    expect(tamper((d) => (d.entries[0].kind = 'tag'))).toBeNull();
    expect(tamper((d) => (d.entries[0].content = { type: 'paragraph' }))).toBeNull();
    expect(tamper((d) => (d.entries[0].tags = [1]))).toBeNull();
    expect(tamper((d) => (d.entries[0].due = 'soon'))).toBeNull();
    expect(tamper((d) => (d.entries = []))).toBeNull();
    expect(tamper((d) => (d.entries[0].kind = 'note'))?.[0].due).toBeNull();
  });
});
