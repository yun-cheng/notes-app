import { Link } from 'react-router';
import { useAccount } from '../auth/AuthContext';
import { useSyncStatus } from '../state/CardsContext';

/**
 * What a link names (a vault, a tag, an entry) that the open account doesn't have on this device. It's likely
 * another account's, opened after switching accounts or from a link copied in it; or it was shared with this
 * account and then taken back. Says so, offers the other accounts signed in on this browser (the address stays
 * as it is, so the link opens there), and `away`, a way back to something this account has.
 */
export function NotHere({ thing, away }: { thing?: string; away?: { to: string; label: string } }) {
  const { account, others, switchTo } = useAccount();
  const { lastSyncedAt } = useSyncStatus();
  return (
    <div className="not-here">
      <p className="empty">
        {thing ? `This ${thing}` : 'This'} isn't in this account, {account.email}.{' '}
        {lastSyncedAt === null ? "This device hasn't finished syncing yet, so it may still turn up." : "It may be another account's, or no longer shared with this one."}
      </p>
      <div className="button-row">
        {others.map((other) => (
          <button key={other.id} type="button" className="btn" onClick={() => switchTo(other)} title={`Open this in ${other.email}`}>
            Switch to {other.name}
          </button>
        ))}
        {away && (
          <Link className="btn" to={away.to}>
            {away.label}
          </Link>
        )}
      </div>
    </div>
  );
}
