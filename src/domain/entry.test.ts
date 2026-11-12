import { describe, expect, it } from 'vitest';
import { appendToDoc, parseDue, parseEntries, parseEntry } from './entry';
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
    for (const text of ['[] Buy milk', '[ ] Buy milk', 'TODO Buy milk', 'Buy milk #todo']) {
      const entry = parseEntry(text, TODAY);
      expect(entry?.kind).toBe('todo');
      expect(entry?.title).toBe('Buy milk');
    }
    expect(parseEntry('todo list for the week', TODAY)?.kind).toBe('note');
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

  it('sends #diary text to the diary', () => {
    expect(parseEntry('Long walk by the river. #diary', TODAY)).toMatchObject({ kind: 'diary', content: textToDoc('Long walk by the river.') });
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

describe('appendToDoc', () => {
  it('adds after what is there, dropping a trailing empty line', () => {
    expect(appendToDoc(EMPTY_DOC, textToDoc('new'))).toEqual(textToDoc('new'));
    expect(appendToDoc(textToDoc('one\n'), textToDoc('two'))).toEqual(textToDoc('one\ntwo'));
  });
});
