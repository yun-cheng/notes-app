import { describe, expect, it } from 'vitest';
import { toMarkdown } from './markdown';
import { fromMarkdown } from './markdownIn';

const titles: Record<string, string> = { Shop: 'c-shop' };
const resolve = (title: string) => (titles[title] ? { id: titles[title], label: title } : null);
const plain = (id: string, label: string) => (id === 'c-shop' ? 'Shop' : label);

describe('fromMarkdown', () => {
  it('reads paragraphs, headings and inline marks', () => {
    expect(fromMarkdown('# Plan\n\nBuy **milk** and *eggs*, `code`, ~~old~~ [site](https://x.dev)\nnext line')).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Buy ' },
            { type: 'text', text: 'milk', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'eggs', marks: [{ type: 'italic' }] },
            { type: 'text', text: ', ' },
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
            { type: 'text', text: ', ' },
            { type: 'text', text: 'old', marks: [{ type: 'strike' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'next line' },
          ],
        },
      ],
    });
  });
  it('links [[Title]] to a known card and leaves unknown ones as text', () => {
    const doc = fromMarkdown('See [[Shop]] and [[Nowhere]]', resolve);
    expect(doc.content![0].content).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'cardLink', attrs: { id: 'c-shop', label: 'Shop' } },
      { type: 'text', text: ' and [[Nowhere]]' },
    ]);
  });
  it('reads nested lists, quotes, code and rules', () => {
    const doc = fromMarkdown('- one\n  - inner\n- two\n\n3. three\n4. four\n\n> quoted\n\n```js\nlet a;\n```\n\n---');
    expect(doc.content!.map((n) => n.type)).toEqual(['bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule']);
    const first = doc.content![0].content![0];
    expect(first.content!.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
    expect(doc.content![1].attrs).toEqual({ start: 3 });
    expect(doc.content![3]).toEqual({ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'let a;' }] });
  });
  it('keeps underscores inside words and honours escapes', () => {
    const doc = fromMarkdown('snake_case_name and \\*not italic\\*');
    expect(doc.content![0].content).toEqual([{ type: 'text', text: 'snake_case_name and *not italic*' }]);
  });
  it('gives an empty document for empty input', () => {
    expect(fromMarkdown('  \n')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
  it('survives a round trip through Markdown export', () => {
    const source = '## Trip\n\nFly **Saturday**, see [[Shop]].\n\n- pack\n- book\n\n1. first\n2. second\n\n> calm';
    expect(toMarkdown(fromMarkdown(source, resolve), plain).trim()).toBe(source);
  });
});

describe('photos', () => {
  it('reads and writes a photo reference', () => {
    const doc = fromMarkdown('Before\n![Beach](attachment:photo-1234)\nAfter');
    expect(doc.content!.map((n) => n.type)).toEqual(['paragraph', 'photo', 'paragraph']);
    expect(doc.content![1].attrs).toEqual({ id: 'photo-1234', alt: 'Beach' });
    expect(toMarkdown(doc, plain)).toBe('Before\n\n![Beach](attachment:photo-1234)\n\nAfter');
  });
});
