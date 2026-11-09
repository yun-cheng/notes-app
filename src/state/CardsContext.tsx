import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { buildIndex, type CardIndex } from '../domain/cardIndex';
import { toDateKey } from '../domain/dates';
import type { Card, CardRecord } from '../domain/types';
import { DexieStore } from '../storage/dexieStore';
import { localStorageJournal } from '../storage/journal';
import { CardRepository } from '../storage/repository';
import { jsonCodec } from '../storage/types';

const repo = new CardRepository(new DexieStore(), jsonCodec, undefined, undefined, localStorageJournal());

interface CardsValue {
  index: CardIndex;
  repo: CardRepository;
}

const CardsContext = createContext<CardsValue | null>(null);

export function CardsProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<CardIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let latest = 0;
    const decoded = new Map<string, { at: number; deleted: boolean; card: Card }>();

    const load = async (records: CardRecord[]) => {
      const run = ++latest;
      const cards = await Promise.all(
        records.map(async (r) => {
          const hit = decoded.get(r.id);
          if (hit && hit.at === r.updated_at && hit.deleted === r.deleted) return hit.card;
          const card = await repo.decode(r);
          decoded.set(r.id, { at: r.updated_at, deleted: r.deleted, card });
          return card;
        }),
      );
      if (active && run === latest) setIndex(buildIndex(cards));
    };

    repo.init().catch((e: unknown) => setError(String(e)));
    void navigator.storage?.persist?.();
    const stop = repo.store.subscribe((records) => {
      load(records).catch((e: unknown) => setError(String(e)));
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  if (error) {
    return (
      <div className="boot">
        <h1>Your notes couldn't be opened</h1>
        <p>This browser is blocking local storage, which can happen in a private window.</p>
        <pre>{error}</pre>
      </div>
    );
  }
  if (!index) return <div className="boot" aria-busy="true" />;
  return <CardsContext.Provider value={{ index, repo }}>{children}</CardsContext.Provider>;
}

export function useCards(): CardsValue {
  const value = useContext(CardsContext);
  if (!value) throw new Error('useCards must be used inside CardsProvider');
  return value;
}

/** Today's date key, kept current if the app stays open past midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => toDateKey(new Date()));
  useEffect(() => {
    const check = () => setToday(toDateKey(new Date()));
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}
