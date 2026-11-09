import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from './pin';

describe('PIN verifier', () => {
  it('accepts the right PIN and rejects others', async () => {
    const stored = await hashPin('4821');
    expect(await verifyPin('4821', stored)).toBe(true);
    expect(await verifyPin('4822', stored)).toBe(false);
    expect(await verifyPin('', stored)).toBe(false);
  });
  it('never stores the PIN, and salts each verifier', async () => {
    const [a, b] = await Promise.all([hashPin('4821'), hashPin('4821')]);
    expect(JSON.stringify(a)).not.toContain('4821');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
  it('handles non-Latin passwords', async () => {
    const stored = await hashPin('密码1234');
    expect(await verifyPin('密码1234', stored)).toBe(true);
  });
});
