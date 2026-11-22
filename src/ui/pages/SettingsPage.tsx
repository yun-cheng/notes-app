import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { count } from '../../domain/plural';
import { formatClock } from '../../domain/dates';
import { makeBackup, markdownFiles, parseBackup, zipMarkdown } from '../../domain/backup';
import { filesFromZip, IMPORT_LIMIT, IMPORTABLE, readImport, type TextFile } from '../../domain/importNotes';
import { isDemoAccount } from '../../auth/account';
import { useAccount } from '../../auth/AuthContext';
import { useCards, useSyncStatus, useToday } from '../../state/CardsContext';
import { describeSync } from '../../sync/engine';
import { Page, Section } from '../components';
import { ClipboardSection } from '../ClipboardSection';
import { DisplaySection } from '../DisplaySection';
import { RemindersSection } from '../RemindersSection';
import { useToast } from '../Toast';
import { useSaveEntries } from '../useSaveEntry';
import { useUndo } from '../useUndo';
import { AiAppsSection } from './ai';
import { PhotosSection } from './photosSettings';
import { DeleteAccountSection } from '../DeleteAccountSection';

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
  const importInput = useRef<HTMLInputElement>(null);
  const { saveEntries } = useSaveEntries();
  const { undoButton } = useUndo();

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  const exportMarkdown = () => {
    const files = markdownFiles(index);
    download(zipMarkdown(files) as BlobPart, `notes-markdown-${today}.zip`, 'application/zip');
    toast(`Exported ${count(files.length, 'card')} as Markdown`);
  };

  const exportBackup = async () => {
    const { vaults, cards } = await repo.exportAll(locked);
    download(JSON.stringify(makeBackup(vaults, cards), null, 1), `notes-backup-${today}.json`, 'application/json');
    toast(`Backed up ${count(cards.length, 'card')}${locked.size ? '. Locked vaults were left out' : ''}`);
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

  const importFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!picked.length) return;
    try {
      const files: TextFile[] = [];
      for (const file of picked) {
        if (/\.zip$/i.test(file.name)) files.push(...filesFromZip(new Uint8Array(await file.arrayBuffer())));
        else if (IMPORTABLE.test(file.name)) files.push({ path: file.name, text: await file.text(), modified: file.lastModified || undefined });
      }
      if (!files.length) return toast('No Markdown or text files to import there');
      if (files.length > IMPORT_LIMIT) return toast(`That's ${files.length} files; import up to ${IMPORT_LIMIT} at a time`);
      const plan = readImport(files, index, repo.newId);
      const left = [plan.already && `${plan.already} already here`, plan.skipped && `${plan.skipped} skipped`].filter(Boolean).join(', ');
      if (!plan.entries.length) return toast(`Nothing new to import${left ? ` (${left})` : ''}`);
      const { saved, action } = await saveEntries(plan.entries);
      if (!saved) return;
      toast(`Imported ${count(saved, 'entry', 'entries')}${left ? `; ${left}` : ''}`, action ? { action: undoButton(action) } : undefined);
    } catch (err) {
      console.error('Import failed', err);
      toast('Those files could not be imported.');
    }
  };

  return (
    <Page title="Backup & settings" viewOnly={false}>
      <Section title="Account">
        <p className="prose-note">
          Signed in as {account.name} ({account.email}). {describeSync(sync)}
          {sync.lastSyncedAt ? `, last synced at ${formatClock(sync.lastSyncedAt)}` : ''}.
        </p>
        {isDemoAccount(account) && (
          <div className="banner">
            <span>
              This is the demo account on your local server, for trying the app. Running <code>npm run demo</code> puts its sample notes
              back as they were and keeps anything you added, but keep notes that matter in your own account: sign out, then sign in
              with Google.
            </span>
          </div>
        )}
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
      <Section title="Import">
        <p className="prose-note">
          Bring in notes from Markdown or text files, or a zip of them, like a folder from Obsidian or Bear, or this app's Markdown export. Each file becomes an entry, titled by its
          front matter, its first heading or its name, with the front matter's tags, date and todo fields. Links between the files are kept.
        </p>
        <div className="button-row">
          <button type="button" className="btn" onClick={() => importInput.current?.click()}>
            Import Markdown
          </button>
          <input ref={importInput} type="file" multiple accept=".md,.markdown,.mdown,.txt,.zip,text/markdown,text/plain,application/zip" hidden onChange={(e) => void importFiles(e)} />
        </div>
      </Section>
      <RemindersSection />
      <DisplaySection />
      <ClipboardSection />
      <PhotosSection />
      <AiAppsSection />
      <DeleteAccountSection onExport={exportMarkdown} />
    </Page>
  );
}
