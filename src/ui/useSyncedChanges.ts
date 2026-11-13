import { useCallback, useEffect, useRef, useState } from 'react';
import { appendRecent, reachOf, refreshRecent, syncedChange, versionEntry, type Change } from '../domain/changes';
import { useCards } from '../state/CardsContext';
import { SyncAuthExpired, SyncOffline } from '../sync/engine';
import { fetchRecentVersions } from '../sync/http';
import type { RecentVersionsResponse } from '../sync/protocol';

/** The newest page is asked again after a sync, but no more often than this. */
const REFRESH_EVERY = 20_000;

function problemOf(err: unknown): string {
  if (err instanceof SyncOffline) return 'Offline. Changes made on other devices and by AI apps may be missing.';
  if (err instanceof SyncAuthExpired) return 'Sign in again to see what was changed on other devices and by AI apps.';
  return "Changes made on other devices and by AI apps couldn't be loaded. Try again in a moment.";
}

export interface SyncedChanges {
  /** Changes read from the server's history, newest first, this device's own among them. Null until the first read. */
  changes: Change[] | null;
  /** Everything saved since this moment is in `changes`. Older changes are on pages not loaded yet. */
  reach: number;
  /** Whether there are older pages. */
  older: boolean;
  /** `changes` is behind: a page arrived that hasn't been read yet. */
  reading: boolean;
  /** Set while a page is on its way. */
  loading: boolean;
  /** What to tell the user when the server didn't answer. */
  problem: string | null;
  /** The server has answered, or failed to, at least once. */
  settled: boolean;
  /** Loads the next, older page. */
  more: () => void;
}

/**
 * What changed lately on any device, by anyone, through any AI app: the server's history of every card, read
 * as changes. The newest page is asked again after each sync, so a change made elsewhere shows up by itself.
 */
export function useSyncedChanges(): SyncedChanges {
  const { repo, engine, locked } = useCards();
  const [pages, setPages] = useState<RecentVersionsResponse | null>(null);
  const [read, setRead] = useState<{ from: RecentVersionsResponse; changes: Change[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const latest = useRef(pages);
  latest.current = pages;

  useEffect(() => {
    let live = true;
    let asked = -Infinity;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      asked = Date.now();
      try {
        const page = await fetchRecentVersions(await repo.deviceId());
        if (!live) return;
        setPages((had) => refreshRecent(had, page));
        setProblem(null);
      } catch (err) {
        if (live) setProblem(problemOf(err));
      }
      if (live) setSettled(true);
    };
    const plan = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void ask(), Math.max(0, asked + REFRESH_EVERY - Date.now()));
    };
    plan();
    let synced = engine.getStatus().lastSyncedAt;
    const stop = engine.subscribe(() => {
      const now = engine.getStatus().lastSyncedAt;
      if (now === synced) return;
      synced = now;
      plan();
    });
    return () => {
      live = false;
      clearTimeout(timer);
      stop();
    };
  }, [repo, engine]);

  // Read again when a vault is unlocked or locked: what can be read has changed.
  useEffect(() => {
    if (!pages) return;
    let live = true;
    void Promise.all(pages.versions.map(async (version) => syncedChange(await repo.decodeChange(versionEntry(version)), version))).then((list) => {
      if (live) setRead({ from: pages, changes: list.filter((change): change is Change => !!change) });
    });
    return () => {
      live = false;
    };
  }, [repo, pages, locked]);

  const more = useCallback(() => {
    const next = latest.current?.next;
    if (busy.current || !next) return;
    busy.current = true;
    setLoading(true);
    void (async () => {
      try {
        const page = await fetchRecentVersions(await repo.deviceId(), next);
        // Unless the history started over meanwhile.
        setPages((had) => (had?.next === next ? appendRecent(had, page) : had));
        setProblem(null);
      } catch (err) {
        setProblem(problemOf(err));
      }
      busy.current = false;
      setLoading(false);
    })();
  }, [repo]);

  return {
    changes: read?.changes ?? null,
    reach: reachOf(read?.from ?? null),
    older: !!read?.from.next,
    reading: !!pages && read?.from !== pages,
    loading,
    problem,
    settled: settled && (!pages || !!read),
    more,
  };
}
