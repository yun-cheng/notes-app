import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { permissions } from '../../domain/access';
import { linkTitle } from '../../domain/cardIndex';
import { displayTitle } from '../../domain/content';
import { cardLines, changeSize, diffLines, restorePatch, sameContent, type DiffLine } from '../../domain/history';
import type { Card } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { SyncAuthExpired, SyncOffline } from '../../sync/engine';
import { fetchVersion, fetchVersions, sealVersions } from '../../sync/http';
import type { VersionInfo } from '../../sync/protocol';
import { Empty, Page } from '../components';
import { Diff } from '../Diff';
import { ReadOnlyDoc } from '../editor/ReadOnlyDoc';
import { Icon } from '../Icon';
import { LockPanel } from '../LockPanel';
import { cardPath } from '../paths';
import { useToast } from '../Toast';
import { useUndo } from '../useUndo';

/** A row on the history page: a saved version, or this device's changes that haven't synced yet. */
interface Entry {
  key: string;
  info: VersionInfo | null;
}

const LOCAL = 'local';

function describe(entry: Entry, first: boolean): string {
  if (!entry.info) return 'Not synced yet';
  const author = entry.info.author ?? 'From before history was kept';
  const who = entry.info.via ? `${author} via ${entry.info.via} (AI)` : author;
  return first ? `Current version · ${who}` : who;
}

