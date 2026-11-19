import { displayTitle, withoutPhotos } from '../domain/content';
import { cardPhotoIds, photoFileNames, type PhotoItem } from '../domain/photos';
import { zip } from '../domain/zip';
import { useCards, useToday } from '../state/CardsContext';
import { entries } from './entryActions';
import { useToast } from './Toast';
import { useUndo } from './useUndo';
import { usePermissions } from './viewOnly';

const count = (n: number) => (n === 1 ? '1 photo' : `${n} photos`);

/** Whether this browser can hand photos to another app, as a phone's share sheet does. */
export const canSharePhotos = () => typeof navigator.canShare === 'function' && typeof navigator.share === 'function';

/** Saves a file this page made, under `name`. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

/**
 * What can be done with photos picked on the Photos page, all at once: download them (one as itself, more in a zip),
 * share them, or take them out of their entries, which can be undone. A photo not on this device and not yet
 * uploaded from the one it was added on is left out, and the toast says so.
 */
export function usePhotoActions() {
  const { photos, index, repo } = useCards();
  const today = useToday();
  const may = usePermissions();
  const toast = useToast();
  const { undoAction } = useUndo();

  /** The photos' files, named by day and entry, and how many weren't here. */
  const gather = async (items: readonly PhotoItem[]) => {
    const blobs = await Promise.all(items.map((i) => photos.blob(i.id).catch(() => null)));
    const here = items.flatMap((item, k) => (blobs[k] ? [{ item, blob: blobs[k] }] : []));
    const names = photoFileNames(here.map(({ item, blob }) => ({ day: item.day, title: displayTitle(item.card), mime: blob.type })));
    return { files: here.map(({ item, blob }, k) => ({ name: names[k], blob, date: new Date(item.card.createdAt) })), missing: items.length - here.length };
  };
  const notHere = (n: number, of: number) =>
    n === of ? (n === 1 ? "This photo hasn't been uploaded from its device yet." : "These photos haven't been uploaded from their devices yet.") : `${count(n)} left out: not uploaded from ${n === 1 ? 'its device' : 'their devices'} yet`;

  const download = async (items: readonly PhotoItem[]) => {
    const { files, missing } = await gather(items);
    if (!files.length) return toast(notHere(missing, items.length));
    if (files.length === 1) save(files[0].blob, files[0].name);
    else {
      const stored = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.blob.arrayBuffer()), date: f.date })));
      save(new Blob(zip(stored) as BlobPart[], { type: 'application/zip' }), `Photos ${today}.zip`);
    }
    if (missing) toast(notHere(missing, items.length));
  };

  const share = async (items: readonly PhotoItem[]) => {
    const { files, missing } = await gather(items);
    if (!files.length) return toast(notHere(missing, items.length));
    const shared = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
    if (!navigator.canShare({ files: shared })) return toast("This browser can't share these photos.");
    try {
      await navigator.share({ files: shared });
      if (missing) toast(notHere(missing, items.length));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      // Getting the photos took long enough for the browser to stop taking it as the press; they're quicker now.
      toast(e instanceof Error && e.name === 'NotAllowedError' ? 'Press Share again to share them.' : "Couldn't share the photos.");
    }
  };

  /**
   * Takes the photos out of every entry they're in that the journal shows (not templates, not archived ones), as
   * the Photos page has a photo in two entries once. Entries this account can't change are left alone and counted.
   */
  const remove = async (items: readonly PhotoItem[]) => {
    const ids = new Set(items.map((i) => i.id));
    const holders = index.live.filter((c) => (c.type === 'note' || c.type === 'todo') && !c.archived && !c.template && cardPhotoIds(c).some((id) => ids.has(id)));
    const steps = holders.filter((c) => may(c).edit).flatMap((c) => {
      const patch = withoutPhotos(c, ids);
      return patch ? [{ id: c.id, patch }] : [];
    });
    const skipped = holders.length - steps.length;
    if (!steps.length) return toast(items.length === 1 ? "This photo is in an entry you can't change." : "These photos are in entries you can't change.");
    const action = repo.action();
    await Promise.all(steps.map((s) => repo.update(s.id, s.patch)));
    toast(`Removed ${count(ids.size)} from ${entries(steps.length)}${skipped ? `; ${entries(skipped)} couldn't be changed` : ''}`, {
      action: { label: 'Undo', run: () => void undoAction(action) },
    });
  };

  return { download, share, remove };
}
