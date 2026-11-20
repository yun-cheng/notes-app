/**
 * Fills the local server with a demo account that shows what the app does, so it can be tried without a Google
 * sign-in: folders and tags, tag groups with colors (a Priority to sort by and show as a board, and a many-choice
 * Topics), todos for the board by todo state, notes with headings, lists, checklists, quotes, code, web links and links to each other, todos
 * overdue, due today at a time, upcoming, undated, repeating, waiting, done and archived, entries tinted, set to view
 * only or with their own preview style, photos of every shape, one on a card's back page (served by the dev server from scripts/demoPhotos),
 * files attached (a PDF, a CSV, and a text file on the publicly linked recipe, from scripts/demoFiles), videos with their stills (one in the coast trip, one on the recipe, one in the Trash), voice messages (one transcribed with a quiet one just after it, one not yet, one in the Diary, which isn't sent to be), a private and encrypted Diary vault, a Health vault locked by the PIN but not encrypted, a vault shared with Sam and one Sam
 * shares to view, a card also in another vault, a note Sam shares, a public link, comments open and resolved, and
 * version history from more than one device, and entries going back three years. Two entries carry nearly all of it at once, to see how a full one looks:
 * a launch plan note and a moving todo.
 * Run with `npm run demo` while `npm run dev:api` is running. Running it again puts the demo's own cards back as they
 * were, dated around today, and keeps anything else in the accounts.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createVaultKey, encryptPayload, unlockWithPin } from '../src/crypto/vaultKeys';
import { addDays, toDateKey } from '../src/domain/dates';
import { hashPin } from '../src/domain/pin';
import type { CardColor, CardPayload, CardRecord, JSONNode, NoteCard, Repeat, Vault } from '../src/domain/types';
import { PUSH_LIMIT, type SessionInfo } from '../src/sync/protocol';

const API = 'http://localhost:8788/api';
export const DEMO_PIN = '1234';
const SESSION_FILE = '.wrangler/demo-session.json';

const DEMO = { id: 'u-demo', sub: 'demo-local-1', email: 'demo@demo.test', name: 'Demo', token: 'demo-local-session' };
const SAM = { id: 'u-demo-sam', sub: 'demo-local-2', email: 'sam@demo.test', name: 'Sam', token: 'demo-local-session-sam' };
type Person = typeof DEMO;

// ---- Document helpers ----

const text = (t: string, marks?: string[]): JSONNode => ({ type: 'text', text: t, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...parts: (string | JSONNode)[]): JSONNode => ({ type: 'paragraph', content: parts.map((x) => (typeof x === 'string' ? text(x) : x)) });
const h = (t: string): JSONNode => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] });
const items = (type: 'bulletList' | 'orderedList', lines: string[]): JSONNode => ({
  type,
  content: lines.map((l) => ({ type: 'listItem', content: [p(l)] })),
});
const bullets = (...lines: string[]) => items('bulletList', lines);
const steps = (...lines: string[]) => items('orderedList', lines);
/** A checklist: each item's words, and whether it's ticked. */
const checklist = (...entries: [string, boolean][]): JSONNode => ({
  type: 'taskList',
  content: entries.map(([t, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [p(t)] })),
});
const quote = (t: string): JSONNode => ({ type: 'blockquote', content: [p(t)] });
/** A list item with a list of its own under it. */
const nested = (t: string | JSONNode, list: JSONNode): JSONNode => ({ type: 'listItem', content: [typeof t === 'string' ? p(t) : t, list] });
const list = (type: 'bulletList' | 'orderedList', ...entries: (string | JSONNode)[]): JSONNode => ({
  type,
  content: entries.map((e) => (typeof e === 'string' ? { type: 'listItem', content: [p(e)] } : e)),
});
const rule: JSONNode = { type: 'horizontalRule' };
const h3 = (t: string): JSONNode => ({ type: 'heading', attrs: { level: 3 }, content: [text(t)] });
/** A code block, colored by its language (like typing ```js). */
const code = (language: string, ...ls: string[]): JSONNode => ({ type: 'codeBlock', attrs: { language }, content: [text(ls.join('\n'))] });
const doc = (...blocks: JSONNode[]): JSONNode => ({ type: 'doc', content: blocks });
const lines = (...ls: string[]) => doc(...ls.map((l) => (l ? p(l) : { type: 'paragraph' })));

// ---- Time helpers ----

const today = toDateKey(new Date());
/** A moment `days` ago at the given local time. */
function at(days: number, hour: number, minute = 0): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return Math.min(d.getTime(), Date.now() - 60_000);
}
/** A moment `minutes` before now, for things written today whatever the time is. */
const ago = (minutes: number) => Date.now() - minutes * 60_000;

// ---- Local database ----

const sha256 = async (s: string) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('base64url');

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Makes the demo accounts if they're missing and takes out the demo's own cards (IDs starting `demo-`), with their
 * history, comments and shares, so they can go in again dated around today. Everything else in the accounts is
 * kept: vaults and notes added by hand while trying the app survive a rerun.
 */
