import { strToU8, zipSync } from 'fflate';
import { linkTitle, resolveTags, type CardIndex } from './cardIndex';
import { toMarkdown } from './markdown';
import { modernCard } from './payload';
import { isRepeat, repeatWord } from './repeat';
import { isDateKey, isTimeKey } from './dates';
import { CARD_TYPES, isCardColor, type Card, type Vault } from './types';

export interface MarkdownFile {
  path: string;
  text: string;
}

const FOLDER = { note: 'notes', todo: 'todos', tag: 'tags' } as const;

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
    const base = safeName(card.title);
    let path = `${FOLDER[card.type]}/${base}.md`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${FOLDER[card.type]}/${base} (${n}).md`;
    used.add(path.toLowerCase());

    const front = [`id: ${card.id}`, `type: ${card.type}`];
    front.push(`title: ${yamlString(card.title)}`);
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
    const heading = `# ${card.title}\n\n`;
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

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optional = <T>(v: T | undefined, ok: (v: T) => boolean) => v === undefined || ok(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Everything the app reads from a card is there and of the right kind, so a hand-edited backup can't bring in a card that breaks it. */
function isCard(value: unknown): value is Card {
  const c = value as Partial<Card> | null;
  if (
    !c ||
    typeof c !== 'object' ||
    typeof c.id !== 'string' ||
    !c.id ||
    typeof c.vaultId !== 'string' ||
    !isTime(c.updatedAt) ||
    !isTime(c.createdAt) ||
    !optional(c.deleted, (d) => typeof d === 'boolean') ||
    typeof c.title !== 'string' ||
    typeof c.content !== 'object' ||
    c.content === null ||
    c.content.type !== 'doc' ||
    !isStrings(c.tags) ||
    !optional(c.color, (color) => color === null || isCardColor(color)) ||
    !CARD_TYPES.includes(c.type as Card['type'])
  ) {
    return false;
  }
  if (c.type === 'todo') {
    return (
      (c.status === 'open' || c.status === 'done') &&
      (c.due === null || isDateKey(c.due)) &&
      optional(c.dueTime, (t) => t === null || isTimeKey(t)) &&
      optional(c.repeat, (r) => r === null || isRepeat(r)) &&
      (c.completedAt === null || isTime(c.completedAt))
    );
  }
  if (c.type === 'tag') {
    return (
      typeof c.pinned === 'boolean' &&
      optional(c.members, isStrings) &&
      optional(c.choice, (choice) => choice === 'one' || choice === 'many') &&
      optional(c.ordered, (o) => typeof o === 'boolean')
    );
  }
  return true;
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
  // A backup from before the diary was a vault holds diary cards, which come back as notes.
  const cards = Array.isArray(data.cards) ? data.cards.map((c) => (c && typeof c === 'object' ? modernCard(c) : c)) : null;
  if (!cards || !cards.every(isCard) || !Array.isArray(data.vaults)) {
    throw new Error('That backup is damaged: some cards are missing required fields.');
  }
  return { ...data, cards } as Backup;
}
