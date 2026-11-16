import { common, createLowlight } from 'lowlight';
import { describe, expect, it } from 'vitest';
import { CODE_LANGUAGES, findLanguage, languageLabel } from './codeLanguages';

describe('code languages', () => {
  it('offers only languages the highlighter knows, by every name', () => {
    const lowlight = createLowlight(common);
    for (const l of CODE_LANGUAGES) {
      expect(lowlight.registered(l.id), l.id).toBe(true);
    }
  });

  it('finds a language by its short names, in any case', () => {
    expect(findLanguage('js')?.id).toBe('javascript');
    expect(findLanguage('PY')?.label).toBe('Python');
    expect(findLanguage('sh')?.label).toBe('Shell');
    expect(findLanguage('javascript')?.label).toBe('JavaScript');
    expect(findLanguage('')).toBeNull();
    expect(findLanguage(null)).toBeNull();
    expect(findLanguage('elixir')).toBeNull();
  });

  it('names a language as written when it is not offered', () => {
    expect(languageLabel('ts')).toBe('TypeScript');
    expect(languageLabel('elixir')).toBe('elixir');
    expect(languageLabel(null)).toBeNull();
    expect(languageLabel('  ')).toBeNull();
  });
});
