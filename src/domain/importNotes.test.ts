import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { markdownFiles } from './backup';
import { buildIndex } from './cardIndex';
import { plainText } from './content';
import { filesFromZip, readImport, splitFrontMatter } from './importNotes';
import { doc, link, note, p, tag, text, todo } from './testFixtures';

const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};
const NOW = Date.parse('2026-11-18T12:00:00Z');
const empty = buildIndex([]);

describe('splitFrontMatter', () => {
  it('reads keys, quoted values and both kinds of list', () => {
    const { fields, body } = splitFrontMatter('---\ntitle: "A: b"\nTags: [one, "two, three"]\naliases:\n  - x\n  - \'y\'\n---\n\nBody');
    expect(fields).toEqual({ title: 'A: b', tags: ['one', 'two, three'], aliases: ['x', 'y'] });
    expect(body).toBe('\nBody');
  });
  it('leaves a file without front matter as it is', () => {
    expect(splitFrontMatter('# Hi\n---\nx')).toEqual({ fields: {}, body: '# Hi\n---\nx' });
  });
});

describe('readImport', () => {
  it('titles a file from its front matter, then its first heading, then its name', () => {
    const plan = readImport(
      [
        { path: 'a.md', text: '---\ntitle: From front\n---\n# Heading\n\nText' },
        { path: 'b.md', text: '# From heading\n\nText' },
        { path: 'notes/From name.md', text: 'Just text' },
      ],
      empty,
      ids(),
      NOW,
    );
    expect(plan.entries.map((e) => e.title)).toEqual(['From front', 'From heading', 'From name']);
    // A heading that isn't the title stays in the text.
    expect(plainText(plan.entries[0].content)).toContain('Heading');
    expect(plainText(plan.entries[1].content)).toBe('Text');
  });

  it('links files to each other by title or name, then to cards already here', () => {
    const index = buildIndex([note('here', 'Already here')]);
    const plan = readImport(
      [
        { path: 'One.md', text: 'See [[two-file|the second]], [[Already here]] and [[Nowhere]]' },
        { path: 'two-file.md', text: '# Two' },
      ],
      index,
      ids(),
      NOW,
    );
    const links = plan.entries[0].content.content![0].content!.filter((n) => n.type === 'cardLink');
    expect(links.map((l) => l.attrs)).toEqual([{ id: 'new-2', label: 'Two' }, { id: 'here', label: 'Already here' }]);
    expect(plan.entries[1].id).toBe('new-2');
  });

  it('reads tags, dates and a todo from front matter', () => {
    const plan = readImport(
      [
        { path: 'a.md', text: '---\ntype: todo\nstatus: done\ndue: 2026-12-01\ntime: "09:30"\nrepeat: weekly\nstart: 2026-11-28\ntags: ["#Work", work, Home]\ncreated: 2026-01-02\n---\nBody' },
        { path: 'b.md', text: 'Plain', modified: Date.parse('2026-03-04T10:00:00Z') },
        { path: 'c.md', text: '---\ncreated: 2030-01-01\n---\nFuture' },
      ],
      empty,
      ids(),
      NOW,
    );
    const [t, n, future] = plan.entries;
    expect(t).toMatchObject({ kind: 'todo', done: true, due: '2026-12-01', dueTime: '09:30', repeat: { unit: 'week', every: 1 }, start: '2026-11-28', tags: ['Work', 'work', 'Home'] });
    expect(new Date(t.createdAt!).getDate()).toBe(2);
    expect(n.createdAt).toBe(Date.parse('2026-03-04T10:00:00Z'));
    expect(future.createdAt).toBe(NOW);
  });

  it('skips blank files, tag files and cards that are already here', () => {
    const index = buildIndex([note('kept', 'Kept')]);
    const plan = readImport(
      [
        { path: 'blank.md', text: '' },
        { path: 'tags/Work.md', text: '---\nid: t1\ntype: tag\ntitle: "Work"\n---\n\n# Work\n' },
        { path: 'notes/Kept.md', text: '---\nid: kept\ntype: note\ntitle: "Kept"\n---\n\n# Kept\n\nx' },
      ],
      index,
      ids(),
      NOW,
    );
    expect(plan).toMatchObject({ entries: [], already: 1, skipped: 2 });
  });

  it('brings back what the Markdown export wrote: pages, todos, tags and links', () => {
    const cards = [
      tag('t-work', 'Work'),
      note('n1', 'Flashcard', { content: doc(p(text('Front'))), pages: [doc(p(text('Answer'))), doc(p(text('Example')))], tags: ['t-work'], createdAt: Date.parse('2026-02-03T10:00:00Z') }),
      todo('d1', '2026-12-01', { title: 'Ship it', content: doc(p(text('See '), link('n1', 'Flashcard'))), status: 'done', dueTime: '08:00' }),
      note('s1', 'A stack', { content: doc(p(text('About it'))), stack: ['n1', 'd1'] }),
    ];
    const files = markdownFiles(buildIndex(cards));
    const plan = readImport(files, empty, ids(), NOW);
    const byTitle = new Map(plan.entries.map((e) => [e.title, e]));
    expect(plan.skipped).toBe(1);

    const card = byTitle.get('Flashcard')!;
    expect(plainText(card.content)).toBe('Front');
    expect(card.pages!.map((d) => plainText(d))).toEqual(['Answer', 'Example']);
    expect(card.tags).toEqual(['Work']);
    expect(card.createdAt).toBe(Date.parse('2026-02-03T10:00:00Z'));

    const ship = byTitle.get('Ship it')!;
    expect(ship).toMatchObject({ kind: 'todo', done: true, due: '2026-12-01', dueTime: '08:00' });
    expect(ship.content.content![0].content![1]).toEqual({ type: 'cardLink', attrs: { id: card.id, label: 'Flashcard' } });

    // A stack comes in as a note with its own text; its list of entries is left out.
    expect(plainText(byTitle.get('A stack')!.content)).toBe('About it');
  });

  it('keeps a "Page 2" heading that is out of order in the text', () => {
    const [entry] = readImport([{ path: 'a.md', text: 'Intro\n\n## Page 3\n\nMore' }], empty, ids(), NOW).entries;
    expect(entry.pages).toBeUndefined();
    expect(plainText(entry.content)).toContain('Page 3');
  });
});

describe('filesFromZip', () => {
  it('reads Markdown and text files, leaving out hidden files and others', () => {
    const zip = zipSync({
      'notes/a.md': strToU8('A'),
      'b.txt': strToU8('B'),
      'c.png': new Uint8Array([1, 2]),
      '.obsidian/app.md': strToU8('x'),
      '__MACOSX/notes/._a.md': strToU8('x'),
    });
    expect(filesFromZip(zip).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'b.txt', text: 'B' },
      { path: 'notes/a.md', text: 'A' },
    ]);
  });
});
