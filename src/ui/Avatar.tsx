import { useState } from 'react';
import { accountInitial, isDemoAccount } from '../auth/account';
import type { Account } from '../sync/protocol';

/**
 * The account's Google photo in a circle, or its first letter when it has none or the photo won't load (offline).
 * The photo loads from Google without a referrer, so Google isn't told which page shows it.
 */
export function Avatar({ account, size = 28 }: { account: Account; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.46) };
  if (account.picture && broken !== account.picture) {
    return <img className="avatar" src={account.picture} alt="" referrerPolicy="no-referrer" style={style} onError={() => setBroken(account.picture!)} />;
  }
  return (
    <span className={`avatar${isDemoAccount(account) ? ' is-demo' : ''}`} aria-hidden="true" style={style}>
      {accountInitial(account)}
    </span>
  );
}