async function prepareAccounts(people: Person[]) {
  const ids = people.map((u) => sql(u.id)).join(', ');
  const vaults = `SELECT id FROM vaults WHERE owner_id IN (${ids})`;
  const seeded = `SELECT id FROM cards WHERE id LIKE 'demo-%' AND vault_id IN (${vaults})`;
  const now = Date.now();
  const statements = [
    `DELETE FROM card_shares WHERE card_id IN (${seeded})`,
    `DELETE FROM card_share_invites WHERE card_id IN (${seeded})`,
    `DELETE FROM public_links WHERE card_id IN (${seeded})`,
    `DELETE FROM comments WHERE card_id IN (${seeded})`,
    `DELETE FROM card_versions WHERE card_id IN (${seeded})`,
    `DELETE FROM cards WHERE id LIKE 'demo-%' AND vault_id IN (${vaults})`,
  ];
  for (const u of people) {
    const vault = `vault-${u.id}`;
    const diary = `diary-${u.id}`;
    statements.push(
      `INSERT OR IGNORE INTO users (id, google_sub, email, name, created_at) VALUES (${sql(u.id)}, ${sql(u.sub)}, ${sql(u.email)}, ${sql(u.name)}, ${now})`,
      `INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at) VALUES (${sql(await sha256(u.token))}, ${sql(u.id)}, ${now + 30 * 86_400_000})`,
      `INSERT OR IGNORE INTO vaults (id, owner_id, name, created_at) VALUES (${sql(vault)}, ${sql(u.id)}, 'Personal', ${now})`,
      `INSERT OR IGNORE INTO vault_members (vault_id, user_id, role) VALUES (${sql(vault)}, ${sql(u.id)}, 'owner')`,
      // Made at sign-in for a real account, like the default vault.
      `INSERT OR IGNORE INTO vaults (id, owner_id, name, created_at) VALUES (${sql(diary)}, ${sql(u.id)}, 'Diary', ${now + 1})`,
      `INSERT OR IGNORE INTO vault_members (vault_id, user_id, role) VALUES (${sql(diary)}, ${sql(u.id)}, 'owner')`,
    );
  }
  runSql(statements);
}

/** Runs SQL on the local database. */
function runSql(statements: string[]) {
  mkdirSync('.wrangler', { recursive: true });
  writeFileSync('.wrangler/demo.sql', statements.join(';\n') + ';\n');
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'notes-app', '--local', '--file', '.wrangler/demo.sql'], { stdio: 'ignore' });
}

/**
 * Photos and files taken out of every entry wait in the Trash (`GET /api/attachments`), so the demo has three there,
 * served by the dev server like its others: a second, crooked shot of the lake and a video panning over it (with its
 * still, which goes with it), out of the Summer trip a couple of hours ago, and the Kyoto itinerary's first draft, out of the Kyoto note 27 days ago, so it shows 3 days left. With no
 * Drive file, deleting one only forgets it. The demo's other photos have a record too (`heldAttachments`), but as
 * entries hold them, nothing sends them to the Trash.
 */
function trashedAttachments(owner: string, family: string, personal: string) {
  // A video's width, height and length, as the device that added it would have sent them.
  const row = (id: string, vault: string, mime: string, size: number, added: number, trashed: number, from: string, name: string | null, [w, h, d]: (number | null)[] = [null, null, null]) =>
    `INSERT INTO attachments (id, owner_id, vault_id, drive_file_id, mime, size, width, height, duration, created_at, trashed_at, trashed_from, name) VALUES (${[id, owner, vault, '', mime].map(sql).join(', ')}, ${size}, ${w ?? 'NULL'}, ${h ?? 'NULL'}, ${d ?? 'NULL'}, ${added}, ${trashed}, ${sql(from)}, ${name ? sql(name) : 'NULL'})`;
  runSql([
    `DELETE FROM attachments WHERE id LIKE 'demo-%'`,
    row('demo-photo-lake-retake', family, 'image/jpeg', statSync('scripts/demoPhotos/lake-retake.jpg').size, at(1, 9, 30), ago(150), 'demo-family-trip', null),
    row('demo-file-itinerary-draft', personal, 'application/pdf', statSync('scripts/demoFiles/itinerary-draft.pdf').size, at(40, 21), at(27, 10), 'demo-note-kyoto', 'itinerary-draft.pdf'),
    row('demo-file-lake-pan', family, 'video/mp4', statSync('scripts/demoFiles/lake-pan.mp4').size, at(1, 9, 30), ago(140), 'demo-family-trip', 'lake-pan.mp4', [960, 540, 6]),
    row('demo-file-lake-pan-poster', family, 'image/jpeg', statSync('scripts/demoFiles/lake-pan-poster.jpg').size, at(1, 9, 30), ago(140), 'demo-family-trip', null),
  ]);
}

