import type { Account } from '../sync/protocol';

/**
 * The accounts `npm run demo` makes on a local server, which it wipes and starts over each time it runs. Their
 * addresses end in `.test`, a domain that never exists on the internet, so no real account can look like one.
 */
export const isDemoAccount = (account: Account) => account.email.toLowerCase().endsWith('.test');

/** The first letter of the account's name, for the round badge that stands for it. */
export const accountInitial = (account: Account) => (account.name.trim() || account.email).charAt(0).toUpperCase() || '?';
