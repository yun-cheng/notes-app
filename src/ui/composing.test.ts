import { describe, expect, it } from 'vitest';
import { composing } from './composing';

describe('composing', () => {
  const key = (e: { isComposing?: boolean; keyCode: number }) => ({ key: 'Enter', isComposing: false, ...e }) as unknown as KeyboardEvent;
  it('tells the Enter that picks a word with an input method from one pressed for itself', () => {
    expect(composing(key({ isComposing: true, keyCode: 229 }))).toBe(true);
    // Safari's, just after the word is in.
    expect(composing(key({ keyCode: 229 }))).toBe(true);
    expect(composing(key({ keyCode: 13 }))).toBe(false);
  });
  it('reads a React event through its native one', () => {
    expect(composing({ key: 'Enter', nativeEvent: key({ isComposing: true, keyCode: 229 }) } as never)).toBe(true);
    expect(composing({ key: 'Enter', nativeEvent: key({ keyCode: 13 }) } as never)).toBe(false);
  });
});
