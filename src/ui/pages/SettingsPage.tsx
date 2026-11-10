import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { makeBackup, markdownFiles, parseBackup, zipMarkdown } from '../../domain/backup';
import { displayTitle } from '../../domain/content';
import { useAccount } from '../../auth/AuthContext';
import { useCards, useSyncStatus, useToday } from '../../state/CardsContext';
import { describeSync } from '../../sync/engine';
import { Empty, Page, Section } from '../components';
import { useToast } from '../Toast';
import { AiAppsSection } from './ai';
import { PhotosSection } from './photosSettings';

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SettingsPage() {
  const { index, repo, engine, locked } = useCards();
  const { account, signOut } = useAccount();
  const sync = useSyncStatus();
  const today = useToday();
  const toast = useToast();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  const exportMarkdown = () => {
    const files = markdownFiles(index);
    download(zipMarkdown(files) as BlobPart, `notes-markdown-${today}.zip`, 'application/zip');
    toast(`Exported ${files.length} ${files.length === 1 ? 'card' : 'cards'} as Markdown`);
  };

  const exportBackup = async () => {
    const { vaults, cards } = await repo.exportAll(locked);
    download(JSON.stringify(makeBackup(vaults, cards), null, 1), `notes-backup-${today}.json`, 'application/json');
    toast(`Backed up ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}${locked.size ? '. Locked vaults were left out' : ''}`);
  };

  const restore = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = await repo.importBackup(parseBackup(await file.text()));
      toast(`Restored: ${r.added} added, ${r.updated} updated, ${r.skipped} already current`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That backup could not be restored.');
    }
  };

  return (
    <Page title="Backup & settings">
      <Section title="Account">
        <p className="prose-note">
          Signed in as {account.name} ({account.email}). {describeSync(sync)}
          {sync.lastSyncedAt ? `, last synced at ${new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.
        </p>
        <div className="button-row">
          <button type="button" className="btn" disabled={sync.state === 'syncing'} onClick={() => void engine.sync()}>
            Sync now
          </button>
          <button type="button" className="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </Section>
      <Section title="Storage">
        <p className="prose-note">
          {persisted === null && 'Checking how this browser stores your notes.'}
          {persisted === true && 'This browser has agreed to keep your notes when storage runs low.'}
          {persisted === false && 'This browser may clear your notes if storage runs low. Installing the app makes that less likely, and a backup protects you either way.'}
        </p>
      </Section>
      <Section title="Backup">
        <p className="prose-note">Your notes sync to your account. A backup is an extra copy you control. Unlock a private vault first to include it.</p>
        <div className="button-row">
          <button type="button" className="btn btn--primary" onClick={() => void exportBackup()}>
            Download backup
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            Restore from backup
          </button>
          <button type="button" className="btn" onClick={exportMarkdown}>
            Export as Markdown
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void restore(e)} />
        </div>
      </Section>
      <PhotosSection />
      <AiAppsSection />
      <Section title={`Trash (${index.trash.length})`}>
        {index.trash.length ? (
          <div className="list">
            {index.trash.map((c) => (
              <div className="row" key={c.id}>
                <span className="row__body">
                  <span className="row__title">{displayTitle(c)}</span>
                  <span className="row__preview">{c.type}</span>
                </span>
                <button type="button" className="btn" onClick={() => void repo.setDeleted(c.id, false)}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Trash is empty.</Empty>
        )}
      </Section>
    </Page>
  );
}
