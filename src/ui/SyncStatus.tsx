import { useIsUnsynced, useCards, useSyncStatus, useUnsynced } from '../state/CardsContext';
import { syncSummary, type SyncLook } from '../sync/engine';
import { Icon, type IconName } from './Icon';
import { usePopover } from './usePopover';

const ICONS: Record<SyncLook, IconName> = { synced: 'cloud', sending: 'sync', offline: 'offline', trouble: 'alert' };

const PANEL_WIDTH = 250;

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * How sync is going, in every page's title bar: Synced, Syncing…, Offline or Not synced, with what that means and
 * a Sync now button behind it. A narrow phone shows just the icon, so the title keeps its room.
 */
export function SyncBadge() {
  const { engine } = useCards();
  const status = useSyncStatus();
  const waiting = useUnsynced().size;
  const menu = usePopover<HTMLSpanElement>();
  const summary = syncSummary(status, waiting);
  return (
    <span className="sync-menu" ref={menu.root}>
      <button
        type="button"
        className={`sync-badge is-${summary.look}`}
        aria-label={`Sync: ${summary.label}`}
        aria-expanded={!!menu.open}
        title={summary.label}
        onClick={menu.toggle}
      >
        <Icon name={ICONS[summary.look]} size={16} />
        <span>{summary.label}</span>
      </button>
      {menu.open && (
        // Kept on screen on a phone, where the badge sits too far left for a panel lined up with its right edge.
        <div className="style-menu sync-menu__panel" role="status" style={menu.fixedStyle(PANEL_WIDTH)}>
          <strong>{summary.label}</strong>
          <p>{summary.detail}</p>
          {status.lastSyncedAt && <p className="sync-menu__when">Last synced at {time(status.lastSyncedAt)}</p>}
          {status.state !== 'expired' && (
            <button type="button" className="btn" disabled={status.state === 'syncing'} onClick={() => void engine.sync()}>
              {status.state === 'syncing' ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      )}
    </span>
  );
}

/** A clock on an entry with changes this device hasn't sent yet. Nothing once the server has them. */
export function SyncMark({ id }: { id: string }) {
  return useIsUnsynced(id) ? <WaitingMark /> : null;
}

// Apart from SyncMark, so only entries that are waiting follow every change of the sync state.
function WaitingMark() {
  const { state } = useSyncStatus();
  const stuck = state === 'error' || state === 'expired';
  const words = stuck ? "Couldn't sync yet. Saved on this device." : 'Saved on this device, not synced yet';
  return (
    <span className={`sync-mark${stuck ? ' is-stuck' : ''}`} role="img" aria-label={words} title={words}>
      <Icon name={stuck ? 'alert' : 'clock'} size={12} />
    </span>
  );
}
