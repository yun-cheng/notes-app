import { describe, expect, it } from 'vitest';
import { dueWord, entriesFromDoc, parseDue, parseEntries, parseEntry } from './entry';
import type { JSONNode } from './types';
import { textToDoc } from './content';
import { EMPTY_DOC } from './types';

const TODAY = '2026-11-12'; // a Thursday

describe('parseEntry', () => {
  it('keeps plain text as a note', () => {
    expect(parseEntry('Call the bank\nabout the card', TODAY)).toEqual({
      kind: 'note',
      title: '',
      content: textToDoc('Call the bank\nabout the card'),
      tags: [],
      due: null,
    });
  });

  it('skips empty text, and text that was only tags', () => {
    expect(parseEntry('  \n ', TODAY)).toBeNull();
    expect(parseEntry('#work #home', TODAY)).toBeNull();
    expect(parseEntry('[] ', TODAY)).toBeNull();
  });

  it('files a note under its tags and takes them out of the text', () => {
    const entry = parseEntry('Idea for the #Work offsite\n#ideas #work', TODAY);
    expect(entry?.tags).toEqual(['Work', 'ideas']);
    expect(entry?.content).toEqual(textToDoc('Idea for the offsite'));
  });

  it('reads tags in any script, but not a # inside a word', () => {
    expect(parseEntry('買菜 #家裡', TODAY)?.tags).toEqual(['家裡']);
    expect(parseEntry('issue#12 and C#', TODAY)?.tags).toEqual([]);
  });

  it('makes a todo from a [] or TODO marker, or #todo', () => {
    for (const text of ['[] Buy milk', '[ ] Buy milk', '[]Buy milk', 'TODO Buy milk', 'Buy milk #todo']) {
      const entry = parseEntry(text, TODAY);
      expect(entry?.kind).toBe('todo');
      expect(entry?.title).toBe('Buy milk');
    }
    expect(parseEntry('todo list for the week', TODAY)?.kind).toBe('note');
    expect(parseEntry('[x] Bought milk', TODAY)).toMatchObject({ kind: 'todo', title: 'Bought milk', done: true });
  });

  it('puts a todo’s later lines in its details', () => {
    const entry = parseEntry('[] Pack for the trip\npassport\ncharger', TODAY);
    expect(entry?.title).toBe('Pack for the trip');
    expect(entry?.content).toEqual(textToDoc('passport\ncharger'));
    expect(parseEntry('[] Pack', TODAY)?.content).toEqual(EMPTY_DOC);
  });

  it('reads a todo’s due date, and leaves dates in notes alone', () => {
    expect(parseEntry('[] Pay rent @tomorrow #home', TODAY)).toMatchObject({ title: 'Pay rent', due: '2026-11-13', tags: ['home'] });
    expect(parseEntry('[] Email @someone', TODAY)).toMatchObject({ title: 'Email @someone', due: null });
    expect(parseEntry('Lunch @friday was fun', TODAY)?.content).toEqual(textToDoc('Lunch @friday was fun'));
  });

  it('files #diary text, a note or a todo, in the diary', () => {
    expect(parseEntry('Long walk by the river. #diary', TODAY)).toMatchObject({ kind: 'note', diary: true, content: textToDoc('Long walk by the river.'), tags: [] });
    expect(parseEntry('[] Call grandma #diary', TODAY)).toMatchObject({ kind: 'todo', diary: true, title: 'Call grandma' });
    expect(parseEntry('Long walk', TODAY)).not.toHaveProperty('diary');
  });
});

