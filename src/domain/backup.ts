import { strToU8, zipSync } from 'fflate';
import { linkTitle, resolveTags, type CardIndex } from './cardIndex';
import { toMarkdown } from './markdown';
import { repeatWord } from './repeat';
import { CARD_TYPES, type Card, type Vault } from './types';

export interface MarkdownFile {
  path: string;
  text: string;
}

const FOLDER = { note: 'notes', todo: 'todos', diary: 'diary', tag: 'tags' } as const;

function safeName(title: string): string {
  const name = title.replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return name.slice(0, 80).trim() || 'Untitled';
}

const yamlString = (s: string) => JSON.stringify(s);
const iso = (ms: number) => new Date(ms).toISOString();

export function markdownFiles(index: CardIndex): MarkdownFile[] {
  const used = new Set<string>();
  const titleOf = (id: string, fallback: string) => linkTitle(index, id, fallback);

  return index.live.map((card) => {
    const base = card.type === 'diary' ? card.date : safeName(card.title);
    let path = `${FOLDER[card.type]}/${base}.md`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${FOLDER[card.type]}/${base} (${n}).md`;
    used.add(path.toLowerCase());

    const front = [`id: ${card.id}`, `type: ${card.type}`];
    if (card.type !== 'diary') front.push(`title: ${yamlString(card.title)}`);
    if (card.type === 'diary') front.push(`date: ${card.date}`);
    if (card.type === 'todo') {
      front.push(`status: ${card.status}`);
      if (card.due) front.push(`due: ${card.due}`);
      if (card.due && card.dueTime) front.push(`time: "${card.dueTime}"`);
      if (card.due && card.repeat) front.push(`repeat: ${repeatWord(card.repeat)}`);
    }
    const tags = resolveTags(index, card.tags);
    if (tags.length) front.push(`tags: [${tags.map((t) => yamlString(t.title)).join(', ')}]`);
    front.push(`created: ${iso(card.createdAt)}`, `updated: ${iso(card.updatedAt)}`);

    const body = toMarkdown(card.content, titleOf);
    const heading = card.type === 'diary' ? '' : `# ${card.title}\n\n`;
    return { path, text: `---\n${front.join('\n')}\n---\n\n${heading}${body}\n` };
  });
}

export function zipMarkdown(files: MarkdownFile[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.path, strToU8(f.text)])));
}

export const BACKUP_FORMAT = 'notes-app-backup';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  vaults: Vault[];
  cards: Card[];
}

export function makeBackup(vaults: Vault[], cards: Card[], now = Date.now()): Backup {
  return { format: BACKUP_FORMAT, version: 1, exportedAt: iso(now), vaults, cards };
}

function isCard(value: unknown): value is Card {
  const c = value as Partial<Card> | null;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.vaultId === 'string' &&
    typeof c.updatedAt === 'number' &&
    typeof c.title === 'string' &&
    typeof c.content === 'object' &&
    c.content !== null &&
    Array.isArray(c.tags) &&
    CARD_TYPES.includes(c.type as Card['type'])
  );
}

/** Throws a user-readable error if `text` isn't a backup this app can restore. */
export function parseBackup(text: string): Backup {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (data.format !== BACKUP_FORMAT) throw new Error('That file is not a backup from this app.');
  if (data.version !== 1) throw new Error(`This backup uses version ${String(data.version)}, which this app can't read.`);
  if (!Array.isArray(data.cards) || !data.cards.every(isCard) || !Array.isArray(data.vaults)) {
    throw new Error('That backup is damaged: some cards are missing required fields.');
  }
  return data as Backup;
}
