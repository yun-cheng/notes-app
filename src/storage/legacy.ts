import Dexie from 'dexie';
import { makeBackup } from '../domain/backup';
import { DexieStore } from './dexieStore';
import { localStorageJournal } from './journal';
import { CardRepository } from './repository';
import { jsonCodec } from './types';

const LEGACY_DB = 'notes-app';
const LEGACY_JOURNAL = 'notes-app:journal';

/** Moves notes written before accounts existed into `repo`. The first account to sign in on this browser gets them. */
export async function claimLegacyNotes(repo: CardRepository): Promise<number> {
  if (!(await Dexie.exists(LEGACY_DB))) return 0;
  const store = new DexieStore(LEGACY_DB);
  const legacy = new CardRepository(store, jsonCodec, undefined, undefined, localStorageJournal(LEGACY_JOURNAL));
  await legacy.init();
  const { vaults, cards } = await legacy.exportAll();
  if (cards.length) await repo.importBackup(makeBackup(vaults, cards));
  await store.destroy();
  localStorage.removeItem(LEGACY_JOURNAL);
  return cards.length;
}
