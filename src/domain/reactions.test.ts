import { describe, expect, it } from 'vitest';
import { emojisIn, isEmoji, reactedBy, reactionCounts, toggleReaction } from './reactions';

describe('toggleReaction', () => {
  it('puts a reaction on, adds others to it, and takes it off again', () => {
    const one = toggleReaction(undefined, '👍', 'me');
    expect(one).toEqual({ '👍': ['me'] });
    const two = toggleReaction({ '👍': ['ann'] }, '👍', 'me');
    expect(two).toEqual({ '👍': ['ann', 'me'] });
    expect(toggleReaction(two, '👍', 'me')).toEqual({ '👍': ['ann'] });
  });

  it('drops an emoji nobody is left on, and the whole field once none are', () => {
    expect(toggleReaction({ '👍': ['me'], '🎉': ['ann'] }, '👍', 'me')).toEqual({ '🎉': ['ann'] });
    expect(toggleReaction({ '👍': ['me'] }, '👍', 'me')).toBeNull();
  });

  it('keeps emoji in the order they were first put on', () => {
    const r = toggleReaction(toggleReaction({ '🔥': ['ann'] }, '👀', 'me'), '🔥', 'me');
    expect(Object.keys(r!)).toEqual(['🔥', '👀']);
  });
});

describe('reactionCounts', () => {
  it('counts each emoji and marks the ones this account put on', () => {
    expect(reactionCounts({ '👍': ['ann', 'me'], '🎉': ['ann'], '😮': [] }, 'me')).toEqual([
      { emoji: '👍', count: 2, mine: true, by: ['ann', 'me'] },
      { emoji: '🎉', count: 1, mine: false, by: ['ann'] },
    ]);
    expect(reactionCounts(undefined, 'me')).toEqual([]);
  });

  it('says who reacted', () => {
    expect(reactedBy({ count: 1, mine: true })).toBe('You');
    expect(reactedBy({ count: 2, mine: true })).toBe('You and 1 other');
    expect(reactedBy({ count: 4, mine: true })).toBe('You and 3 others');
    expect(reactedBy({ count: 3, mine: false })).toBe('3 people');
  });
});

describe('emojisIn', () => {
  it('finds emoji, each as one even when made of several characters, and nothing else', () => {
    expect(emojisIn('hi 👍🏽 and 👨‍👩‍👧 🇯🇵 ❤️ 👍🏽 x')).toEqual(['👍🏽', '👨‍👩‍👧', '🇯🇵', '❤️']);
    expect(emojisIn('plain words 123')).toEqual([]);
  });

  it('tells one emoji from anything else', () => {
    expect(isEmoji('🎉')).toBe(true);
    expect(isEmoji('👩🏾‍💻')).toBe(true);
    expect(isEmoji('🎉🎉')).toBe(false);
    expect(isEmoji('a')).toBe(false);
    expect(isEmoji('🎉 yay')).toBe(false);
  });
});