describe('parseEntries', () => {
  const titles = (text: string, opts?: { allTodos?: boolean }) => parseEntries(text, TODAY, opts).map((e) => `${e.kind}:${e.title || e.content.content?.[0]?.content?.[0]?.text}`);

  it('makes a todo for each [] line', () => {
    expect(titles('[] milk\n[] eggs @tomorrow\nTODO call mom')).toEqual(['todo:milk', 'todo:eggs', 'todo:call mom']);
    expect(parseEntries('[] milk\n[] eggs @tomorrow', TODAY)[1].due).toBe('2026-11-13');
  });

  it('keeps text before the first [] line as its own entry', () => {
    expect(titles('Shopping for the party\n[] cake\n[] candles')).toEqual(['note:Shopping for the party', 'todo:cake', 'todo:candles']);
  });

  it('keeps a single todo’s later lines as its details', () => {
    const [entry, ...rest] = parseEntries('[] Pack\npassport\ncharger', TODAY);
    expect(rest).toEqual([]);
    expect(entry.content).toEqual(textToDoc('passport\ncharger'));
  });

  it('applies a last line of tags to every entry', () => {
    const entries = parseEntries('[] milk #dairy\n[] bread\n\n#groceries #home', TODAY);
    expect(entries.map((e) => e.tags)).toEqual([['dairy', 'groceries', 'home'], ['groceries', 'home']]);
    expect(parseEntries('One thought\n#ideas', TODAY)).toMatchObject([{ kind: 'note', tags: ['ideas'] }]);
  });

  it('makes every line a todo when asked', () => {
    expect(titles('milk\n\neggs\n[] bread', { allTodos: true })).toEqual(['todo:milk', 'todo:eggs', 'todo:bread']);
  });
});

describe('entriesFromDoc', () => {
  const t = (text: string, marks?: JSONNode['marks']): JSONNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const para = (...content: JSONNode[]): JSONNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
  const item = (checked: boolean, ...content: JSONNode[]): JSONNode => ({ type: 'taskItem', attrs: { checked }, content });
  const tasks = (...items: JSONNode[]): JSONNode => ({ type: 'taskList', content: items });
  const docOf = (...content: JSONNode[]): JSONNode => ({ type: 'doc', content });

  it('makes a todo of each checkbox, and one note of the blocks between them', () => {
    const entries = entriesFromDoc(
      docOf(
        para(t('Party prep')),
        para(t('at Sam’s')),
        tasks(item(false, para(t('cake @fri'))), item(true, para(t('balloons')))),
        para(t('#home')),
      ),
      TODAY,
    );
    expect(entries).toEqual([
      { kind: 'note', title: '', content: docOf(para(t('Party prep')), para(t('at Sam’s'))), tags: ['home'], due: null },
      { kind: 'todo', title: 'cake', content: EMPTY_DOC, tags: ['home'], due: '2026-11-13' },
      { kind: 'todo', title: 'balloons', content: EMPTY_DOC, tags: ['home'], due: null, done: true },
    ]);
  });

  it('keeps formatting and links, and takes tags out of the text', () => {
    const link = [{ type: 'link', attrs: { href: 'https://a.example' } }];
    const [entry] = entriesFromDoc(docOf(para(t('Read '), t('this', link), t(' later #reading'))), TODAY);
    expect(entry).toMatchObject({ kind: 'note', tags: ['reading'], content: docOf(para(t('Read '), t('this', link), t(' later'))) });
  });

  it('leaves code as typed', () => {
    const code: JSONNode = { type: 'codeBlock', content: [t('#include <stdio.h>\n@media print {}')] };
    const inline = [{ type: 'code' }];
    const todo = tasks(item(false, para(t('run '), t('@daily', inline), t(' #ops @fri'))));
    expect(entriesFromDoc(docOf(para(t('Snippet #c')), code, todo), TODAY)).toEqual([
      { kind: 'note', title: '', content: docOf(para(t('Snippet')), code), tags: ['c'], due: null },
      { kind: 'todo', title: 'run @daily', content: EMPTY_DOC, tags: ['ops'], due: '2026-11-13' },
    ]);
  });

  it('puts a checkbox’s nested items after it, and its other lines in its details', () => {
    const nested = item(false, para(t('Trip')), para(t('passport')), tasks(item(false, para(t('book hotel')))));
    expect(entriesFromDoc(docOf(tasks(nested)), TODAY).map((e) => [e.title, e.content])).toEqual([
      ['Trip', docOf(para(t('passport')))],
      ['book hotel', EMPTY_DOC],
    ]);
  });

  it('reads pasted [] lines and #diary, and skips what holds nothing', () => {
    expect(entriesFromDoc(docOf(para(t('[x] posted the letter'))), TODAY)).toMatchObject([{ kind: 'todo', title: 'posted the letter', done: true }]);
    expect(entriesFromDoc(docOf(para(t('Quiet evening #diary'))), TODAY)).toMatchObject([{ kind: 'note', diary: true, content: docOf(para(t('Quiet evening'))) }]);
    expect(entriesFromDoc(docOf(para(), tasks(item(false, para())), para(t('#work'))), TODAY)).toEqual([]);
  });

  it('keeps a photo-only entry', () => {
    const photo = { type: 'photo', attrs: { id: 'p-1' } };
    expect(entriesFromDoc(docOf(photo), TODAY)).toMatchObject([{ kind: 'note', content: docOf(photo) }]);
  });
});

