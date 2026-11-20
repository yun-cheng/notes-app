import { createContext, useContext, type MouseEvent } from 'react';
import type { FileInfo } from '../domain/content';
import { fileSize } from '../photos/service';
import { useCards } from '../state/CardsContext';
import { canChangeInTheOpen } from '../domain/access';
import { useShareLink } from './driveLink';
import { Icon } from './Icon';
import { useToast } from './Toast';

/**
 * Kinds of file the browser shows itself, safely, in a tab of its own: a PDF, a picture (not SVG, which can run
 * code), plain text, sound and video. Any other kind downloads, so a web page someone attached can't run as the app.
 */
const SHOWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp|avif)|text\/plain|audio\/[\w.+-]+|video\/[\w.+-]+)$/;
export const showsInTab = (mime: string | null) => !!mime && SHOWABLE.test(mime);

/** A short label for a file's kind, from its name: "PDF", "CSV", or "File". */
export function fileKind(name: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  return ext ? ext.toUpperCase() : 'File';
}

/**
 * Opening and saving an attached file, from this device or the server. One the browser can show opens in a new tab;
 * any other kind, or `save`, downloads under its name. The tab opens at once, so it isn't taken for a pop-up, and
 * fills in when the file is here.
 */
export function useFileActions() {
  const { photos } = useCards();
  const toast = useToast();
  return async (file: FileInfo, save = false) => {
    const show = !save && showsInTab(file.mime);
    const tab = show ? window.open('about:blank', '_blank') : null;
    try {
      const blob = await photos.blob(file.id);
      if (!blob) {
        tab?.close();
        toast("This file hasn't been uploaded from its device yet.");
        return;
      }
      // The type it was added with, if it's one to show; the bytes as they are otherwise, whatever they claim to be.
      const url = URL.createObjectURL(new Blob([blob], { type: show ? file.mime! : 'application/octet-stream' }));
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
    } catch {
      tab?.close();
      toast('This file isn’t available offline.');
    }
  };
}

/** The vault of the entry an editor shows, for its file chips, which can't be told it themselves. */
export const FileVault = createContext<string | undefined>(undefined);

/**
 * A file attached to an entry, as a chip: its kind, name and size. Pressing it opens the file, or downloads one the
 * browser can't show; the arrow always downloads, and the share button beside it shares it by a public Google Drive
 * link and copies the link, for one who can change its vault, unless that's private (encrypted).
 */
export function FileChip({ file, vaultId }: { file: FileInfo; vaultId?: string }) {
  const act = useFileActions();
  const { vaults } = useCards();
  const inVault = useContext(FileVault);
  const sharable = canChangeInTheOpen(vaults.find((v) => v.id === (vaultId ?? inVault)));
  const share = useShareLink();
  const stop = (e: MouseEvent) => e.stopPropagation();
  const detail = [file.size !== null ? fileSize(file.size) : null, fileKind(file.name)].filter(Boolean).join(' · ');
  return (
    <span className="file-chip">
      <button type="button" className="file-chip__open" title={showsInTab(file.mime) ? `Open ${file.name}` : `Download ${file.name}`} onClick={(e) => (stop(e), void act(file))}>
        <span className="file-chip__icon" aria-hidden="true">
          <Icon name="file" size={16} />
        </span>
        <span className="file-chip__text">
          <span className="file-chip__name">{file.name}</span>
          <span className="file-chip__detail">{detail}</span>
        </span>
      </button>
      {sharable && (
        <button type="button" className="file-chip__save" aria-label={`Share ${file.name} via a public link`} title="Share via public link (anyone with it can open it)" onClick={(e) => (stop(e), share(file.id, 'file'))}>
          <Icon name="share" size={16} />
        </button>
      )}
      <button type="button" className="file-chip__save" aria-label={`Download ${file.name}`} title="Download" onClick={(e) => (stop(e), void act(file, true))}>
        <Icon name="download" size={16} />
      </button>
    </span>
  );
}
