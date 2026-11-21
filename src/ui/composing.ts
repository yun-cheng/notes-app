import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Whether a key is part of typing a word with an input method (Chinese, Japanese, Korean): the Enter that picks
 * 出國 from ㄑㄧㄢˊ isn't one to add a tag or send with. Chrome and Firefox say so with `isComposing`; Safari sends
 * that Enter just after the word is in, saying so only by keyCode 229.
 */
export function composing(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  const native = 'nativeEvent' in e ? e.nativeEvent : e;
  return native.isComposing || native.keyCode === 229;
}
