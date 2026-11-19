import { useEffect, useState, useSyncExternalStore } from 'react';
import { permissions } from '../domain/access';
import { daysLeft, isFile, TRASH_DAYS, type StoredAttachment } from '../domain/attachments';
import { displayTitle } from '../domain/content';
import type { JSONNode } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { SyncOffline } from '../sync/engine';
import { PhotoViewer } from './Attachments';
import { usePhotoUrl } from './editor/photo';
import { fileKind, showsInTab, useFileActions } from './files';
import { fileSize } from '../photos/service';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { useViewOnly, VIEW_ONLY_NOTE } from './viewOnly';

/**
 * Photos and files taken out of every entry, on the Trash page: each with the entry it was in and the days left
 * before it's deleted, from Google Drive too. Restore puts it back at the end of that entry, or in a new note when
 * the entry can't take it; Delete forever, pressed twice, deletes it now. Asks for a fresh check when it opens.
 * `vaultId` narrows it to one vault, as the sidebar's vault does the Trash.
 */
export function TrashedAttachments({ vaultId }: { vaultId?: string }) {
  const { attachments, vaults, locked } = useCards();
  const { trash, problem } = useSyncExternalStore(attachments.subscribe, attachments.getState);
  const [viewing, setViewing] = useState<number | null>(null);
  useEffect(() => void attachments.sweep(true), [attachments]);

  const shown = (trash ?? []).filter((a) => !vaultId || a.vault_id === vaultId);
  if (!shown.length) return null;
  const photos = shown.filter((a) => !isFile(a));
  const writable = (a: StoredAttachment) => {
    const vault = vaults.find((v) => v.id === a.vault_id);
    return !!vault && (vault.role ?? 'owner') !== 'viewer' && !locked.has(a.vault_id);
  };

  return (
    <section className="section trash-held" aria-label="Photos and files in the Trash">
      <h2>Photos and files</h2>
      <p className="trash-held__note">
        Taken out of their entries. Each is deleted for good {TRASH_DAYS} days after, from Google Drive too.
        {problem === 'offline' && ' Offline: this may not be the latest.'}
      </p>
      <ul className="trash-held__items">
        {shown.map((a) => (
          <TrashedItem key={a.id} item={a} writable={writable(a)} onView={() => setViewing(photos.indexOf(a))} />
        ))}
      </ul>
      {viewing !== null && photos[viewing] && <PhotoViewer ids={photos.map((p) => p.id)} start={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

function TrashedItem({ item, writable, onView }: { item: StoredAttachment; writable: boolean; onView: () => void }) {
  const { index } = useCards();
  const putBack = usePutBack();
  const deleteForever = useDeleteForever();
  const from = item.trashed_from ? index.byId.get(item.trashed_from) : undefined;
  const left = daysLeft(item.trashed_at!, Date.now());
  const file = isFile(item);
  return (
    <li className="trash-held__item">
      {file ? (
        <TrashedFile item={item} />
      ) : (
        <button type="button" className="trash-held__thumb" aria-label="Show the photo" onClick={onView}>
          <TrashedPhoto id={item.id} />
        </button>
      )}
      <span className="trash-held__from" title={from ? displayTitle(from) || 'Untitled' : undefined}>
        {from ? `From “${displayTitle(from) || 'Untitled'}”` : 'From an entry'}
      </span>
      <span className="trash-held__left">{left === 0 ? 'Deleted at the next check' : left === 1 ? '1 day left' : `${left} days left`}</span>
      {writable && (
        <span className="trash-held__actions">
          <button type="button" className="btn" onClick={() => void putBack(item)}>
            <Icon name="undo" size={16} />
            Restore
          </button>
          <ConfirmDelete what={file ? 'file' : 'photo'} onDelete={() => void deleteForever(item)} />
        </span>
      )}
    </li>
  );
}

/** A file, as a tile the size of a photo's: its kind, name and size, pressed to open or download it. */
function TrashedFile({ item }: { item: StoredAttachment }) {
  const act = useFileActions();
  const file = { id: item.id, name: item.name ?? 'Untitled', mime: item.mime, size: item.size };
  return (
    <button type="button" className="trash-held__thumb trash-held__file" title={showsInTab(file.mime) ? `Open ${file.name}` : `Download ${file.name}`} onClick={() => void act(file)}>
      <span className="file-chip__icon" aria-hidden="true">
        <Icon name="file" size={18} />
      </span>
      <span className="trash-held__file-name">{file.name}</span>
      <span className="trash-held__file-detail">
        {fileSize(file.size)} · {fileKind(file.name)}
      </span>
    </button>
  );
}

function TrashedPhoto({ id }: { id: string }) {
  const { url } = usePhotoUrl(id);
  return url ? <img src={url} alt="" draggable={false} /> : <Icon name="image" size={20} />;
}

/** Delete forever, pressed twice: the first press asks, for a few seconds; it can't be undone. */
function ConfirmDelete({ what, onDelete }: { what: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(timer);
  }, [asking]);
  return asking ? (
    <button type="button" className="btn btn--danger" onClick={onDelete} onBlur={() => setAsking(false)} autoFocus>
      Delete for good?
    </button>
  ) : (
    <button type="button" className="icon-btn" aria-label={`Delete this ${what} forever`} title={`Delete forever, from Google Drive too`} onClick={() => setAsking(true)}>
      <Icon name="trash" />
    </button>
  );
}

/** Puts a photo or file back: at the end of the entry it was in, or in a new note in its vault when that can't take it. */
function usePutBack() {
  const { index, repo, attachments, vaults, shared } = useCards();
  const viewOnly = useViewOnly();
  const toast = useToast();
  return async (a: StoredAttachment) => {
    if (viewOnly) return toast(VIEW_ONLY_NOTE);
    const node: JSONNode = isFile(a) ? { type: 'file', attrs: { id: a.id, name: a.name ?? 'Untitled', mime: a.mime, size: a.size } } : { type: 'photo', attrs: { id: a.id } };
    const from = a.trashed_from ? index.byId.get(a.trashed_from) : undefined;
    // The entry's own permissions: everything shown in the Trash counts as read only, but the entry isn't in it.
    if (from && from.type !== 'tag' && !from.deleted && permissions(from, vaults, shared).edit) {
      await repo.update(from.id, { content: { ...from.content, content: [...(from.content.content ?? []), node] } });
      toast(`Put back in “${displayTitle(from) || 'Untitled'}”`);
    } else {
      await repo.createNote({ vaultId: a.vault_id, content: { type: 'doc', content: [node] } });
      toast('Put back, in a new note');
    }
    await attachments.restore(a.id);
  };
}

function useDeleteForever() {
  const { attachments } = useCards();
  const viewOnly = useViewOnly();
  const toast = useToast();
  return async (a: StoredAttachment) => {
    if (viewOnly) return toast(VIEW_ONLY_NOTE);
    const what = isFile(a) ? 'file' : 'photo';
    try {
      const result = await attachments.deleteForever(a.id);
      toast(
        result === 'ok' || result === 'gone'
          ? `Deleted the ${what} for good`
          : result === 'in_use'
            ? `It's in an entry again, so the ${what} was kept`
            : result === 'needs_drive'
              ? "Google Drive isn't connected for its vault's owner, so it can't be deleted yet"
              : `Couldn't delete the ${what}. Try again later.`,
      );
    } catch (err) {
      toast(err instanceof SyncOffline ? `You're offline. Delete the ${what} when you're back online.` : `Couldn't delete the ${what}. Try again later.`);
    }
  };
}
