/**
 * Fills the local server with a demo account that shows what the app does, so it can be tried without a Google
 * sign-in: folders and tags, tag groups with colors (a Priority to sort by and show as a board, and a many-choice
 * Topics), todos for the board by todo state, notes with headings, lists, checklists, quotes, code, web links and links to each other, todos
 * overdue, due today at a time, upcoming, undated, repeating, waiting, done and archived, entries tinted, set to view
 * only or with their own preview style, a private and encrypted Diary vault, a vault shared with Sam and one Sam
 * shares to view, a card also in another vault, a note Sam shares, a public link, comments open and resolved, and
 * version history from more than one device.
 * Run with `npm run demo` while `npm run dev:api` is running. Running it again puts the demo's own cards back as they
 * were, dated around today, and keeps anything else in the accounts.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  mkdirSync('.wrangler', { recursive: true });
  writeFileSync('.wrangler/demo.sql', statements.join(';\n') + ';\n');
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'notes-app', '--local', '--file', '.wrangler/demo.sql'], { stdio: 'ignore' });
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

  const mine: Draft[] = [];
  const add = (id: string, vaultId: string, when: number, payload: NewPayload) => {
    mine.push({ id, vaultId, at: when, payload: { createdAt: when, ...payload } as CardPayload });
    return id;
  };
  /** Fields only some entries have: a tint, a preview style, view only, archived. */
  type Extras = Partial<Pick<NoteCard, 'color' | 'preview' | 'viewOnly' | 'archived'>>;
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
    extra: Extras & { done?: number; tags?: string[]; when?: number; dueTime?: string; repeat?: Repeat; waiting?: boolean; content?: JSONNode } = {},
  ) => {
    const { done, tags = [], when, dueTime, repeat, waiting, content, ...extras } = extra;
    return add(id, personal, done ?? when ?? at(3, 10), {
      type: 'todo',
      title,
      due,
      ...(due && dueTime ? { dueTime } : {}),
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
    ),
    [travel],
    'Kyoto trip',
  );
  // The wifi password is kept from being changed by mistake, and hidden until pressed.
  note('demo-note-wifi', at(7, 9, 2), doc(p('Guest wifi: Lemon-Tree, password ', text('sunflower-42', ['hidden']))), [home], '', personal, { viewOnly: true });
  // Edited later from the phone: its history has two versions.
  note('demo-note-standup', at(7, 10, 15), doc(h('Standup'), bullets('Shipped the search fix', 'Reviewing the export PR', 'Blocked on design for onboarding')), [work]);
  note('demo-note-book', at(6, 22, 40), doc(p(text('Thinking, Fast and Slow', ['italic'])), quote('Nothing in life is as important as you think it is, while you are thinking about it.'), p('Chapter 3 next.')), [reading]);
  note('demo-note-idea-app', at(5, 8, 5), lines('App idea: a plant watering reminder that reads the weather forecast and skips rainy days.'), [ideas, low], '', personal, { color: 'yellow' });
  note('demo-note-curry', at(5, 19, 30), doc(p(text('Weeknight curry', ['bold'])), bullets('1 onion, 2 garlic cloves, ginger', '2 tbsp curry paste', '1 can coconut milk', 'Chickpeas and spinach'), p('Simmer 20 minutes. Rice on the side.')), [recipes], 'Curry');
  note('demo-note-zh', at(4, 12, 20), lines('今天天氣很好，午餐去吃了牛肉麵。', '下次要試試隔壁的水餃店。'));
  note('demo-note-1on1', at(4, 15, 0), doc(p('1:1 with Mia'), bullets('Wants to lead the API migration', 'Conference budget: yes, up to two people', 'Follow up on hiring plan')), [work, medium]);
  note('demo-note-quote', at(3, 7, 45), lines('"The best time to plant a tree was 20 years ago. The second best time is now."'), [ideas], '', personal, { color: 'purple' });
  note('demo-note-gift', at(3, 20, 10), doc(p('Gift ideas for Mom'), bullets('Pottery class', 'The new cookbook she mentioned', 'Framed photo from the beach trip')), [home]);
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
  note('demo-note-meeting', at(1, 11, 0), doc(h('Design review'), p('Decided to keep the sidebar and move settings under the account menu.'), p('Next: prototype by Friday. See ', link(kyoto, 'Kyoto trip'), ' for the photo layout we liked.')), [work, ideas, high]);
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
  note('demo-note-today-1', ago(95), lines('Call the dentist about Thursday'));
  note('demo-note-today-2', ago(40), lines('Buy oat milk, bananas and coffee beans'), [home]);
  note('demo-note-secret', at(2, 23, 0), lines('Gift budget this year: 300. Don\'t tell anyone.'), [], '', diaryVault);
  // Put away: out of the journal, still in search and under the Archived chip.
  note('demo-note-old-flat', at(9, 20, 0), doc(p('Old flat'), bullets('Meter reading: 4821', 'Deposit back in 30 days')), [home], 'Old flat', personal, { archived: true });

  // Todos: overdue, due today (one at a time), upcoming, no date, repeating, waiting, done and archived. Those
  // are what the board by todo state shows: Open, Waiting and Done.
  todo('demo-todo-taxes', 'File the tax return', addDays(today, -2), { tags: [home, high] });
  todo('demo-todo-plants', 'Water the plants', today, { tags: [home], repeat: { unit: 'day', every: 3 } });
  todo('demo-todo-review', 'Review the export PR', today, { tags: [work, high], dueTime: '15:00' });
  todo('demo-todo-flights', 'Book flights to Kyoto', addDays(today, 3), { tags: [travel, medium] });
  todo('demo-todo-dentist', 'Dentist appointment', addDays(today, 7), { dueTime: '10:30', waiting: true, color: 'pink' });
  todo('demo-todo-read', 'Finish chapter 3', null, { tags: [reading, low] });
  todo('demo-todo-groceries', 'Groceries', addDays(today, -1), { done: at(1, 18, 0), tags: [home] });
  todo('demo-todo-sync', 'Weekly team sync', addDays(today, 1), { tags: [work], dueTime: '09:30', repeat: { unit: 'week', every: 1 } });
  todo('demo-todo-rent', 'Pay the rent', addDays(today, 12), { tags: [home], repeat: { unit: 'month', every: 1 }, color: 'green' });
  todo('demo-todo-onboarding', 'Onboarding design', addDays(today, 5), {
    tags: [work, medium],
    waiting: true,
    content: doc(p('Waiting on the designs from Lee.'), checklist(['Wireframes', true], ['Copy review', true], ['Handoff to engineering', false])),
  });
  todo('demo-todo-migration', 'Plan the API migration', addDays(today, 10), { tags: [work, medium], when: at(2, 9, 30) });
  todo('demo-todo-slides', 'Send the conference slides', addDays(today, -3), { done: at(3, 17, 0), tags: [work] });
  todo('demo-todo-passport', 'Renew passport', addDays(today, -20), { done: at(8, 12, 0), tags: [travel], archived: true });

  // Diary entries are notes in the Diary vault, which needs the PIN.
  note('demo-diary-3', at(3, 22, 0), lines('Quiet day. Long walk by the river after work.'), [], '', diaryVault);
  note('demo-diary-2', at(2, 22, 0), lines('Tried the curry recipe. Too much ginger, but good.'), [], '', diaryVault);
  note('demo-diary-1', at(1, 22, 0), doc(p('Design review went well.'), p('Grateful for:'), bullets('Sunny weather', 'A good book', 'Dinner with Sam')), [], '', diaryVault);

  // A shared vault with Sam: notes from both of you.
  note('demo-family-groceries', at(2, 17, 0), doc(p('Shared shopping list'), checklist(['Rice', true], ['Eggs', false], ['Dish soap', false])), [], '', family.id);
  note('demo-family-trip', at(1, 9, 30), lines('Summer trip: beach or mountains? Vote below.'), [], 'Summer trip', family.id);

  const pushed = diaryKey ? mine : mine.filter((d) => d.vaultId !== diaryVault);
  // Cards an earlier demo had and this one doesn't: sent as deleted, so a browser that synced them lets them go.
  const retired = RETIRED.map(([id, title]): CardRecord => {
    const payload: CardPayload = { type: 'tag', title, pinned: false, tags: [], content: doc(p()), createdAt: at(9, 9) };
    return { id, vault_id: personal, updated_at: Date.now(), deleted: true, seq: 0, payload: JSON.stringify(payload) };
  });
  await call(DEMO, '/sync/push', { records: retired });
  const seqs = new Map<string, number>();
  // The standup note as it was first written, then as edited on the phone, so its history has both.
  const standup = pushed.find((d) => d.id === 'demo-note-standup')!;
  await push(DEMO, [{ ...standup, at: standup.at, payload: { ...standup.payload, content: doc(h('Standup'), bullets('Shipped the search fix', 'Reviewing the export PR')) } }], keys, LAPTOP, seqs);
  await push(DEMO, pushed.filter((d) => d !== standup), keys, LAPTOP, seqs);
  await push(DEMO, [{ ...standup, at: ago(30) }], keys, PHONE, seqs);

  // Kyoto trip is in the Family vault too, so Sam sees it there; the curry recipe has a public link.
  await call(DEMO, `/cards/${kyoto}/shares`, { vault_id: family.id, role: 'edit' });
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
        content: doc(p('November: ', text('Klara and the Sun', ['italic'])), p('Meet at the café on the 28th.')),
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

  writeFileSync(SESSION_FILE, JSON.stringify({ token: DEMO.token, user: { id: DEMO.id, email: DEMO.email, name: DEMO.name } }));
  return { cards: mine.length + 3, pin: DEMO_PIN, recoveryKey, diaryOpen: !!diaryKey };
}
