import { describe, expect, it } from 'vitest';
import { buildIndex } from './cardIndex';
import { makeBackup, markdownFiles, parseBackup } from './backup';
import { toMarkdown } from './markdown';
import { base, doc, link, note, p, tag, text, todo } from './testFixtures';
import type { JSONNode } from './types';

describe('markdown', () => {
  const none = (_: string, fallback: string) => fallback;
  it('renders marks, headings, links and escapes', () => {
    const out = toMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Head')] },
        p(text('bold', [{ type: 'bold' }]), text(' '), text('it', [{ type: 'italic' }]), text(' '), text('c*d', [{ type: 'code' }])),
        p(text('site', [{ type: 'link', attrs: { href: 'https://x.dev' } }])),
        p(text('a*b snake_case _x_')),
        p(text('# not a heading')),
      ),
      none,
    );
    expect(out).toBe('## Head\n\n**bold** *it* `c*d`\n\n[site](https://x.dev)\n\na\\*b snake_case \\_x\\_\n\n\\# not a heading');
  });
  it('renders nested lists, quotes and code', () => {
    const li = (...c: JSONNode[]): JSONNode => ({ type: 'listItem', content: c });
    const out = toMarkdown(
      doc(
        { type: 'bulletList', content: [li(p(text('a')), { type: 'orderedList', attrs: { start: 3 }, content: [li(p(text('b')))] })] },
        { type: 'blockquote', content: [p(text('q'))] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [text('x*y')] },
        { type: 'horizontalRule' },
      ),
      none,
    );
    expect(out).toBe('- a\n\n  3. b\n\n> q\n\n```js\nx*y\n```\n\n---');
  });
  it('writes card links with the current title, so renames carry over', () => {
    expect(toMarkdown(doc(p(link('a', 'Old'))), () => 'New')).toBe('[[New]]');
  });
});

describe('backup', () => {
  const t = tag('t', 'Work');
  it('writes one Markdown file per card, with de-duplicated safe names', () => {
    const index = buildIndex([
      t,
      note('a', 'Plan: A/B', { tags: ['t'] }),
      note('b', 'plan: a/b'),
      todo('x', '2026-11-12', { title: 'Call' }),
    ]);
    const files = markdownFiles(index);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain('todos/Call.md');
    expect(paths.filter((x) => x.toLowerCase().startsWith('notes/plan a b'))).toHaveLength(2);
    const noteFile = files.find((f) => f.text.includes('id: a'))!;
    expect(noteFile.text).toContain('tags: ["Work"]');
    expect(files.find((f) => f.path.startsWith('todos'))!.text).toContain('due: 2026-11-12');
  });
  it('exports no locked card, and no locked title through a link', () => {
    const secret = note('s', 'Secret title', { vaultId: 'private' });
    const open = note('o', 'Open', { content: doc(p(link('s', 'Secret title'))) });
    const files = markdownFiles(buildIndex([secret, open], new Set(['private'])));
    expect(files).toHaveLength(1);
    expect(files[0].text).toContain('[[Locked]]');
    expect(files[0].text).not.toContain('Secret title');
  });
  it('round-trips and rejects files it cannot restore', () => {
    const b = makeBackup([], [t], 0);
    expect(parseBackup(JSON.stringify(b)).cards).toEqual([t]);
    expect(() => parseBackup('{')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"format":"x"}')).toThrow(/not a backup/);
    expect(() => parseBackup(JSON.stringify({ ...b, version: 9 }))).toThrow(/version 9/);
    expect(() => parseBackup(JSON.stringify({ ...b, cards: [{ id: 1 }] }))).toThrow(/damaged/);
  });
  it('refuses a card missing what the app reads from it', () => {
    const b = makeBackup([], [t, todo('x', '2026-11-12'), note('n', 'N')], 0);
    expect(parseBackup(JSON.stringify(b)).cards).toHaveLength(3);
    const damaged = (change: (cards: Record<string, unknown>[]) => void) => {
      const copy = JSON.parse(JSON.stringify(b)) as { cards: Record<string, unknown>[] };
      change(copy.cards);
      return () => parseBackup(JSON.stringify(copy));
    };
    expect(damaged((c) => (c[1].status = 'maybe'))).toThrow(/damaged/);
    expect(damaged((c) => (c[1].due = 'friday'))).toThrow(/damaged/);
    expect(damaged((c) => (c[1].repeat = { unit: 'fortnight', every: 1 }))).toThrow(/damaged/);
    expect(damaged((c) => delete c[2].createdAt)).toThrow(/damaged/);
    expect(damaged((c) => (c[2].tags = [1]))).toThrow(/damaged/);
    expect(damaged((c) => (c[2].content = { type: 'paragraph' }))).toThrow(/damaged/);
    expect(damaged((c) => delete c[0].pinned)).toThrow(/damaged/);
  });
  it('restores an old backup’s diary cards as notes', () => {
    const old = { ...base, id: 'd', title: '', type: 'diary', date: '2026-11-10', content: doc(p(text('hello'))) };
    const [card] = parseBackup(JSON.stringify({ ...makeBackup([], [], 0), cards: [old] })).cards;
    expect(card).toMatchObject({ id: 'd', type: 'note', content: old.content });
    expect(card).not.toHaveProperty('date');
  });
});