function when(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })}, ${time}`;
}

function problem(err: unknown): string {
  if (err instanceof SyncOffline) return 'History needs a connection. Your notes are all still here.';
  if (err instanceof SyncAuthExpired) return 'Sign in again to see history.';
  return "History couldn't be loaded. Try again in a moment.";
}

export function HistoryPage() {
  const { id } = useParams();
  const { index } = useCards();
  const card = id ? index.byId.get(id) : undefined;
  const lockedIn = id ? index.lockedCards.get(id) : undefined;

  if (lockedIn) {
    return (
      <Page title="Locked">
        <LockPanel vaultId={lockedIn} />
      </Page>
    );
  }
  if (!card) {
    return (
      <Page title="History">
        <Empty>This card doesn't exist on this device.</Empty>
      </Page>
    );
  }
  return <History key={card.id} card={card} />;
}

function History({ card }: { card: Card }) {
  const { index, repo, vaults, shared } = useCards();
  const canEdit = permissions(card, vaults, shared).edit;
  const toast = useToast();
  const { undoAction } = useUndo();
  const navigate = useNavigate();
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Map<number, Card>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'changes' | 'full'>('changes');
  const view = useRef<HTMLElement>(null);
  const requested = useRef(new Set<number>());

  const unsynced = card.seq === 0;

  useEffect(() => {
    if (unsynced) return;
    let live = true;
    fetchVersions(card.id).then(
      (list) => live && setVersions(list),
      (err: unknown) => live && setError(problem(err)),
    );
    return () => {
      live = false;
    };
  }, [card.id, unsynced]);

  const load = (ids: number[]) => {
    for (const versionId of ids) {
      if (requested.current.has(versionId)) continue;
      requested.current.add(versionId);
      fetchVersion(card.id, versionId)
        .then((v) => repo.decode({ id: card.id, vault_id: card.vaultId, updated_at: v.saved_at, deleted: false, seq: 0, payload: v.payload }))
        .then(
          (decoded) => setLoaded((m) => new Map(m).set(versionId, decoded)),
          (err: unknown) => {
            requested.current.delete(versionId);
            setError(problem(err));
          },
        );
    }
  };

  const newest = versions?.[0] ? loaded.get(versions[0].id) : undefined;
  const localAhead = !!newest && !sameContent(card, newest);
  const entries: Entry[] = useMemo(
    () => [...(localAhead ? [{ key: LOCAL, info: null }] : []), ...(versions ?? []).map((info) => ({ key: String(info.id), info }))],
    [versions, localAhead],
  );

  const current = selected ?? entries[0]?.key ?? null;
  const at = entries.findIndex((e) => e.key === current);
  const entry = entries[at];
  const before = entries[at + 1];

  // The newest version is needed to tell whether this device is ahead; the shown one and the one before it to compare.
  useEffect(() => {
    const ids = [versions?.[0]?.id, entry?.info?.id, before?.info?.id].filter((v): v is number => v !== undefined);
    if (ids.length) load(ids);
  }, [versions, entry?.info?.id, before?.info?.id]);

  const shown = entry ? (entry.info ? loaded.get(entry.info.id) : card) : undefined;
  const previous = before ? (before.info ? loaded.get(before.info.id) : card) : undefined;
  const ready = !!shown && (!before || !!previous);

  const titleOf = (linkId: string, label: string) => linkTitle(index, linkId, label);
  const tagName = (tagId: string) => linkTitle(index, tagId, 'Deleted tag');
  const diff = useMemo<DiffLine[]>(
    () => (ready && shown ? diffLines(previous ? cardLines(previous, titleOf, tagName) : [], cardLines(shown, titleOf, tagName)) : []),
    // titleOf and tagName only read the index.
    [ready, shown, previous, index],
  );
  const size = changeSize(diff);

  const choose = (key: string) => {
    setSelected(key);
    if (window.matchMedia('(max-width: 859px)').matches) view.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const restore = async (version: Card, label: string) => {
    // Keeps what is there now as its own version. If this fails, the restore still goes ahead.
    await sealVersions(card.id).catch(() => undefined);
    const action = repo.action();
    await repo.update(card.id, restorePatch(version));
    toast(`Restored the version from ${label}`, { action: { label: 'Undo', run: () => void undoAction(action) } });
    void navigate(cardPath(card));
  };

  const back = (
    <Link className="icon-btn" to={cardPath(card)} aria-label="Back to card" title="Back to card">
      <Icon name="left" />
    </Link>
  );
  const heading = displayTitle(card);

  if (unsynced || versions?.length === 0) {
    return (
      <Page title="History" actions={back}>
        <p className="history__subject">{heading}</p>
        <Empty>
          {unsynced
            ? "This card hasn't synced yet. Its history starts once it reaches the server."
            : 'No earlier versions yet. History starts with the next change.'}
        </Empty>
      </Page>
    );
  }

  return (
    <Page title="History" actions={back}>
      <p className="history__subject">{heading}</p>
      {error && (
        <p className="history__error" role="alert">
          {error}
        </p>
      )}
      {!versions && !error && <Empty>Loading history…</Empty>}
      {versions && (
        <div className="history">
          <ol className="history__list" aria-label="Versions">
            {entries.map((e, i) => (
              <li key={e.key}>
                <button type="button" className={`history__entry${e.key === current ? ' is-selected' : ''}`} aria-current={e.key === current} onClick={() => choose(e.key)}>
                  <span className="history__when">{e.info ? when(e.info.saved_at) : 'On this device'}</span>
                  <span className="history__who">{describe(e, i === 0)}</span>
                </button>
              </li>
            ))}
          </ol>

          <section className="history__view" ref={view} aria-live="polite">
            {entry && (
              <div className="history__bar">
                <div className="segmented" role="group" aria-label="Show">
                  <button type="button" aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}>
                    Changes
                  </button>
                  <button type="button" aria-pressed={mode === 'full'} onClick={() => setMode('full')}>
                    Full text
                  </button>
                </div>
                {ready && mode === 'changes' && (
                  <span className="history__size">
                    {before ? (size.added || size.removed ? `+${size.added} −${size.removed} words` : 'No text changes') : 'First version'}
                  </span>
                )}
                <span className="card-bar__spacer" />
                {canEdit && shown && entry.info && !sameContent(card, shown) && (
                  <button type="button" className="btn btn--primary" onClick={() => void restore(shown, when(entry.info!.saved_at))}>
                    Restore
                  </button>
                )}
              </div>
            )}
            {!ready ? (
              <Empty>Loading…</Empty>
            ) : mode === 'full' ? (
              <>
                <h2 className="history__title">{displayTitle(shown!)}</h2>
                <ReadOnlyDoc key={current} content={shown!.content} />
              </>
            ) : (
              <Diff lines={diff} />
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
