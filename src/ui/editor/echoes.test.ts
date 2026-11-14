import { describe, expect, it } from 'vitest';
import { Echoes } from './echoes';

describe('echoes of the editor’s own saves', () => {
  it('are recognised once each, in order, even when one is skipped', () => {
    const echoes = new Echoes();
    echoes.sent('a');
    echoes.sent('ab');
    echoes.sent('abc');
    expect(echoes.isEcho('ab')).toBe(true);
    expect(echoes.isEcho('abc')).toBe(true);
    // Back to an earlier state (an undo, another device): not an echo, so it's shown.
    expect(echoes.isEcho('a')).toBe(false);
    expect(echoes.isEcho('ab')).toBe(false);
  });
});
