import { describe, expect, it } from 'vitest';
import { buildTagGroups, clashingTags, moveMember, orderTags, pickInGroup, rankIn, settleTags, withTag } from './tagGroups';
import { tag } from './testFixtures';
import type { TagCard } from './types';

const group = (id: string, title: string, members: string[], choice: 'one' | 'many' = 'one', ordered = true): TagCard => ({ ...tag(id, title), members, choice, ordered });

describe('tag groups', () => {
  const cards = [
    tag('hi', 'High'),
    tag('lo', 'Low'),
    tag('med', 'Medium'),
    tag('work', 'work'),
    tag('cook', 'cooking'),
    group('prio', 'Priority', ['hi', 'med', 'lo', 'gone']),
    group('topics', 'Topics', ['cook', 'hi'], 'many', false),
  ];
  const all = buildTagGroups(cards);
  const { groupOf } = all;

  it('gathers each group’s live tags in order, a tag staying in the first group by title', () => {
    expect(all.groups.map((g) => [g.title, g.choice, g.ordered, g.members.map((m) => m.id)])).toEqual([
      ['Priority', 'one', true, ['hi', 'med', 'lo']],
      ['Topics', 'many', false, ['cook']],
    ]);
    expect(all.loose.map((t) => t.id)).toEqual(['work']);
  });

  it('lets a one-choice tag replace its group’s other tag, and adds the rest', () => {
    expect(withTag(['work', 'hi'], 'lo', groupOf)).toEqual(['work', 'lo']);
    expect(withTag(['work', 'hi'], 'cook', groupOf)).toEqual(['work', 'hi', 'cook']);
    expect(withTag(['hi'], 'hi', groupOf)).toEqual(['hi']);
    expect(settleTags(['hi', 'work', 'lo'], groupOf)).toEqual(['work', 'lo']);
  });

  it('shows grouped tags first, in their group’s order, and finds clashes', () => {
    expect(orderTags(['work', 'cook', 'lo'], all)).toEqual(['lo', 'cook', 'work']);
    expect([...clashingTags(['hi', 'lo', 'cook'], groupOf)]).toEqual(['hi', 'lo']);
    expect(clashingTags(['hi', 'cook'], groupOf).size).toBe(0);
  });

  it('ranks entries by an ordered group, with none last', () => {
    const prio = all.groups[0];
    expect([rankIn(prio, ['hi']), rankIn(prio, ['work', 'lo']), rankIn(prio, ['work'])]).toEqual([0, 2, 3]);
  });

  it('picks from a group’s menu: swapping in a one-choice group, toggling in another, or clearing', () => {
    const [prio, topics] = all.groups;
    expect(pickInGroup(['work', 'hi'], prio, 'lo')).toEqual(['work', 'lo']);
    expect(pickInGroup(['hi', 'lo', 'work'], prio, 'med')).toEqual(['work', 'med']);
    expect(pickInGroup(['work', 'hi'], prio, null)).toEqual(['work']);
    expect(pickInGroup(['work'], topics, 'cook')).toEqual(['work', 'cook']);
    expect(pickInGroup(['work', 'cook'], topics, 'cook')).toEqual(['work']);
  });

  it('moves a tag within its group', () => {
    expect(moveMember(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveMember(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
  });
});
