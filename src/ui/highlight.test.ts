import { common, createLowlight } from 'lowlight';
import { describe, expect, it } from 'vitest';
import { highlightTree, tokenRanges } from './highlight';

const lowlight = createLowlight(common);

describe('code colors', () => {
  it('finds where each token is in the code', () => {
    const code = 'const n = 42; // why';
    const ranges = tokenRanges(highlightTree(lowlight, code, 'js')!);
    const token = (cls: string) => ranges.filter((r) => r.className.includes(cls)).map((r) => code.slice(r.from, r.to));
    expect(token('hljs-keyword')).toEqual(['const']);
    expect(token('hljs-number')).toEqual(['42']);
    expect(token('hljs-comment')).toEqual(['// why']);
  });
  it('knows languages by their short names, and leaves unknown ones plain', () => {
    expect(highlightTree(lowlight, 'echo hi', 'sh')).not.toBeNull();
    expect(highlightTree(lowlight, 'x', 'no-such-language')).toBeNull();
    expect(highlightTree(lowlight, 'x'.repeat(5000), null)).toBeNull();
  });
});