/** What the demo's files are, by their ending. */
const DEMO_MIME: Record<string, string> = { jpg: 'image/jpeg', mp4: 'video/mp4', m4a: 'audio/mp4', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain' };

/**
 * The demo's other photos, videos and files have a record too, as each would once uploaded, with no Drive file, so
 * a right-click on one offers Share via public link as for a real one, and says the demo's aren't in a Google Drive. Each
 * goes with the first entry the server can read that holds it (none in the encrypted Diary); the Trash's are kept.
 */
function heldAttachments() {
  const found = (dir: string, prefix: string) =>
    readdirSync(dir)
      .filter((f) => !f.endsWith('.mjs') && !f.endsWith('.json'))
      .map((f) => {
        const dot = f.lastIndexOf('.');
        return { id: `${prefix}${f.slice(0, dot)}`, mime: DEMO_MIME[f.slice(dot + 1)] ?? 'application/octet-stream', size: statSync(`${dir}/${f}`).size, name: prefix === 'demo-file-' && !f.includes('-poster.') ? f : null };
      });
  runSql(
    [...found('scripts/demoPhotos', 'demo-photo-'), ...found('scripts/demoFiles', 'demo-file-')].map(
      ({ id, mime, size, name }) =>
        `INSERT OR IGNORE INTO attachments (id, owner_id, vault_id, drive_file_id, mime, size, created_at, name)
         SELECT ${sql(id)}, v.owner_id, c.vault_id, '', ${sql(mime)}, ${size}, c.updated_at, ${name ? sql(name) : 'NULL'}
         FROM cards c JOIN vaults v ON v.id = c.vault_id WHERE instr(c.payload, ${sql(`"${id}"`)}) > 0 ORDER BY c.updated_at LIMIT 1`,
    ),
  );
}

// ---- API ----

/** A device the demo's changes say they came from, so history shows changes from more than one. */
interface Device {
  id: string;
  name: string;
}
const LAPTOP: Device = { id: 'demo-device-laptop', name: 'Chrome on Mac' };
const PHONE: Device = { id: 'demo-device-phone', name: 'Safari on iPhone' };

async function call<T>(who: Person, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', device?: Device): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${who.token}`,
      'content-type': 'application/json',
      ...(device ? { 'X-Device-Id': device.id, 'X-Device-Name': device.name } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** A payload whose `createdAt` defaults to when the card was saved. */
type NewPayload = CardPayload extends infer T ? (T extends unknown ? Omit<T, 'createdAt'> & { createdAt?: number } : never) : never;

interface Draft {
  id: string;
  vaultId: string;
  at: number;
  payload: CardPayload;
}

/**
 * Sends cards as a device would. `seqs` holds what the server last gave each card, so a card sent again is an edit
 * of it, with a version of its own in history; it's brought up to date with what this push gets back.
 */
async function push(who: Person, drafts: Draft[], keys: Map<string, CryptoKey>, device = LAPTOP, seqs = new Map<string, number>()) {
  const records: CardRecord[] = [];
  for (const d of drafts) {
    const json = JSON.stringify(d.payload);
    const key = keys.get(d.vaultId);
    records.push({
      id: d.id,
      vault_id: d.vaultId,
      updated_at: d.at,
      deleted: false,
      seq: seqs.get(d.id) ?? 0,
      payload: key ? await encryptPayload(key, json, d.id, d.vaultId) : json,
    });
  }
  for (let i = 0; i < records.length; i += PUSH_LIMIT) {
    const { results } = await call<{ results: { id: string; status: string; seq?: number }[] }>(who, '/sync/push', { records: records.slice(i, i + PUSH_LIMIT) }, 'POST', device);
    const failed = results.filter((r) => r.status !== 'ok');
    if (failed.length) throw new Error(`Push refused: ${JSON.stringify(failed)}`);
    for (const r of results) if (r.seq !== undefined) seqs.set(r.id, r.seq);
  }
}

/** IDs earlier demos used that this one doesn't: the Status group (the board by todo state does its job) and its tags. */
const RETIRED: [string, string][] = [
  ['demo-group-status', 'Status'],
  ['demo-tag-todo', 'To do'],
  ['demo-tag-doing', 'Doing'],
  ['demo-tag-done', 'Done'],
];

// ---- The demo ----

export async function seed() {
  await fetch(`${API}/config`).catch(() => {
    throw new Error('The local server isn\'t running. Start it with `npm run dev:api` first.');
  });

  await prepareAccounts([DEMO, SAM]);

  const personal = `vault-${DEMO.id}`;
  const samPersonal = `vault-${SAM.id}`;
  const { vaults } = await call<SessionInfo>(DEMO, '/me');
  // The Family vault from an earlier run is used again, with whatever was added to it.
  const family = vaults.find((v) => v.name === 'Family' && v.owner_id === DEMO.id) ?? (await call<Vault>(DEMO, '/vaults', { name: 'Family' }));
  await call(DEMO, `/vaults/${family.id}/members`, { email: SAM.email, role: 'editor' });
  // The diary is private: locked with the PIN and encrypted. A diary already encrypted keeps its key, so entries
  // written in it stay readable; one whose PIN was changed is left alone, without the demo's entries.
  const diaryVault = `diary-${DEMO.id}`;
  const diary = vaults.find((v) => v.id === diaryVault);
  let diaryKey: CryptoKey | null;
  let recoveryKey: string | null = null;
  if (diary?.encryption) {
    diaryKey = await unlockWithPin(diary.encryption, DEMO_PIN);
  } else {
    const sealed = await createVaultKey(DEMO_PIN);
    await call<Vault>(DEMO, `/vaults/${diaryVault}`, { pin: await hashPin(DEMO_PIN), hidden: false, encryption: sealed.encryption }, 'PATCH');
    diaryKey = sealed.key;
    recoveryKey = sealed.recoveryKey;
  }
  const keys = new Map(diaryKey ? [[diaryVault, diaryKey]] : []);
  // Health is locked by the same PIN but not encrypted: out of sight in the app, while the server can still read it,
  // so its todo gets a reminder. One encrypted since, by hand, is left as it is, without the demo's entries.
  const health = vaults.find((v) => v.name === 'Health' && v.owner_id === DEMO.id) ?? (await call<Vault>(DEMO, '/vaults', { name: 'Health', pin: await hashPin(DEMO_PIN) }));

  const mine: Draft[] = [];
  const add = (id: string, vaultId: string, when: number, payload: NewPayload) => {
    mine.push({ id, vaultId, at: when, payload: { createdAt: when, ...payload } as CardPayload });
    return id;
  };
  /** Fields only some entries have: a tint, a preview style, view only, archived, pages after the first, a stack's entries, a template, reactions. */
  type Extras = Partial<Pick<NoteCard, 'color' | 'preview' | 'viewOnly' | 'archived' | 'pages' | 'stack' | 'template' | 'reactions'>>;
  const tag = (id: string, title: string, pinned: boolean, description = '', color?: CardColor) =>
    add(id, personal, at(9, 9), { type: 'tag', title, pinned, tags: [], content: description ? lines(description) : doc(p()), ...(color ? { color } : {}) });
  /** A tag group: one choice (an entry takes at most one of its tags) or many, ordered to sort by or not. */
  const group = (id: string, title: string, members: string[], choice: 'one' | 'many', ordered: boolean) =>
    add(id, personal, at(9, 9, 5), { type: 'tag', title, pinned: false, tags: [], content: doc(p()), members, choice, ordered });
  const note = (id: string, when: number, content: JSONNode, tags: string[] = [], title = '', vaultId = personal, extras: Extras = {}) =>
    add(id, vaultId, when, { type: 'note', title, content, tags, ...extras });
  const todo = (
    id: string,
    title: string,
    due: string | null,
    extra: Extras & { done?: number; tags?: string[]; when?: number; dueTime?: string; start?: string; repeat?: Repeat; waiting?: boolean; content?: JSONNode; vaultId?: string } = {},
  ) => {
    const { done, tags = [], when, dueTime, start, repeat, waiting, content, vaultId = personal, ...extras } = extra;
    return add(id, vaultId, done ?? when ?? at(3, 10), {
      type: 'todo',
      title,
      due,
      ...(due && dueTime ? { dueTime } : {}),
      ...(start ? { start } : {}),
      ...(due && repeat ? { repeat } : {}),
      ...(waiting && !done ? { waiting: true } : {}),
      status: done ? 'done' : 'open',
      completedAt: done ?? null,
      tags,
      content: content ?? doc(p()),
      ...extras,
    });
  };
  const link = (id: string, label: string): JSONNode => ({ type: 'cardLink', attrs: { id, label } });
  const web = (label: string, href: string): JSONNode => ({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] });
  /** A photo from scripts/demoPhotos, which the dev server serves in place of Google Drive (vite.config.ts). */
  const photo = (name: string, alt: string): JSONNode => ({ type: 'photo', attrs: { id: `demo-photo-${name}`, alt } });
  /** A file from scripts/demoFiles, likewise served by the dev server, with the name, type and size it's shown with. */
  const file = (name: string, ext: string, mime: string): JSONNode => ({
    type: 'file',
    attrs: { id: `demo-file-${name}`, name: `${name}.${ext}`, mime, size: statSync(`scripts/demoFiles/${name}.${ext}`).size },
  });

  /**
   * A video from scripts/demoFiles (`videos.mjs`), likewise, with the still beside it and the size and length a device
   * finds when one is added.
   */
  const video = (name: string, width: number, height: number): JSONNode => ({
    type: 'file',
    attrs: { id: `demo-file-${name}`, name: `${name}.mp4`, mime: 'video/mp4', size: statSync(`scripts/demoFiles/${name}.mp4`).size, poster: `demo-file-${name}-poster`, width, height, duration: 6 },
  });

  /**
   * A voice message from scripts/demoFiles (`voices.mjs`), likewise, with its length and loudness as a device finds
   * them when one is added, and its transcript, timed by sentence, when `transcribed`, as the server gives it.
   */
  const voices = JSON.parse(readFileSync('scripts/demoFiles/voices.json', 'utf8')) as Record<string, { duration: number; peaks: number[]; cues: { start: number; text: string }[] }>;
  const voice = (name: string, transcribed: boolean): JSONNode => {
    const { duration, peaks, cues } = voices[name];
    return {
      type: 'file',
      attrs: {
        id: `demo-file-${name}`,
        name: `${name}.m4a`,
        mime: 'audio/mp4',
        size: statSync(`scripts/demoFiles/${name}.m4a`).size,
        duration,
        peaks,
        ...(transcribed ? { transcript: cues.map((c) => c.text).join(' '), language: 'en', cues } : {}),
      },
    };
  };

  // Folders are pinned tags; the rest are plain tags, some with a color.
  const work = tag('demo-tag-work', 'Work', true, 'Anything for the day job.', 'blue');
  const home = tag('demo-tag-home', 'Home', true, '', 'green');
  const ideas = tag('demo-tag-ideas', 'Ideas', true, 'Half-baked thoughts worth keeping.', 'yellow');
  const travel = tag('demo-tag-travel', 'Travel', false, '', 'purple');
  const reading = tag('demo-tag-reading', 'Reading', false);
  const recipes = tag('demo-tag-recipes', 'Recipes', false, '', 'orange');

  // Groups: Priority sorts the journal (one choice, ordered) and makes a board's columns, and Topics just
  // gathers tags (many at once).
  const high = tag('demo-tag-high', 'High', false, '', 'red');
  const medium = tag('demo-tag-medium', 'Medium', false, '', 'yellow');
  const low = tag('demo-tag-low', 'Low', false, '', 'gray');
  group('demo-group-priority', 'Priority', [high, medium, low], 'one', true);
  group('demo-group-topics', 'Topics', [travel, reading, recipes], 'many', false);

  // A week of notes, oldest first.
  const packing = note(
    'demo-note-packing',
    at(8, 21, 10),
    doc(checklist(['Passport', true], ['Phone charger and adapter', true], ['Rain jacket', false], ['Comfortable shoes', false], ['Snacks for the flight', false])),
    [travel],
    'Packing list',
  );
  const kyoto = note(
    'demo-note-kyoto',
    at(8, 21, 30),
    doc(
      p('Kyoto, 4 days in April.'),
      steps('Fushimi Inari early, before the crowds', 'Arashiyama bamboo grove', 'Nishiki market for lunch', 'Philosopher\'s Path at sunset'),
      p('Pack using the ', link(packing, 'Packing list'), '.'),
      p('Shrine guide: ', web('Fushimi Inari-taisha', 'https://en.wikipedia.org/wiki/Fushimi_Inari-taisha')),
      photo('torii', 'Torii gates at Fushimi Inari'),
      file('itinerary', 'pdf', 'application/pdf'),
    ),
    [travel],
    'Kyoto trip',
  );
  // Phrase cards for the trip, stacked in an order of their own (not the order written): each has a second page with
  // what it means, and the first has a third, for when to say it.
  note('demo-stack-phrases', at(8, 21, 39), lines('Phrases to learn before the trip. Page 2 of each card says what it means.'), [travel], 'Kyoto phrases', personal, {
    stack: ['demo-card-where', 'demo-card-thanks', 'demo-card-excuse'],
  });
  note('demo-card-thanks', at(8, 21, 40), lines('ありがとうございます'), [travel], '', personal, {
    pages: [doc(p(text('Thank you very much', ['bold'])), p('arigatō gozaimasu')), doc(p(text('When to say it', ['bold'])), p('To shop staff, hosts and anyone who helps. Among friends, just arigatō.'))],
  });
  note('demo-card-excuse', at(8, 21, 41), doc(p('すみません'), p('More: ', web('Etiquette in Japan', 'https://en.wikipedia.org/wiki/Etiquette_in_Japan'))), [travel], '', personal, { pages: [doc(p(text('Excuse me / sorry', ['bold'])), p('sumimasen: to get attention, or to apologise'))] });
  note('demo-card-where', at(8, 21, 42), doc(p('駅はどこですか？'), photo('station', 'Kyoto Station platform')), [travel], '', personal, { pages: [doc(p(text('Where is the station?', ['bold'])), p('eki wa doko desu ka'), photo('map', 'The way from the hotel'))] });
  // Five photos of every shape (4:3, a 3:1 panorama, 3:4, square, 16:9): one more than a bubble shows, so the last
  // says +1.
  note(
    'demo-note-coast',
    at(6, 18, 0),
    doc(
      p('Weekend at the coast. Low tide at 4, and the pier lit up after dark.'),
      photo('coast-sunset', 'Sunset over the sea'),
      video('waves', 960, 540),
      photo('coast-panorama', 'The beach end to end'),
      photo('coast-lighthouse', 'The lighthouse'),
      photo('coast-umbrella', 'Our umbrella from the dunes'),
      photo('coast-pier', 'The pier at night'),
    ),
    [travel],
  );
  // The wifi password is kept from being changed by mistake, and hidden until pressed.
  note('demo-note-wifi', at(7, 9, 2), doc(p('Guest wifi: Lemon-Tree, password ', text('sunflower-42', ['hidden']))), [home], '', personal, { viewOnly: true });
  // Edited later from the phone: its history has two versions.
  note('demo-note-standup', at(7, 10, 15), doc(h('Standup'), bullets('Shipped the search fix', 'Reviewing the export PR', 'Blocked on design for onboarding')), [work]);
  note('demo-note-book', at(6, 22, 40), doc(p(text('Thinking, Fast and Slow', ['italic'])), quote('Nothing in life is as important as you think it is, while you are thinking about it.'), p('Chapter 3 next.')), [reading]);
  // A voice message not transcribed yet: Transcribe under it.
  note('demo-note-idea-app', at(5, 8, 5), doc(p('App idea: a plant watering reminder that reads the weather forecast and skips rainy days.'), voice('idea-voice', false)), [ideas, low], '', personal, { color: 'yellow' });
  note('demo-note-curry', at(5, 19, 30), doc(p(text('Weeknight curry', ['bold'])), photo('curry', 'A bowl of curry'), bullets('1 onion, 2 garlic cloves, ginger', '2 tbsp curry paste', '1 can coconut milk', 'Chickpeas and spinach'), p('Simmer 20 minutes. Rice on the side.'), video('simmer', 540, 540), file('spice-list', 'txt', 'text/plain')), [recipes], 'Curry');
  note('demo-note-zh', at(4, 12, 20), lines('今天天氣很好，午餐去吃了牛肉麵。', '下次要試試隔壁的水餃店。'));
  note('demo-note-1on1', at(4, 15, 0), doc(p('1:1 with Mia'), bullets('Wants to lead the API migration', 'Conference budget: yes, up to two people', 'Follow up on hiring plan')), [work, medium]);
  note('demo-note-quote', at(3, 7, 45), lines('"The best time to plant a tree was 20 years ago. The second best time is now."'), [ideas], '', personal, { color: 'purple' });
  // Its photo shows as a count, by its own preview style.
  note('demo-note-gift', at(3, 20, 10), doc(p('Gift ideas for Mom'), bullets('Pottery class', 'The new cookbook she mentioned', 'Framed photo from the beach trip'), photo('beach-family', 'All of us on the beach')), [home], '', personal, {
    preview: { photos: 'off' },
  });
  // One wide photo, large by its own preview style.
  note('demo-note-night', at(2, 22, 30), doc(p('Night walk along the river. The skyline from the bridge.'), photo('skyline', 'The skyline at dusk')), [], '', personal, { preview: { photos: 'large' } });
  note('demo-note-short', at(2, 13, 33), lines('Parking: level 3, spot C14'));
  // Its links show one line each, whatever the device's setting.
  note(
    'demo-note-links',
    at(2, 18, 5),
    doc(
      p('Reading list'),
      bullets('https://en.wikipedia.org/wiki/Kintsugi', 'https://en.wikipedia.org/wiki/Wabi-sabi'),
    ),
    [reading],
    'Reading list',
    personal,
    { preview: { links: 'compact' } },
  );
  note('demo-note-meeting', at(1, 11, 0), doc(h('Design review'), p('Decided to keep the sidebar and move settings under the account menu.'), p('Next: prototype by Friday. See ', link(kyoto, 'Kyoto trip'), ' for the photo layout we liked.')), [work, ideas, high], '', personal, { reactions: { '👍': [DEMO.id] } });
  note('demo-note-long', at(1, 21, 15), lines(
    'Long note, to show how bubbles clamp:',
    'Line two of a note that keeps going.',
    'Line three.',
    'Line four.',
    'Line five.',
    'Line six.',
    'Line seven.',
    'Line eight.',
    'Line nine.',
    'Line ten.',
    'Line eleven, hidden in the bubble but there when you open it.',
    'Line twelve.',
  ));
  note('demo-note-deploy', at(1, 16, 20), doc(
    p('Deploying: run ', text('npm run check', ['code']), ' first, then push to ', text('main', ['code']), '.'),
    code('sh', 'npm run check', 'git push origin main', '# Workers Builds deploys it in about a minute'),
  ), [work], 'Deploy steps');
  note('demo-note-snippet', ago(150), doc(
    p('Debounce helper for the search box:'),
    code(
      'js',
      'export function debounce(fn, ms = 300) {',
      '  let timer;',
      '  return (...args) => {',
      '    clearTimeout(timer);',
      '    timer = setTimeout(() => fn(...args), ms);',
      '  };',
      '}',
    ),
  ), [work, ideas]);
  // The busiest entries: nearly everything an entry can have, together. The launch plan has headings, every inline
  // style, nested lists, a checklist, a quote, code, a rule, hidden words, links to entries and the web, two more
  // pages, a color, tags from both groups, reactions from two people, a place in the Family vault too, comments
  // open and resolved, and history from two devices (see LATER). It's long, so its bubble folds.
  const move = 'demo-todo-move';
  const launch = note(
    'demo-note-launch',
    at(2, 9, 0),
    doc(
      h('Goal'),
      p(
        'Ship ',
        text('Notes 2.0', ['bold']),
        ' to everyone by the ',
        text('end of the month', ['italic']),
        ', with ',
        text('sync', ['underline']),
        ' and search ',
        text('twice as fast', ['bold', 'italic']),
        '. ',
        text('No new settings', ['strike']),
        ' One new setting at most. Flag: ',
        text('notes2', ['code']),
        '.',
      ),
      h('Timeline'),
      list(
        'orderedList',
        nested('Week 1: freeze', list('bulletList', 'Cut the release branch', 'Only fixes after Wednesday')),
        nested('Week 2: beta', list('bulletList', 'Ten teams on the beta', nested('Collect feedback', list('bulletList', 'In-app survey', 'Two calls a day')))),
        'Week 3: roll out to 10%, then 50%',
        'Week 4: everyone',
      ),
      photo('whiteboard', 'The launch board'),
      file('launch-budget', 'csv', 'text/csv'),
      h('Before launch'),
      checklist(['Load test the sync server', true], ['Security review', true], ['Help center articles', false], ['Press kit', false], ['Status page ready', false]),
      quote('Make it work, make it right, make it fast. In that order.'),
      h3('Rollout switch'),
      code('ts', "export const rollout = (userId: string, percent: number) =>", '  hash(userId) % 100 < percent;'),
      rule,
      p('Related: ', link('demo-note-meeting', 'Design review'), ', ', link('demo-note-deploy', 'Deploy steps'), ' and ', link('demo-note-1on1', '1:1 with Mia'), '. Staging login: launch / ', text('orange-kite-77', ['hidden']), '.'),
      p('Announcement draft in the ', web('style guide', 'https://en.wikipedia.org/wiki/Style_guide'), '. Moving the team the same week: ', link(move, 'Move into the new flat'), '.'),
    ),
    [work, ideas, high],
    'Launch plan: Notes 2.0',
    personal,
    {
      color: 'blue',
      reactions: { '🚀': [DEMO.id, SAM.id], '👀': [SAM.id], '🎉': [DEMO.id] },
      pages: [
        doc(h('Risks'), list('bulletList', nested(text('Sync load', ['bold']), list('bulletList', 'Mitigation: 10% first')), 'Search index rebuild takes a night', 'Support queue on day one')),
        doc(h('FAQ'), p(text('Will my notes move?', ['bold'])), p('No. Nothing to do; they stay where they are.'), p(text('Can I go back?', ['bold'])), p('For a month, from the account menu.')),
      ],
    },
  );
  // The busiest todo: due at a time after a start date, high priority, a checklist with nested steps, links back to
  // an archived note and a web page, a door code kept hidden, a second page with the lease attached, a tint and a reaction.
  todo(move, 'Move into the new flat', addDays(today, 2), {
    tags: [home, high, travel],
    when: at(4, 20, 0),
    start: addDays(today, -4),
    dueTime: '18:00',
    color: 'green',
    reactions: { '💪': [DEMO.id] },
    content: doc(
      p('Keys from the agent at 5. Door code ', text('4729#', ['hidden']), '. Old place: ', link('demo-note-old-flat', 'Old flat'), '.'),
      h3('Before'),
      checklist(['Book the van', true], ['Pack the kitchen', true], ['Pack the books', false], ['Defrost the freezer', false]),
      h3('On the day'),
      list('orderedList', nested('Load the van', list('bulletList', 'Heavy boxes first', 'Plants last, in the cab')), 'Meter readings at both places', 'Photos of the empty rooms'),
      p('Movers: ', web('checklist ideas', 'https://en.wikipedia.org/wiki/Relocation_(personal)'), ', and ', text('tip the crew', ['bold']), '.'),
    ),
    // The lease, attached on the back page: a todo's file, and one on a page behind the front, for the Files page.
    pages: [doc(h('Change the address'), checklist(['Bank', true], ['Doctor', false], ['Work payroll', false], ['Post office redirect', false]), file('lease', 'pdf', 'application/pdf'))],
  });
  note('demo-note-today-1', ago(95), lines('Call the dentist about Thursday'));
  note('demo-note-today-2', ago(40), lines('Buy oat milk, bananas and coffee beans'), [home]);
  // A voice message alone, transcribed: its words play along, and search finds them ("dry cleaning").
  note('demo-note-voice', ago(20), doc(voice('errands-voice', true)), [home]);
  // Another just after it, recorded quietly: one ending plays on to it, and it's turned up to be heard as loud.
  note('demo-note-voice-more', ago(19), doc(voice('errands-more-voice', true)), [home]);
  note('demo-note-secret', at(2, 23, 0), lines('Gift budget this year: 300. Don\'t tell anyone.'), [], '', diaryVault);
  // Templates, on their own page, to start new entries from: their checklists come unticked, and {date} is the day.
  note('demo-template-packing', at(9, 9, 30), doc(checklist(['Passport', false], ['Chargers', false], ['Toothbrush', false], ['Rain jacket', false], ['Snacks', false])), [travel], 'Packing list', personal, { template: true });
  note(
    'demo-template-review',
    at(9, 9, 31),
    doc(h('Done this week'), { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }, h('Next week'), checklist(['Inbox to zero', false], ['Plan the top three', false], ['Tidy the journal', false])),
    [work],
    'Weekly review, {date}',
    personal,
    { template: true, color: 'blue' },
  );
  // Older entries, back three years, a few with photos: the rail beside the journal, Photos and the Trash has years to show.
  note('demo-note-back-garden', at(64, 18, 20), doc(p('First tomatoes from the garden. Too many to eat, so sauce on Sunday.'), photo('garden', 'Tomatoes on the vine')), [home]);
  note('demo-note-back-books', at(130, 21, 5), doc(p('Finished the lighthouse book. Next: something short.')), [reading]);
  note('demo-note-back-snow', at(330, 22, 40), doc(p('First snow on our street. Walked home the long way.'), photo('snow', 'Snow on the street at night')));
  note('demo-note-back-cake', at(410, 19, 0), doc(p('Five candles for Ava. She blew them out in one go.'), photo('cake', 'The birthday cake')), [home]);
  note('demo-note-back-job', at(560, 9, 15), lines('First day at the new job. Desk by the window.'), [work]);
  note('demo-note-back-run', at(700, 7, 30), lines('Ran 5 km without stopping, the first time.'));
  note('demo-note-back-move', at(820, 20, 45), lines('Moved into the flat. Boxes everywhere, but the light is lovely.'), [home]);
  note('demo-note-back-start', at(1000, 21, 0), lines('Starting a journal. One line a day, more when there is more.'));
  // Put away: out of the journal, still in search and under the Archived chip.
  note('demo-note-old-flat', at(9, 20, 0), doc(p('Old flat'), bullets('Meter reading: 4821', 'Deposit back in 30 days')), [home], 'Old flat', personal, { archived: true });

  // Todos: overdue, due today (one at a time), upcoming, no date, repeating, waiting, done and archived. Those
  // are what the board by todo state shows: Open, Waiting and Done. Some have a start date too, so they span days
  // on the calendar and the timeline.
  todo('demo-todo-taxes', 'File the tax return', addDays(today, -2), { tags: [home, high], start: addDays(today, -9) });
  todo('demo-todo-plants', 'Water the plants', today, { tags: [home], repeat: { unit: 'day', every: 3 } });
  todo('demo-todo-review', 'Review the export PR', today, { tags: [work, high], dueTime: '15:00' });
  todo('demo-todo-flights', 'Book flights to Kyoto', addDays(today, 3), { tags: [travel, medium], start: addDays(today, 1) });
  todo('demo-todo-dentist', 'Dentist appointment', addDays(today, 7), { dueTime: '10:30', waiting: true, color: 'pink' });
  todo('demo-todo-read', 'Finish chapter 3', null, { tags: [reading, low] });
  todo('demo-todo-groceries', 'Groceries', addDays(today, -1), { done: at(1, 18, 0), tags: [home] });
  todo('demo-todo-sync', 'Weekly team sync', addDays(today, 1), { tags: [work], dueTime: '09:30', repeat: { unit: 'week', every: 1 } });
  todo('demo-todo-rent', 'Pay the rent', addDays(today, 12), { tags: [home], repeat: { unit: 'month', every: 1 }, color: 'green' });
  todo('demo-todo-onboarding', 'Onboarding design', addDays(today, 5), {
    tags: [work, medium],
    waiting: true,
    start: addDays(today, -3),
    content: doc(p('Waiting on the designs from Lee.'), photo('wireframe', 'Sketch of the first screen'), checklist(['Wireframes', true], ['Copy review', true], ['Handoff to engineering', false])),
  });
  todo('demo-todo-migration', 'Plan the API migration', addDays(today, 10), { tags: [work, medium], when: at(2, 9, 30), start: addDays(today, 4) });
  todo('demo-todo-slides', 'Send the conference slides', addDays(today, -3), { done: at(3, 17, 0), tags: [work] });
  todo('demo-todo-passport', 'Renew passport', addDays(today, -20), { done: at(8, 12, 0), tags: [travel], archived: true });

  // Diary entries are notes in the Diary vault, which needs the PIN.
  // A voice message in the private Diary: it plays, but its sound never goes to the server to be transcribed.
  note('demo-diary-3', at(3, 22, 0), doc(p('Quiet day.'), voice('diary-voice', false)), [], '', diaryVault);
  note('demo-diary-2', at(2, 22, 0), lines('Tried the curry recipe. Too much ginger, but good.'), [], '', diaryVault);
  note('demo-diary-1', at(1, 22, 0), doc(p('Design review went well.'), p('Grateful for:'), bullets('Sunny weather', 'A good book', 'Dinner with Sam')), [], '', diaryVault);

  // Health, locked by the PIN without encryption: a note, and a todo whose reminder comes as one in the open would.
  note('demo-health-physio', at(2, 8, 0), doc(p('Physio: three sets of ten squats, then the stretches on the sheet.')), [], 'Physio exercises', health.id);
  todo('demo-health-refill', 'Refill the prescription', addDays(today, 1), { dueTime: '09:00', when: at(1, 8, 30), vaultId: health.id });

  // A shared vault with Sam: notes from both of you.
  note('demo-family-groceries', at(2, 17, 0), doc(p('Shared shopping list'), checklist(['Rice', true], ['Eggs', false], ['Dish soap', false])), [], '', family.id);
  // Reactions: Sam's and yours together on one, Sam's alone on the other; a press puts yours on or takes it off.
  note('demo-family-trip', at(1, 9, 30), doc(p('Summer trip: beach or mountains? Vote below.'), photo('lake', 'The lake by the cabins')), [], 'Summer trip', family.id, {
    reactions: { '🏔️': [SAM.id, DEMO.id], '🏖️': [SAM.id] },
  });

  const pushed = mine.filter((d) => (diaryKey || d.vaultId !== diaryVault) && !(health.encryption && d.vaultId === health.id));
  // Cards an earlier demo had and this one doesn't: sent as deleted, so a browser that synced them lets them go.
  const retired = RETIRED.map(([id, title]): CardRecord => {
    const payload: CardPayload = { type: 'tag', title, pinned: false, tags: [], content: doc(p()), createdAt: at(9, 9) };
    return { id, vault_id: personal, updated_at: Date.now(), deleted: true, seq: 0, payload: JSON.stringify(payload) };
  });
  await call(DEMO, '/sync/push', { records: retired });
  const seqs = new Map<string, number>();
  // Entries first written shorter, then edited on the phone, so their history has both versions.
  const LATER: Record<string, JSONNode> = {
    'demo-note-standup': doc(h('Standup'), bullets('Shipped the search fix', 'Reviewing the export PR')),
    'demo-note-launch': doc(h('Goal'), p('Ship Notes 2.0 by the end of the month.'), h('Before launch'), checklist(['Load test the sync server', false], ['Security review', false])),
  };
  const revised = pushed.filter((d) => d.id in LATER);
  await push(DEMO, revised.map((d) => ({ ...d, payload: { ...d.payload, content: LATER[d.id] } })), keys, LAPTOP, seqs);
  await push(DEMO, pushed.filter((d) => !revised.includes(d)), keys, LAPTOP, seqs);
  await push(DEMO, revised.map((d) => ({ ...d, at: ago(30) })), keys, PHONE, seqs);

  // Kyoto trip and the launch plan are in the Family vault too, so Sam sees them there; the curry recipe has a public link.
  await call(DEMO, `/cards/${kyoto}/shares`, { vault_id: family.id, role: 'edit' });
  await call(DEMO, `/cards/${launch}/shares`, { vault_id: family.id, role: 'edit' });
  await call(DEMO, '/cards/demo-note-curry/links', {});
  // Claude and other AI apps may read the Personal vault.
  await call(DEMO, `/vaults/${personal}`, { ai_access: 'read' }, 'PATCH');

  // Sam's own vault, shared with you to view: you can read and comment, not change.
  const { vaults: samVaults } = await call<SessionInfo>(SAM, '/me');
  const bookClub = samVaults.find((v) => v.name === 'Book club' && v.owner_id === SAM.id) ?? (await call<Vault>(SAM, '/vaults', { name: 'Book club' }));
  await call(SAM, `/vaults/${bookClub.id}/members`, { email: DEMO.email, role: 'viewer' });

  // Sam writes in the shared vault, comments, and shares a note of their own with you.
  const samDraft = (id: string, vaultId: string, when: number, payload: CardPayload): Draft => ({ id, vaultId, at: when, payload });
  await push(
    SAM,
    [
      samDraft('demo-sam-family', family.id, ago(12), { type: 'note', title: '', tags: [], createdAt: ago(12), content: lines('Picked up the dry cleaning. Back by 6.') }),
      samDraft('demo-sam-recipe', samPersonal, at(4, 18, 0), {
        type: 'note',
        title: 'Grandma\'s dumplings',
        tags: [],
        createdAt: at(4, 18, 0),
        content: doc(bullets('500 g pork mince', 'Napa cabbage, salted and squeezed', 'Ginger, scallion, soy sauce, sesame oil'), p('Fold, boil, and add cold water three times.')),
      }),
      samDraft('demo-sam-bookclub', bookClub.id, at(3, 19, 0), {
        type: 'note',
        title: 'Next book',
        tags: [],
        createdAt: at(3, 19, 0),
        content: doc(p('November: ', text('Klara and the Sun', ['italic'])), p('Meet at the café on the 28th.'), file('reading-list', 'txt', 'text/plain')),
        // A vault you can only view: its reactions show, and none can be added, and its file opens and downloads but
        // has no share button, as only those who can change a vault share from it.
        reactions: { '📚': [SAM.id] },
      }),
    ],
    new Map(),
  );
  await call(SAM, '/cards/demo-family-trip/comments', { body: 'Mountains! The beach was too crowded last year.' });
  await call(DEMO, '/cards/demo-family-trip/comments', { body: 'Mountains it is. I\'ll look at cabins.' });
  // A question already answered, resolved, and one still open on a card on the board.
  const asked = await call<{ comments: { id: string }[] }>(SAM, `/cards/${kyoto}/comments`, { body: 'Can I come for the last two days?' });
  await call(DEMO, `/cards/${kyoto}/comments/${asked.comments[0].id}`, { resolved: true }, 'PATCH');
  await call(SAM, `/cards/${kyoto}/comments`, { body: 'Is the ryokan booked yet?' });
  await call(SAM, '/cards/demo-sam-recipe/shares', { email: DEMO.email, role: 'comment' });
  // The launch plan's thread: one settled, two still open.
  const risk = await call<{ comments: { id: string }[] }>(SAM, `/cards/${launch}/comments`, { body: 'Is 10% on day one too much for the sync server?' });
  await call(DEMO, `/cards/${launch}/comments`, { body: 'The load test passed at 3x, so it should be fine.' });
  await call(DEMO, `/cards/${launch}/comments/${risk.comments[0].id}`, { resolved: true }, 'PATCH');
  await call(SAM, `/cards/${launch}/comments`, { body: 'Who writes the help center articles?' });
  await call(DEMO, `/cards/${launch}/comments`, { body: 'Mia offered. I\'ll confirm on Monday.' });

  trashedAttachments(DEMO.id, family.id, personal);
  heldAttachments();

  // Drafts, left as if typed on another device: one in the journal box when it shows #travel, and a reply under
  // Kyoto to Sam's open question. Each shows in its box until sent or emptied.
  const paragraph = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  await call(
    DEMO,
    '/drafts',
    {
      drafts: [
        { kind: 'journal', key: '/journal?tag=demo-tag-travel', value: paragraph('Look up rail passes for the Kyoto trip') },
        { kind: 'comment', key: kyoto, value: "Not yet. I'm choosing between two near the" },
      ],
    },
    'PUT',
  );

  writeFileSync(SESSION_FILE, JSON.stringify({ token: DEMO.token, user: { id: DEMO.id, email: DEMO.email, name: DEMO.name } }));
  return { cards: mine.length + 3, pin: DEMO_PIN, recoveryKey, diaryOpen: !!diaryKey };
}
