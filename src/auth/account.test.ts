import { describe, expect, it } from 'vitest';
import { accountInitial, isDemoAccount } from './account';

const account = (name: string, email: string) => ({ id: 'u', name, email });

describe('isDemoAccount', () => {
  it('knows the demo accounts by their .test addresses', () => {
    expect(isDemoAccount(account('Demo', 'demo@demo.test'))).toBe(true);
    expect(isDemoAccount(account('Sam', 'sam@demo.TEST'))).toBe(true);
    expect(isDemoAccount(account('Zeke', 'zeke@gmail.com'))).toBe(false);
    expect(isDemoAccount(account('Tester', 'test@testing.com'))).toBe(false);
  });
});

describe('accountInitial', () => {
  it('takes the name, or the address when there is no name', () => {
    expect(accountInitial(account('demo', 'demo@demo.test'))).toBe('D');
    expect(accountInitial(account('  ', 'zeke@gmail.com'))).toBe('Z');
  });
});