describe('parseDue', () => {
  it('reads words and dates', () => {
    expect(parseDue('today', TODAY)).toBe(TODAY);
    expect(parseDue('Tomorrow', TODAY)).toBe('2026-11-13');
    expect(parseDue('2026-12-01', TODAY)).toBe('2026-12-01');
    expect(parseDue('2026-02-30', TODAY)).toBeNull();
    expect(parseDue('fr', TODAY)).toBeNull();
  });
  it('takes a weekday as the next one after today', () => {
    expect(parseDue('fri', TODAY)).toBe('2026-11-13');
    expect(parseDue('monday', TODAY)).toBe('2026-11-16');
    expect(parseDue('thu', TODAY)).toBe('2026-11-19');
  });
});

describe('due times and repeats', () => {
  const when = (text: string) => {
    const e = parseEntry(text, TODAY);
    return e && { title: e.title, due: e.due, dueTime: e.dueTime, repeat: e.repeat };
  };

  it('reads a time and a repeat beside the date, in any order', () => {
    expect(when('[] Pay rent @monthly @2026-12-01 @9am')).toEqual({ title: 'Pay rent', due: '2026-12-01', dueTime: '09:00', repeat: { unit: 'month', every: 1 } });
    expect(when('[] Water plants @every-3-days @fri')).toEqual({ title: 'Water plants', due: '2026-11-13', dueTime: undefined, repeat: { unit: 'day', every: 3 } });
  });

  it('starts a time or a repeat with no date today', () => {
    expect(when('[] Call the dentist @3:30pm')).toEqual({ title: 'Call the dentist', due: TODAY, dueTime: '15:30', repeat: undefined });
    expect(when('[] Standup @weekdays @9:30')).toEqual({ title: 'Standup', due: TODAY, dueTime: '09:30', repeat: { unit: 'weekday', every: 1 } });
  });

  it('leaves other @ words, and times on notes, as typed', () => {
    expect(when('[] Ask @bob about 3pm')?.title).toBe('Ask @bob about 3pm');
    expect(parseEntry('Lunch @1pm with Sam', TODAY)?.content).toEqual(textToDoc('Lunch @1pm with Sam'));
  });

  it('reads them from the journal box too', () => {
    const doc: JSONNode = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Gym @weekly @18:00' }] }] }] }] };
    expect(entriesFromDoc(doc, TODAY)).toMatchObject([{ kind: 'todo', title: 'Gym', due: TODAY, dueTime: '18:00', repeat: { unit: 'week', every: 1 } }]);
  });

  it('says what an @ word sets', () => {
    expect(['fri', '3pm', 'weekly', 'bob'].map((w) => dueWord(w, TODAY))).toEqual(['date', 'time', 'repeat', null]);
  });
});
