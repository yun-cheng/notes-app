import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { makeBackup, markdownFiles, parseBackup, zipMarkdown } from '../../domain/backup';
import { displayTitle } from '../../domain/content';
import { useCards, useToday } from '../../state/CardsContext';
import { Empty, Page, Section } from '../components';
import { useToast } from '../Toast';

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SettingsPage() {
  const { index, repo } = useCards();
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
    const { vaults, cards } = await repo.exportAll();
    download(JSON.stringify(makeBackup(vaults, cards), null, 1), `notes-backup-${today}.json`, 'application/json');
    toast(`Backed up ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`);
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
      <Section title="Storage">
        <p className="prose-note">
          {persisted === null && 'Checking how this browser stores your notes.'}
          {persisted === true && 'This browser has agreed to keep your notes when storage runs low.'}
          {persisted === false && 'This browser may clear your notes if storage runs low. Installing the app makes that less likely, and a backup protects you either way.'}
        </p>
      </Section>
      <Section title="Backup">
        <p className="prose-note">Notes live only on this device until sync is built. Keep a backup somewhere safe.</p>
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
