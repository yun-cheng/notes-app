import { describe, expect, it } from 'vitest';
import { formatDay } from './dates';
import { fromTemplate, isTemplate } from './templates';
import { doc, note, p, tag, text, todo } from './testFixtures';
import type { JSONNode } from './types';

const checklist = (...items: [string, boolean][]): JSONNode => ({
  type: 'taskList',
  content: items.map(([t, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [p(text(t))] })),
});

describe('templates', () => {
  const today = '2026-11-17';

  it('is a note or todo marked as one', () => {
    expect(isTemplate(note('n', '', { template: true }))).toBe(true);
    expect(isTemplate(todo('t', null, { template: true }))).toBe(true);
    expect(isTemplate(note('n', ''))).toBe(false);
    expect(isTemplate(tag('g', 'G'))).toBe(false);
  });

  it('copies the template with its checklists unticked and {date} filled in', () => {
    const template = note('r', 'Weekly review {date}', {
      template: true,
      color: 'blue',
      tags: ['w'],
      content: doc(p(text('Written {Date}')), checklist(['Inbox to zero', true], ['Plan next week', false])),
      pages: [doc(p(text('Done by {today}')))],
    });
    const made = fromTemplate(template, today);
    const day = formatDay(today);
    expect(made.title).toBe(`Weekly review ${day}`);
    expect(made.type).toBe('note');
    expect(made.tags).toEqual(['w']);
    expect(made.color).toBe('blue');
    expect(made.content.content![0]).toEqual(p(text(`Written ${day}`)));
    expect(made.content.content![1].content!.map((i) => i.attrs?.checked)).toEqual([false, false]);
    expect(made.pages).toEqual([doc(p(text(`Done by ${day}`)))]);
    // The template itself is left as it was.
    expect(template.content.content![1].content![0].attrs?.checked).toBe(true);
  });
});
