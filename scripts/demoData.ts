/**
 * Fills the local server with a demo account: vaults, folders, tags, notes, todos, diary entries,
 * a shared vault, a comment and a shared note, so the app can be tried without a Google sign-in.
 * Run with `npm run demo` while `npm run dev:api` is running. Running it again starts the demo over.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createVaultKey, encryptPayload } from '../src/crypto/vaultKeys';
import { addDays, toDateKey } from '../src/domain/dates';
import { hashPin } from '../src/domain/pin';
import { diaryId } from '../src/domain/rehome';
import type { CardPayload, CardRecord, JSONNode, Vault } from '../src/domain/types';
import { PUSH_LIMIT } from '../src/sync/protocol';

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
const quote = (t: string): JSONNode => ({ type: 'blockquote', content: [p(t)] });
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

async function resetAccounts(people: Person[]) {
  const ids = people.map((u) => sql(u.id)).join(', ');
  const vaults = `SELECT id FROM vaults WHERE owner_id IN (${ids})`;
  const cards = `SELECT id FROM cards WHERE vault_id IN (${vaults})`;
  const now = Date.now();
  const statements = [
    `DELETE FROM card_shares WHERE shared_by IN (${ids}) OR card_id IN (${cards}) OR (target_type = 'user' AND target_id IN (${ids}))`,
    `DELETE FROM card_share_invites WHERE shared_by IN (${ids}) OR card_id IN (${cards})`,
    `DELETE FROM public_links WHERE created_by IN (${ids}) OR card_id IN (${cards})`,
    `DELETE FROM comments WHERE author_id IN (${ids}) OR card_id IN (${cards})`,
    `DELETE FROM card_versions WHERE card_id IN (${cards})`,
    `DELETE FROM attachments WHERE owner_id IN (${ids})`,
    `DELETE FROM cards WHERE vault_id IN (${vaults})`,
    `DELETE FROM vault_invites WHERE invited_by IN (${ids}) OR vault_id IN (${vaults})`,
    `DELETE FROM vault_members WHERE user_id IN (${ids}) OR vault_id IN (${vaults})`,
    `DELETE FROM vaults WHERE owner_id IN (${ids})`,
    `DELETE FROM sessions WHERE user_id IN (${ids})`,
    `DELETE FROM users WHERE id IN (${ids})`,
  ];
  for (const u of people) {
    const vault = `vault-${u.id}`;
    statements.push(
      `INSERT INTO users (id, google_sub, email, name, created_at) VALUES (${sql(u.id)}, ${sql(u.sub)}, ${sql(u.email)}, ${sql(u.name)}, ${now})`,
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${sql(await sha256(u.token))}, ${sql(u.id)}, ${now + 30 * 86_400_000})`,
      `INSERT INTO vaults (id, owner_id, name, created_at) VALUES (${sql(vault)}, ${sql(u.id)}, 'Personal', ${now})`,
      `INSERT INTO vault_members (vault_id, user_id, role) VALUES (${sql(vault)}, ${sql(u.id)}, 'owner')`,
    );
  }
  mkdirSync('.wrangler', { recursive: true });
  writeFileSync('.wrangler/demo.sql', statements.join(';\n') + ';\n');
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'notes-app', '--local', '--file', '.wrangler/demo.sql'], { stdio: 'ignore' });
}

// ---- API ----

async function call<T>(who: Person, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' },
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

async function push(who: Person, drafts: Draft[], keys: Map<string, CryptoKey>) {
  const records: CardRecord[] = [];
  for (const d of drafts) {
    const json = JSON.stringify(d.payload);
    const key = keys.get(d.vaultId);
    records.push({
      id: d.id,
      vault_id: d.vaultId,
      updated_at: d.at,
      deleted: false,
      seq: 0,
      payload: key ? await encryptPayload(key, json, d.id, d.vaultId) : json,
    });
  }
  for (let i = 0; i < records.length; i += PUSH_LIMIT) {
    const { results } = await call<{ results: { status: string }[] }>(who, '/sync/push', { records: records.slice(i, i + PUSH_LIMIT) });
    const failed = results.filter((r) => r.status !== 'ok');
    if (failed.length) throw new Error(`Push refused: ${JSON.stringify(failed)}`);
  }
}

// ---- The demo ----

export async function seed() {
  await fetch(`${API}/config`).catch(() => {
    throw new Error('The local server isn\'t running. Start it with `npm run dev:api` first.');
  });

  await resetAccounts([DEMO, SAM]);

  const personal = `vault-${DEMO.id}`;
  const samPersonal = `vault-${SAM.id}`;
  const family = await call<Vault>(DEMO, '/vaults', { name: 'Family' });
  await call(DEMO, `/vaults/${family.id}/members`, { email: SAM.email, role: 'editor' });
  const sealed = await createVaultKey(DEMO_PIN);
  const privateVault = await call<Vault>(DEMO, '/vaults', { name: 'Private', pin: await hashPin(DEMO_PIN), encryption: sealed.encryption });
  const keys = new Map([[privateVault.id, sealed.key]]);

  const mine: Draft[] = [];
  const add = (id: string, vaultId: string, when: number, payload: NewPayload) => {
    mine.push({ id, vaultId, at: when, payload: { createdAt: when, ...payload } as CardPayload });
    return id;
  };
  const tag = (id: string, title: string, pinned: boolean, description = '') =>
    add(id, personal, at(9, 9), { type: 'tag', title, pinned, tags: [], content: description ? lines(description) : doc(p()) });
  const note = (id: string, when: number, content: JSONNode, tags: string[] = [], title = '', vaultId = personal) =>
    add(id, vaultId, when, { type: 'note', title, content, tags });
  const todo = (id: string, title: string, due: string | null, extra: { done?: number; tags?: string[]; when?: number } = {}) =>
    add(id, personal, extra.done ?? extra.when ?? at(3, 10), {
      type: 'todo',
      title,
      due,
      status: extra.done ? 'done' : 'open',
      completedAt: extra.done ?? null,
      tags: extra.tags ?? [],
      content: doc(p()),
    });
  const link = (id: string, label: string): JSONNode => ({ type: 'cardLink', attrs: { id, label } });

  // Folders are pinned tags; the rest are plain tags.
  const work = tag('demo-tag-work', 'Work', true, 'Anything for the day job.');
  const home = tag('demo-tag-home', 'Home', true);
  const ideas = tag('demo-tag-ideas', 'Ideas', true, 'Half-baked thoughts worth keeping.');
  const travel = tag('demo-tag-travel', 'Travel', false);
  const reading = tag('demo-tag-reading', 'Reading', false);
  const recipes = tag('demo-tag-recipes', 'Recipes', false);

  // A week of notes, oldest first.
  const packing = note('demo-note-packing', at(8, 21, 10), doc(bullets('Passport', 'Phone charger and adapter', 'Rain jacket', 'Comfortable shoes', 'Snacks for the flight')), [travel], 'Packing list');
  const kyoto = note(
    'demo-note-kyoto',
    at(8, 21, 30),
    doc(
      p('Kyoto, 4 days in April.'),
      steps('Fushimi Inari early, before the crowds', 'Arashiyama bamboo grove', 'Nishiki market for lunch', 'Philosopher\'s Path at sunset'),
      p('Pack using the ', link(packing, 'Packing list'), '.'),
    ),
    [travel],
    'Kyoto trip',
  );
  note('demo-note-wifi', at(7, 9, 2), lines('Guest wifi: Lemon-Tree / password on the fridge'), [home]);
  note('demo-note-standup', at(7, 10, 15), doc(h('Standup'), bullets('Shipped the search fix', 'Reviewing the export PR', 'Blocked on design for onboarding')), [work]);
  note('demo-note-book', at(6, 22, 40), doc(p(text('Thinking, Fast and Slow', ['italic'])), quote('Nothing in life is as important as you think it is, while you are thinking about it.'), p('Chapter 3 next.')), [reading]);
  note('demo-note-idea-app', at(5, 8, 5), lines('App idea: a plant watering reminder that reads the weather forecast and skips rainy days.'), [ideas]);
  note('demo-note-curry', at(5, 19, 30), doc(p(text('Weeknight curry', ['bold'])), bullets('1 onion, 2 garlic cloves, ginger', '2 tbsp curry paste', '1 can coconut milk', 'Chickpeas and spinach'), p('Simmer 20 minutes. Rice on the side.')), [recipes], 'Curry');
  note('demo-note-zh', at(4, 12, 20), lines('今天天氣很好，午餐去吃了牛肉麵。', '下次要試試隔壁的水餃店。'));
  note('demo-note-1on1', at(4, 15, 0), doc(p('1:1 with Mia'), bullets('Wants to lead the API migration', 'Conference budget: yes, up to two people', 'Follow up on hiring plan')), [work]);
  note('demo-note-quote', at(3, 7, 45), lines('"The best time to plant a tree was 20 years ago. The second best time is now."'), [ideas]);
  note('demo-note-gift', at(3, 20, 10), doc(p('Gift ideas for Mom'), bullets('Pottery class', 'The new cookbook she mentioned', 'Framed photo from the beach trip')), [home]);
  note('demo-note-short', at(2, 13, 33), lines('Parking: level 3, spot C14'));
  note('demo-note-meeting', at(1, 11, 0), doc(h('Design review'), p('Decided to keep the sidebar and move settings under the account menu.'), p('Next: prototype by Friday. See ', link(kyoto, 'Kyoto trip'), ' for the photo layout we liked.')), [work, ideas]);
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
  note('demo-note-today-1', ago(95), lines('Call the dentist about Thursday'));
  note('demo-note-today-2', ago(40), lines('Buy oat milk, bananas and coffee beans'), [home]);
  note('demo-note-secret', at(2, 23, 0), lines('Gift budget this year: 300. Don\'t tell anyone.'), [], '', privateVault.id);

  // Todos: overdue, today, upcoming, no date, and done.
  todo('demo-todo-taxes', 'File the tax return', addDays(today, -2), { tags: [home] });
  todo('demo-todo-plants', 'Water the plants', today, { tags: [home] });
  todo('demo-todo-review', 'Review the export PR', today, { tags: [work] });
  todo('demo-todo-flights', 'Book flights to Kyoto', addDays(today, 3), { tags: [travel] });
  todo('demo-todo-dentist', 'Dentist appointment', addDays(today, 7));
  todo('demo-todo-read', 'Finish chapter 3', null, { tags: [reading] });
  todo('demo-todo-groceries', 'Groceries', addDays(today, -1), { done: at(1, 18, 0), tags: [home] });

  // The diary lives in the private vault, so it needs the PIN.
  const diary = (days: number, content: JSONNode) => {
    const date = addDays(today, -days);
    add(diaryId(privateVault.id, date), privateVault.id, at(days, 22, 0), { type: 'diary', date, title: '', tags: [], content });
  };
  diary(3, lines('Quiet day. Long walk by the river after work.'));
  diary(2, lines('Tried the curry recipe. Too much ginger, but good.'));
  diary(1, doc(p('Design review went well.'), p('Grateful for:'), bullets('Sunny weather', 'A good book', 'Dinner with Sam')));

  // A shared vault with Sam: notes from both of you.
  note('demo-family-groceries', at(2, 17, 0), doc(p('Shared shopping list'), bullets('Rice', 'Eggs', 'Dish soap')), [], '', family.id);
  note('demo-family-trip', at(1, 9, 30), lines('Summer trip: beach or mountains? Vote below.'), [], 'Summer trip', family.id);

  await push(DEMO, mine, keys);

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
    ],
    new Map(),
  );
  await call(SAM, '/cards/demo-family-trip/comments', { body: 'Mountains! The beach was too crowded last year.' });
  await call(SAM, '/cards/demo-sam-recipe/shares', { email: DEMO.email, role: 'comment' });

  writeFileSync(SESSION_FILE, JSON.stringify({ token: DEMO.token, user: { id: DEMO.id, email: DEMO.email, name: DEMO.name } }));
  return { cards: mine.length + 2, pin: DEMO_PIN, recoveryKey: sealed.recoveryKey };
}
