import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fetchDriveLink, shareDriveLink, stopDriveLink, type DriveLink, type ShareLinkResult } from '../sync/http';
import type { Vault } from '../domain/types';
import { writeClipboard } from './entryActions';
import { Item } from './EntryMenu';
import { useToast } from './Toast';
import { openOutside } from './translate';

/** What's known of each one's Drive link this visit, so a menu opened again, or a chip's button, shows it at once. */
const known = new Map<string, DriveLink>();

/**
 * Copies text that may still be on its way. Safari takes a clipboard write only straight from the click, so the item
 * is made at once with the text to come, as `useCopyPhoto` does with a picture.
 */
function copyComing(text: Promise<string>): Promise<boolean> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
    // Its failure is answered below; a clipboard that gives up first never looks at it.
    blob.catch(() => undefined);
    return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]).then(
      () => true,
      () => text.then(writeClipboard, () => false),
    );
  }
  return text.then(writeClipboard, () => false);
}

export type Noun = 'photo' | 'video' | 'file';

/**
 * Shares one by its Drive link and copies the link, saying how it went: from a right-click menu or a file chip's
 * button. One already shared, as far as this visit knows, has its link copied again.
 */
export function useShareLink() {
  const toast = useToast();
  const navigate = useNavigate();
  return (id: string, noun: Noun, link: DriveLink | null = known.get(id) ?? null) => {
    const result: Promise<ShareLinkResult> = link?.url ? Promise.resolve({ url: link.url }) : shareDriveLink(id);
    const copied = copyComing(result.then((r) => ('url' in r ? r.url : Promise.reject(new Error(r.error)))));
    void Promise.all([result, copied]).then(([r, ok]) => {
      if ('error' in r) return toast(problem(r.error, noun), r.error === 'needs_drive' ? { action: { label: 'Settings', run: () => void navigate('/settings') } } : undefined);
      known.set(id, { url: r.url, can: link?.can ?? true });
      const open = { label: 'Open', run: () => openOutside(r.url) };
      const shared = link?.url ? 'Copied its public link' : 'Shared publicly on Google Drive, and copied its link';
      toast(ok ? `${shared}. Anyone with it can open this ${noun}.` : `Shared publicly on Google Drive, but the link couldn't be copied here.`, { action: open });
    });
  };
}

/** Whether this account may share what's in a vault by link: one it can change, and not private (encrypted). */
export const canShareIn = (vault: Vault | undefined) => !!vault && vault.role !== 'viewer' && !vault.encryption;

/**
 * A photo, video or file right-clicked anywhere: Share via public link shares it from the vault owner's Google Drive, so
 * anyone with the link can open it there, and copies the link. The name says it's public, as Drive's "anyone with the
 * link" is. Once it's shared, Copy public link copies it again and Stop sharing link takes it back.
 * For those who can change its vault, unless the vault is private (encrypted); one who only views it gets the link
 * if it's shared already.
 */
export function DriveLinkItems({ id, noun, onClose }: { id: string; noun: Noun; onClose: () => void }) {
  const [link, setLink] = useState<DriveLink | null>(() => known.get(id) ?? null);
  const toast = useToast();
  const share = useShareLink();
  useEffect(() => {
    let live = true;
    fetchDriveLink(id).then(
      (got) => {
        known.set(id, got);
        if (live) setLink(got);
      },
      // Offline, or gone: Share via public link stays, and says so if pressed.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [id]);

  if (link && !link.can && !link.url) return null;

  const copy = () => {
    onClose();
    share(id, noun, link);
  };

  const stop = () => {
    onClose();
    void stopDriveLink(id).then((ok) => {
      if (ok) known.set(id, { url: null, can: true });
      toast(ok ? `Stopped sharing. Its public link no longer opens this ${noun}.` : "Couldn't stop sharing it. Check the connection and try again.");
    });
  };

  return (
    <div className="style-menu__group">
      <Item icon="share" onClick={copy}>
        {link?.url ? 'Copy public link' : 'Share via public link'}
      </Item>
      {link?.url && link.can && (
        <Item icon="lock" onClick={stop}>
          Stop sharing link
        </Item>
      )}
    </div>
  );
}

function problem(error: Exclude<ShareLinkResult, { url: string }>['error'], noun: Noun): string {
  switch (error) {
    case 'drive_refused':
      return "Google Drive won't share it by link: this Google account doesn't allow links anyone can open.";
    case 'not_uploaded':
      return `This ${noun} isn't in Google Drive yet. Try again once it has uploaded.`;
    case 'not_in_drive':
      return `This ${noun} isn't in a Google Drive (the demo's aren't), so it has no Drive link.`;
    case 'needs_drive':
      return 'Connect Google Drive in Settings to share by a Drive link.';
    default:
      return "Couldn't share it on Google Drive. Check the connection and try again.";
  }
}
