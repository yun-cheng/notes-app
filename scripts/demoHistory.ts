/**
 * Years of history for the demo account, as a real person's notes pile up: about 10,000 entries over twelve years,
 * thin at first and busier lately, with quiet months and trips, in every vault, of every kind an entry can be, so the
 * apps can be tried at the size they'll have to cope with. What they say matters little; that they're varied does:
 * one-liners and long notes, checklists, lists, headings, quotes, code, web links and links to each other, photos
 * (several to an entry), videos, voice messages (some transcribed) and files, other languages, more than one page,
 * stacks, templates, todos done, overdue, waiting, repeating, at a time and over days, tints, preview styles, view
 * only, hidden words, archived, reactions, comments, history from two devices, entries Sam wrote in shared vaults,
 * and a Trash. Tags too: groups for mood (one, ordered), places and people (many), colors, and one kept to a vault.
 *
 * It's the same every run (a seeded random), dated back from today: the IDs (`demo-gen-…`) stay, so a rerun puts the
 * same entries back. Photos, videos and files are the demo's own, served by the dev server, each a numbered copy
 * (`demo-photo-<name>--<n>`) so no two entries share one.
 */
import { readFileSync, statSync } from 'node:fs';
import { addDays, toDateKey } from '../src/domain/dates';
import type { CardColor, CardPayload, JSONNode, Repeat } from '../src/domain/types';
import { at, bullets, photoNode, cardLink, checklist, code, doc, h, h3, lines, list, nested, p, quote, rule, steps, text, web } from './demoDoc';

/** How many entries, all told, about. */
const TARGET = 10_000;
/** How far back, in days. */
const SPAN = 12 * 365;

export interface HistoryDraft {
  id: string;
  vaultId: string;
  at: number;
  payload: CardPayload;
  /** Written on the phone rather than the laptop. */
  phone: boolean;
  /** Sam's, in a vault shared with Sam. */
  sam: boolean;
  deleted?: boolean;
}
export interface HistoryAttachment {
  id: string;
  owner: string;
  vaultId: string;
  mime: string;
  size: number;
  at: number;
  name: string | null;
}
export interface HistoryComment {
  card: string;
  sam: boolean;
  body: string;
  /** Resolved once written. */
  resolved?: boolean;
}
export interface History {
  /** Tags and groups first, then entries, oldest first. */
  drafts: HistoryDraft[];
  /** Earlier versions of some entries, sent before them, so history has both. */
  earlier: HistoryDraft[];
  attachments: HistoryAttachment[];
  comments: HistoryComment[];
  entries: number;
}

export interface HistoryVaults {
  personal: string;
  family: string;
  work: string;
  projects: string;
  /** Null when the Diary's PIN was changed by hand, or Health was encrypted: their share goes to Personal. */
  diary: string | null;
  health: string | null;
}
/** The demo's own tags, used here too. */
export interface HistoryTags {
  work: string;
  home: string;
  ideas: string;
  travel: string;
  reading: string;
  recipes: string;
  high: string;
  medium: string;
  low: string;
}

// ---- A seeded random ----

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- What's written ----

const ONE_LINERS = [
  'Call the bank about the card.',
  'Coffee with Lee at 10. Talked about the new team.',
  'Rained all day. Stayed in and read.',
  'Fixed the squeaky door at last.',
  'Parking: level 2, spot B7',
  'Remember: the bins go out on Tuesday now.',
  'Long walk by the river after work.',
  'Ordered the new running shoes.',
  'The bakery on the corner closed. Sad.',
  'Slept badly. Early night tonight.',
  'Haircut booked for Saturday at 11.',
  'Watched an old film, still good.',
  'Found the spare key under the plant pot.',
  'Lunch: the noodle place again.',
  'New podcast to try: one about bridges.',
  'Train delayed 40 minutes. Read on the platform.',
  'Paid the electricity bill.',
  'Ava lost her first tooth!',
  'Tried a new route to work. Slower but quieter.',
  'Library books due Friday.',
  'Bought tomatoes, basil, mozzarella.',
  'Cleaned out the fridge.',
  'Sunny for once. Ate outside.',
  'Need a birthday card for Dad.',
  'The cat brought in a leaf. Very proud of it.',
  'Wifi down again in the evening.',
  'Booked the car in for its service.',
  'Good day. Nothing special, just good.',
  'Phone screen cracked. Ugh.',
  'Swapped the winter duvet in.',
];
const OPENERS = [
  'Today was busy from the start.',
  'Woke up early and could not get back to sleep.',
  'A slow Sunday.',
  'Back from the weekend away.',
  'Spent most of the day on one problem.',
  'The weather turned suddenly.',
  'Met an old friend by chance in town.',
  'Finally got around to sorting the spare room.',
  'Work was quieter than expected.',
  'Started something new today.',
];
const MIDDLES = [
  'We talked for hours about nothing much and it was exactly what I needed.',
  'It took twice as long as planned, but it is done and it works.',
  'I keep meaning to write more of these down, so here it is.',
  'The light in the afternoon was lovely, all long shadows.',
  'There is a lot to do next week, but none of it feels heavy yet.',
  'Somebody had left a piano in the square and people took turns playing.',
  'I made a list, then lost the list, then made a better one.',
  'The plan changed three times before lunch.',
  'Dinner was simple: rice, eggs, greens, and a lot of chilli oil.',
  'It is strange how quickly a week goes when it is full.',
  'I should call more often. They were so pleased to hear from me.',
  'Read a few chapters on the train and missed my stop.',
];
const CLOSERS = ['More tomorrow.', 'Bed.', 'Grateful for small things.', 'Note to self: rest.', 'Onwards.', 'That is all for today.', ''];
const ZH = [
  '今天天氣很好，去公園散步了。',
  '晚餐吃了火鍋，太飽了。',
  '下週要交報告，得開始準備。',
  '和媽媽通了電話，她很好。',
  '學了新的單字，記下來：堅持、耐心、溫柔。',
  '下雨天，在家看書喝茶。',
  '週末想去海邊走走。',
  '工作有點累，但是很充實。',
];
const JA = ['今日はとても寒かった。', '駅前のカフェで勉強した。', '新しい本を買いました。', '週末は京都へ行きたい。', 'ありがとうを言うのを忘れないこと。'];
const LIST_TITLES = ['Things to fix', 'Books to read', 'Gift ideas', 'Films to watch', 'Questions for the doctor', 'Weekend plans', 'Restaurants to try', 'Podcast notes', 'Ideas for the garden', 'Before the holiday'];
const LIST_ITEMS = [
  'The leaking tap',
  'A lamp for the hall',
  'Ask about the noise',
  'Thinking in Systems',
  'The one with the lighthouse',
  'A good umbrella',
  'Seeds for the spring',
  'The Korean place on Hill Street',
  'Back up the photos',
  'Renew the insurance',
  'Spare batteries',
  'Frame the print from the trip',
  'New tea, the smoky one',
  'Sort the cables drawer',
  'Return the jacket',
  'Sharpen the knives',
  'Plant the bulbs',
  'Pick up the prescription',
];
const CHECK_TITLES = ['Shopping', 'Packing', 'Before guests come', 'Sunday chores', 'Moving checklist', 'Car trip', 'Party prep', 'Morning routine'];
const CHECK_ITEMS = ['Milk', 'Eggs', 'Bread', 'Coffee', 'Charger', 'Passport', 'Snacks', 'Hoover', 'Clean towels', 'Water the plants', 'Take out recycling', 'Fill the tank', 'Candles', 'Ice', 'Stretch', 'Read for 20 minutes', 'Pay the window cleaner', 'Oil the bike chain'];
const QUOTES = [
  'Simplicity is the ultimate sophistication.',
  'What we do every day matters more than what we do once in a while.',
  'Not all those who wander are lost.',
  'The days are long but the years are short.',
  'Done is better than perfect.',
  'You can do anything, but not everything.',
  'Slow is smooth, smooth is fast.',
];
const WEB: [string, string][] = [
  ['Kintsugi', 'https://en.wikipedia.org/wiki/Kintsugi'],
  ['Wabi-sabi', 'https://en.wikipedia.org/wiki/Wabi-sabi'],
  ['Sourdough', 'https://en.wikipedia.org/wiki/Sourdough'],
  ['Pomodoro Technique', 'https://en.wikipedia.org/wiki/Pomodoro_Technique'],
  ['Lisbon', 'https://en.wikipedia.org/wiki/Lisbon'],
  ['Taipei', 'https://en.wikipedia.org/wiki/Taipei'],
  ['Reykjavík', 'https://en.wikipedia.org/wiki/Reykjav%C3%ADk'],
  ['Bonsai', 'https://en.wikipedia.org/wiki/Bonsai'],
  ['Hygge', 'https://en.wikipedia.org/wiki/Hygge'],
  ['Origami', 'https://en.wikipedia.org/wiki/Origami'],
  ['Espresso', 'https://en.wikipedia.org/wiki/Espresso'],
  ['Compost', 'https://en.wikipedia.org/wiki/Compost'],
  ['Haiku', 'https://en.wikipedia.org/wiki/Haiku'],
  ['Bicycle touring', 'https://en.wikipedia.org/wiki/Bicycle_touring'],
  ['Fermentation in food processing', 'https://en.wikipedia.org/wiki/Fermentation_in_food_processing'],
  ['Markdown', 'https://en.wikipedia.org/wiki/Markdown'],
  ['CRDT', 'https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type'],
  ['SQLite', 'https://en.wikipedia.org/wiki/SQLite'],
];
const WORK_TITLES = ['Standup', 'Planning', 'Retro', 'Design review', '1:1 with Mia', 'Incident review', 'Roadmap', 'Hiring sync', 'Architecture chat', 'Quarterly goals'];
const WORK_POINTS = [
  'Shipped the search fix',
  'Review the export PR',
  'Blocked on the API keys',
  'Agreed to cut scope for the beta',
  'Need numbers before Thursday',
  'Lee to own the migration',
  'On-call handover went fine',
  'Dashboard is too slow, look at the query',
  'Write the release notes',
  'Move the sync job to the night',
  'Two candidates for the final round',
  'Budget approved for the offsite',
];
const PROJECT_TITLES = ['Bike computer', 'Recipe scraper', 'Home server', 'Plant sensor', 'Photo backup script', 'Little game', 'Budget sheet'];
const SNIPPETS: [string, string[]][] = [
  ['js', ['const sum = (xs) => xs.reduce((a, b) => a + b, 0);', 'console.log(sum([1, 2, 3]));']],
  ['ts', ['export function clamp(n: number, lo: number, hi: number) {', '  return Math.min(hi, Math.max(lo, n));', '}']],
  ['py', ['def chunks(xs, n):', '    for i in range(0, len(xs), n):', '        yield xs[i:i + n]']],
  ['sh', ['rsync -av --delete ~/Photos/ /mnt/backup/photos/', 'echo done']],
  ['sql', ['SELECT day, COUNT(*) FROM entries', 'GROUP BY day ORDER BY day DESC LIMIT 7;']],
  ['swift', ['let names = people.map(\\.name).sorted()', 'print(names.joined(separator: ", "))']],
  ['kotlin', ['val evens = (1..10).filter { it % 2 == 0 }', 'println(evens)']],
];
const DIARY = [
  'A hard day, but I handled it better than last time.',
  'Felt lonely this evening. Called Sam and felt better.',
  'Proud of myself for saying no to the extra project.',
  'Anxious about the appointment tomorrow.',
  'Lovely evening. The kind I want to remember.',
  'Tired, but the good kind of tired.',
  'I keep thinking about what Mum said.',
  'Today I noticed I was happy, for no reason at all.',
];
const HEALTH = ['Physio: squats and the hamstring stretch, three sets.', 'Ran 5 km in 31 minutes.', 'Blood pressure 118/76.', 'Slept 7 hours. Better.', 'Headache in the afternoon. More water.', 'Dentist: all fine, back in six months.', 'Knee sore after the stairs.'];
const FAMILY = ['Who is picking Ava up on Thursday?', 'Grandma visits next weekend.', 'School trip form signed.', 'Dinner at ours on Sunday, everyone welcome.', 'The car needs new tyres before winter.', 'Holiday dates: last two weeks of July?'];
const TODO_TITLES = [
  'Renew the car insurance',
  'Book the dentist',
  'Reply to the landlord',
  'Send the invoice',
  'Fix the bike brakes',
  'Buy a present for Ava',
  'Clear the gutters',
  'Update the CV',
  'Return the library books',
  'Call the plumber',
  'Back up the laptop',
  'Cancel the old phone plan',
  'Order contact lenses',
  'Write the thank-you cards',
  'Pay the parking fine',
  'Print the boarding passes',
  'Submit the expenses',
  'Prepare the slides',
  'Read the contract',
  'Plan the weekend',
];
const REPEATING: [string, Repeat][] = [
  ['Water the balcony plants', { unit: 'day', every: 2 }],
  ['Take vitamins', { unit: 'day', every: 1 }],
  ['Timesheet', { unit: 'weekday', every: 1 }],
  ['Change the bed sheets', { unit: 'week', every: 1 }],
  ['Call Mum', { unit: 'week', every: 1 }],
  ['Clean the coffee machine', { unit: 'week', every: 2 }],
  ['Pay the credit card', { unit: 'month', every: 1 }],
  ['Check the smoke alarms', { unit: 'month', every: 6 }],
  ['Car service', { unit: 'year', every: 1 }],
  ['Renew the domain', { unit: 'year', every: 1 }],
  ['Back up the photos', { unit: 'month', every: 1 }],
  ['Book club reading', { unit: 'week', every: 4 }],
];
const STACKS: [string, [string, string][]][] = [
  ['Japanese verbs', [['食べる', 'taberu: to eat'], ['飲む', 'nomu: to drink'], ['行く', 'iku: to go'], ['見る', 'miru: to see']]],
  ['Chinese measure words', [['一本書', 'yī běn shū: a book'], ['一杯茶', 'yī bēi chá: a cup of tea'], ['一隻貓', 'yī zhī māo: a cat']]],
  ['Knots', [['Bowline', 'A fixed loop that will not slip'], ['Clove hitch', 'Quick, to a post'], ['Reef knot', 'Two ends of one rope']]],
  ['Capitals', [['Portugal', 'Lisbon'], ['Iceland', 'Reykjavík'], ['Taiwan', 'Taipei'], ['Korea', 'Seoul']]],
];

const PHOTOS: [string, string][] = [
  ['beach-family', 'All of us on the beach'],
  ['cake', 'A birthday cake'],
  ['coast-lighthouse', 'A lighthouse'],
  ['coast-panorama', 'The beach end to end'],
  ['coast-pier', 'The pier at night'],
  ['coast-sunset', 'Sunset over the sea'],
  ['coast-umbrella', 'An umbrella in the dunes'],
  ['curry', 'A bowl of curry'],
  ['garden', 'Tomatoes on the vine'],
  ['lake', 'The lake'],
  ['map', 'A map'],
  ['skyline', 'The skyline at dusk'],
  ['snow', 'Snow on the street'],
  ['station', 'A station platform'],
  ['torii', 'Torii gates'],
  ['whiteboard', 'A whiteboard'],
  ['wireframe', 'A sketch'],
  ['lake-retake', 'The lake, again'],
];
const VIDEOS: [string, number, number][] = [
  ['waves', 960, 540],
  ['simmer', 540, 540],
  ['lake-pan', 960, 540],
];
const VOICES = ['errands-voice', 'errands-more-voice', 'idea-voice', 'diary-voice'];
const FILES: [string, string, string][] = [
  ['itinerary', 'pdf', 'application/pdf'],
  ['itinerary-draft', 'pdf', 'application/pdf'],
  ['lease', 'pdf', 'application/pdf'],
  ['launch-budget', 'csv', 'text/csv'],
  ['reading-list', 'txt', 'text/plain'],
  ['spice-list', 'txt', 'text/plain'],
];
const COLORS: CardColor[] = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'gray'];
const COMMENTS: [string, string][] = [
  ['Looks good to me.', 'Thanks!'],
  ['Can we do Saturday instead?', 'Saturday works.'],
  ['Did you book it yet?', 'Doing it now.'],
  ['Love this photo.', 'One of my favourites.'],
  ['Should we ask Grandma too?', 'Yes, I will call her.'],
  ['Is this still on?', 'Yes, same time.'],
];

/** The tags this history adds, and its groups: Mood (one, ordered), Places and People (many). */
const NEW_TAGS: [string, string, boolean, CardColor | null][] = [
  ['journal', 'Journal', true, 'gray'],
  ['projects', 'Projects', true, 'purple'],
  ['fitness', 'Fitness', false, 'green'],
  ['garden', 'Garden', false, 'green'],
  ['money', 'Money', false, 'yellow'],
  ['kids', 'Kids', false, 'pink'],
  ['film', 'Film', false, null],
  ['music', 'Music', false, null],
  ['language', 'Language', false, 'blue'],
  ['learning', 'Learning', false, null],
  ['quotes', 'Quotes', false, null],
  ['code', 'Code', false, 'gray'],
  ['meetings', 'Meetings', false, 'blue'],
  ['gratitude', 'Gratitude', false, 'orange'],
  ['dreams', 'Dreams', false, 'purple'],
  ['car', 'Car', false, null],
  ['shopping', 'Shopping', false, null],
  ['podcasts', 'Podcasts', false, null],
  ['friends', 'Friends', false, 'pink'],
  ['house', 'House', false, null],
  ['mood-great', 'Great', false, 'green'],
  ['mood-good', 'Good', false, 'blue'],
  ['mood-okay', 'Okay', false, 'gray'],
  ['mood-low', 'Low', false, 'red'],
  ['place-tokyo', 'Tokyo', false, null],
  ['place-lisbon', 'Lisbon', false, null],
  ['place-taipei', 'Taipei', false, null],
  ['place-paris', 'Paris', false, null],
  ['place-reykjavik', 'Reykjavík', false, null],
  ['place-seoul', 'Seoul', false, null],
  ['place-newyork', 'New York', false, null],
  ['place-coast', 'The coast', false, null],
  ['person-mia', 'Mia', false, null],
  ['person-lee', 'Lee', false, null],
  ['person-ava', 'Ava', false, null],
  ['person-mum', 'Mum', false, null],
  ['person-dad', 'Dad', false, null],
  ['person-sam', 'Sam', false, null],
];

export function history(v: HistoryVaults, t: HistoryTags, people: { demo: string; sam: string }): History {
  const rand = mulberry32(20261126);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const chance = (p: number) => rand() < p;
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const some = <T>(xs: readonly T[], lo: number, hi: number): T[] => {
    const left = [...xs];
    return Array.from({ length: Math.min(left.length, between(lo, hi)) }, () => left.splice(Math.floor(rand() * left.length), 1)[0]);
  };
  const today = toDateKey(new Date());

  const drafts: HistoryDraft[] = [];
  const earlier: HistoryDraft[] = [];
  const attachments: HistoryAttachment[] = [];
  const comments: HistoryComment[] = [];

  // ---- Tags ----
  const tag = (slug: string) => `demo-gen-tag-${slug}`;
  const tagAt = at(SPAN + 5, 9);
  for (const [slug, title, pinned, color] of NEW_TAGS) {
    drafts.push({ id: tag(slug), vaultId: v.personal, at: tagAt, phone: false, sam: false, payload: { type: 'tag', title, pinned, tags: [], content: doc(p()), createdAt: tagAt, ...(color ? { color } : {}) } });
  }
  const groupOf = (id: string, title: string, members: string[], choice: 'one' | 'many', ordered: boolean) =>
    drafts.push({ id, vaultId: v.personal, at: tagAt, phone: false, sam: false, payload: { type: 'tag', title, pinned: false, tags: [], content: doc(p()), createdAt: tagAt, members, choice, ordered } });
  const moods = ['mood-great', 'mood-good', 'mood-okay', 'mood-low'].map(tag);
  const places = NEW_TAGS.filter(([s]) => s.startsWith('place-')).map(([s]) => tag(s));
  const persons = NEW_TAGS.filter(([s]) => s.startsWith('person-')).map(([s]) => tag(s));
  groupOf('demo-gen-group-mood', 'Mood', moods, 'one', true);
  groupOf('demo-gen-group-places', 'Places', places, 'many', false);
  groupOf('demo-gen-group-people', 'People', persons, 'many', false);
  // Kept to the Work vault: offered only on entries there.
  const sprint = 'demo-gen-tag-sprint';
  drafts.push({ id: sprint, vaultId: v.work, at: tagAt, phone: false, sam: false, payload: { type: 'tag', title: 'Sprint', pinned: false, tags: [], content: doc(p()), createdAt: tagAt, color: 'orange', scope: 'vault' } });
  const tagsAt = drafts.length;

  // ---- Media, each a numbered copy of the demo's own ----
  let copies = 0;
  const own = (_vaultId: string, sam: boolean) => (sam ? people.sam : people.demo);
  const photo = (vaultId: string, when: number, sam: boolean): JSONNode => {
    const [name, alt] = pick(PHOTOS);
    const id = `demo-photo-${name}--${++copies}`;
    attachments.push({ id, owner: own(vaultId, sam), vaultId, mime: 'image/jpeg', size: statSync(`scripts/demoPhotos/${name}.jpg`).size, at: when, name: null });
    return photoNode(name, id, alt);
  };
  const video = (vaultId: string, when: number, sam: boolean): JSONNode => {
    const [name, width, height] = pick(VIDEOS);
    const n = ++copies;
    const id = `demo-file-${name}--${n}`;
    const poster = `demo-file-${name}-poster--${n}`;
    const size = statSync(`scripts/demoFiles/${name}.mp4`).size;
    attachments.push({ id, owner: own(vaultId, sam), vaultId, mime: 'video/mp4', size, at: when, name: `${name}.mp4` });
    attachments.push({ id: poster, owner: own(vaultId, sam), vaultId, mime: 'image/jpeg', size: statSync(`scripts/demoFiles/${name}-poster.jpg`).size, at: when, name: null });
    return { type: 'file', attrs: { id, name: `${name}.mp4`, mime: 'video/mp4', size, poster, width, height, duration: 6 } };
  };
  const voices = JSON.parse(readFileSync('scripts/demoFiles/voices.json', 'utf8')) as Record<string, { duration: number; peaks: number[]; cues: { start: number; text: string }[] }>;
  const voice = (vaultId: string, when: number, sam: boolean, transcribe: boolean): JSONNode => {
    const name = pick(VOICES);
    const { duration, peaks, cues } = voices[name];
    const id = `demo-file-${name}--${++copies}`;
    const size = statSync(`scripts/demoFiles/${name}.m4a`).size;
    attachments.push({ id, owner: own(vaultId, sam), vaultId, mime: 'audio/mp4', size, at: when, name: `${name}.m4a` });
    return {
      type: 'file',
      attrs: { id, name: `${name}.m4a`, mime: 'audio/mp4', size, duration, peaks, ...(transcribe ? { transcript: cues.map((c) => c.text).join(' '), language: 'en', cues } : {}) },
    };
  };
  const file = (vaultId: string, when: number, sam: boolean): JSONNode => {
    const [name, ext, mime] = pick(FILES);
    const id = `demo-file-${name}--${++copies}`;
    const size = statSync(`scripts/demoFiles/${name}.${ext}`).size;
    attachments.push({ id, owner: own(vaultId, sam), vaultId, mime, size, at: when, name: `${name}.${ext}` });
    return { type: 'file', attrs: { id, name: `${name}.${ext}`, mime, size } };
  };

  // ---- When: a rate per day, busier lately, with quiet stretches and trips ----
  const quiet = new Set<number>();
  for (let i = 0; i < 6; i++) {
    const from = between(30, SPAN - 60);
    for (let d = from; d < from + between(25, 70); d++) quiet.add(d);
  }
  const trips = new Map<number, string>();
  for (let year = 0; year < 12; year++) {
    for (let k = 0; k < 2; k++) {
      const from = year * 365 + between(10, 350);
      const place = pick(places);
      for (let d = from; d < from + between(4, 10); d++) if (d > 1 && d < SPAN) trips.set(d, place);
    }
  }
  const rate = (age: number) => (0.5 + 3.3 * Math.pow(1 - age / SPAN, 1.6)) * (quiet.has(age) ? 0.08 : 1) * (trips.has(age) ? 1.6 : 1);
  let expected = 0;
  for (let age = 1; age <= SPAN; age++) expected += rate(age);
  const scale = (TARGET - 220) / expected;

  // ---- Entries ----
  let n = 0;
  const nextId = () => `demo-gen-${String(++n).padStart(5, '0')}`;
  /** Titled entries so far, by vault, to link to. */
  const titled = new Map<string, { id: string; title: string }[]>();
  const moodOf = () => moods[Math.min(3, Math.floor(Math.pow(rand(), 1.4) * 4))];

  const paragraph = () => [pick(OPENERS), pick(MIDDLES), chance(0.5) ? pick(MIDDLES) : '', pick(CLOSERS)].filter(Boolean).join(' ');
  /** A sentence or two with a word made bold, italic, marked as code or hidden, now and then. */
  const styled = (): JSONNode => {
    const roll = rand();
    if (roll < 0.04) return p('The code for the gate is ', text(String(between(1000, 9999)), ['hidden']), '.');
    if (roll < 0.1) return p(pick(OPENERS), ' ', text(pick(['Important', 'Never again', 'Must remember', 'Finally']), ['bold']), ': ', pick(MIDDLES));
    if (roll < 0.14) return p(pick(OPENERS), ' ', text(pick(MIDDLES), ['italic']));
    return p(paragraph());
  };

  /** One entry's front page (and maybe more), by kind. */
  function compose(kind: string, vaultId: string, when: number, sam: boolean, trip: string | undefined) {
    let title = '';
    let content: JSONNode;
    const tags: string[] = [];
    let pages: JSONNode[] | undefined;
    const linkable = titled.get(vaultId) ?? [];
    switch (kind) {
      case 'one':
        content = lines(pick(ONE_LINERS));
        break;
      case 'para':
        content = doc(...Array.from({ length: between(1, 4) }, styled));
        break;
      case 'checklist': {
        title = pick(CHECK_TITLES);
        const old = when < Date.now() - 7 * 86_400_000;
        content = doc(checklist(...some(CHECK_ITEMS, 3, 9).map((i): [string, boolean] => [i, old ? chance(0.85) : chance(0.3)])));
        tags.push(pick([t.home, tag('shopping'), t.travel]));
        break;
      }
      case 'list':
        title = pick(LIST_TITLES);
        content = chance(0.3)
          ? doc(steps(...some(LIST_ITEMS, 3, 7)))
          : chance(0.3)
            ? doc(list('bulletList', nested(pick(LIST_ITEMS), bullets(...some(LIST_ITEMS, 2, 3))), ...some(LIST_ITEMS, 2, 5)))
            : doc(bullets(...some(LIST_ITEMS, 3, 8)));
        break;
      case 'sections':
        title = pick(['Weekly review', 'Plans for the year', 'Notes from the talk', 'Thoughts on moving', 'Trip recap']);
        content = doc(h(pick(['What went well', 'Highlights', 'Summary'])), styled(), bullets(...some(LIST_ITEMS, 2, 4)), h3('Next'), checklist(...some(CHECK_ITEMS, 2, 4).map((i): [string, boolean] => [i, false])), ...(chance(0.4) ? [rule, styled()] : []));
        break;
      case 'quote':
        content = doc(quote(pick(QUOTES)), ...(chance(0.5) ? [p(pick(MIDDLES))] : []));
        tags.push(tag('quotes'));
        break;
      case 'web': {
        const links = some(WEB, 1, 3);
        content = chance(0.4)
          ? doc(p(pick(['Reading list', 'To read later', 'Found this'])), bullets(...links.map(([, href]) => href)))
          : doc(p(pick(['Interesting: ', 'Saved: ', 'Worth a look: ']), web(links[0][0], links[0][1])), ...(links.length > 1 ? [p('Also ', web(links[1][0], links[1][1]))] : []));
        tags.push(t.reading);
        break;
      }
      case 'linked': {
        const to = some(linkable.slice(-300), 1, 3);
        content = to.length ? doc(p(pick(['Follow-up to ', 'See ', 'More on ']), ...to.flatMap((l, i) => [...(i ? [', '] : []), cardLink(l.id, l.title)]), '.'), styled()) : doc(styled());
        break;
      }
      case 'photos': {
        const count = chance(0.55) ? 1 : between(2, 6);
        content = doc(...(chance(0.75) ? [p(pick(trip ? ['Today on the trip.', 'View from the hotel.', 'Lunch spot.', 'Walked all day.'] : ['Look at this.', 'From the walk today.', 'Dinner.', 'This made my day.']))] : []), ...Array.from({ length: count }, () => photo(vaultId, when, sam)));
        break;
      }
      case 'video':
        content = doc(p(pick(['A little video.', 'Had to film this.', 'Sound on.'])), video(vaultId, when, sam), ...(chance(0.4) ? [photo(vaultId, when, sam)] : []));
        break;
      case 'voice':
        content = doc(...(chance(0.4) ? [p(pick(['Voice note on the way home.', 'Thinking out loud.']))] : []), voice(vaultId, when, sam, chance(0.6)));
        break;
      case 'file':
        title = pick(['Documents', 'Receipts', 'The paperwork', 'Plans', '']);
        content = doc(p(pick(['Attached.', 'For the records.', 'Keep this one.'])), file(vaultId, when, sam), ...(chance(0.3) ? [file(vaultId, when, sam)] : []));
        break;
      case 'code': {
        const [language, ls] = pick(SNIPPETS);
        title = chance(0.5) ? pick(PROJECT_TITLES) : '';
        content = doc(p(pick(['Snippet: ', 'This worked: ', 'Note to self: '])), code(language, ...ls), ...(chance(0.4) ? [p('Run with ', text(pick(['npm test', 'make', 'python3 main.py']), ['code']), '.')] : []));
        tags.push(tag('code'));
        break;
      }
      case 'zh':
        content = lines(...some(ZH, 1, 3));
        if (chance(0.5)) tags.push(tag('language'));
        break;
      case 'ja':
        content = lines(...some(JA, 1, 2));
        tags.push(tag('language'));
        break;
      case 'pages':
        title = pick(['Flashcard', 'Recipe', 'Plan', 'Guide']);
        content = doc(styled());
        pages = Array.from({ length: between(1, 3) }, () => doc(h3(pick(['Page two', 'Details', 'More', 'Answers'])), chance(0.5) ? bullets(...some(LIST_ITEMS, 2, 4)) : styled()));
        break;
      case 'work':
        title = pick(WORK_TITLES);
        content = doc(bullets(...some(WORK_POINTS, 2, 5)), ...(chance(0.3) ? [checklist(...some(WORK_POINTS, 2, 3).map((i): [string, boolean] => [i, chance(0.5)]))] : []));
        tags.push(t.work, ...(chance(0.6) ? [tag('meetings')] : []), ...(chance(0.25) ? [sprint] : []));
        break;
      case 'project':
        title = pick(PROJECT_TITLES);
        content = doc(p(paragraph()), ...(chance(0.5) ? [code(...(([l, ls]) => [l, ...ls] as [string, ...string[]])(pick(SNIPPETS)))] : []), ...(chance(0.4) ? [p('Docs: ', web(...pick(WEB)))] : []));
        tags.push(tag('projects'));
        break;
      case 'diary':
        content = doc(p(pick(DIARY)), ...(chance(0.5) ? [p(paragraph())] : []), ...(chance(0.25) ? [p('Grateful for:'), bullets(...some(['Sunshine', 'A good book', 'Dinner with Sam', 'A quiet morning', 'Ava laughing', 'Hot tea'], 1, 3))] : []));
        break;
      case 'health':
        content = lines(pick(HEALTH));
        tags.push(tag('fitness'));
        break;
      case 'family':
        content = chance(0.4) ? doc(p(pick(['Shared list', 'For the weekend', 'Shopping'])), checklist(...some(CHECK_ITEMS, 3, 6).map((i): [string, boolean] => [i, chance(0.5)]))) : lines(pick(FAMILY));
        if (chance(0.3)) tags.push(tag('kids'));
        break;
      default:
        content = lines(pick(ONE_LINERS));
    }
    if (trip && vaultId === v.personal && chance(0.8)) tags.push(t.travel, trip);
    return { title, content, tags, pages };
  }

  const KINDS: [string, number][] = [
    ['one', 26],
    ['para', 14],
    ['checklist', 6],
    ['list', 6],
    ['sections', 3],
    ['quote', 2],
    ['web', 5],
    ['linked', 4],
    ['photos', 10],
    ['video', 1],
    ['voice', 2.5],
    ['file', 1.5],
    ['code', 2],
    ['zh', 4],
    ['ja', 1.5],
    ['pages', 2],
    ['todo', 16],
  ];
  const weighted = (xs: [string, number][]) => {
    let roll = rand() * xs.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of xs) if ((roll -= w) < 0) return k;
    return xs[0][0];
  };
  /** The vault an entry goes in, by when it's written: work on weekdays, the diary at night. */
  function vaultFor(when: number, age: number): { vaultId: string; kind: string; sam: boolean } {
    const d = new Date(when);
    const weekday = d.getDay() > 0 && d.getDay() < 6;
    const hour = d.getHours();
    const roll = rand();
    // A job from five and a half years ago onwards keeps its own vault.
    if (weekday && hour >= 9 && hour < 18 && age < 2000 && roll < 0.3) return { vaultId: v.work, kind: chance(0.5) ? 'work' : weighted([['todo', 4], ['code', 1], ['para', 2], ['checklist', 1], ['file', 0.5], ['web', 1]]), sam: chance(0.15) };
    if (hour >= 21 && roll < 0.25) return v.diary ? { vaultId: v.diary, kind: 'diary', sam: false } : { vaultId: v.personal, kind: 'para', sam: false };
    if (roll < 0.03) return v.health ? { vaultId: v.health, kind: chance(0.7) ? 'health' : 'todo', sam: false } : { vaultId: v.personal, kind: 'health', sam: false };
    if (roll < 0.1 && age < 3000) return { vaultId: v.family, kind: chance(0.5) ? 'family' : weighted([['photos', 4], ['todo', 2], ['video', 0.5], ['one', 2]]), sam: chance(0.35) };
    if (roll < 0.14) return { vaultId: v.projects, kind: chance(0.6) ? 'project' : weighted([['code', 2], ['web', 2], ['todo', 2], ['photos', 1]]), sam: false };
    return { vaultId: v.personal, kind: weighted(KINDS), sam: false };
  }

  const repeating = new Set<number>();
  // The repeating todos, each started some time ago and still going.
  for (let i = 0; i < REPEATING.length; i++) repeating.add(between(5, 900));

  for (let age = SPAN; age >= 1; age--) {
    let count = rate(age) * scale;
    count = Math.floor(count) + (chance(count % 1) ? 1 : 0);
    const trip = trips.get(age);
    const hours = Array.from({ length: count }, () => between(7, 23)).sort((a, b) => a - b);
    for (const hour of hours) {
      const when = at(age, hour, between(0, 59));
      const { vaultId, kind, sam } = vaultFor(when, age);
      const id = nextId();
      const extras: Record<string, unknown> = {};
      let payload: CardPayload;
      if (kind === 'todo') {
        const day = addDays(today, -age);
        const due = chance(0.12) ? null : addDays(day, between(0, 21));
        const late = due !== null && due < today;
        const done = due === null ? age > 30 && chance(0.7) : late ? !chance(age < 60 ? 0.25 : 0.03) : false;
        const finished = done ? Math.min(Date.now() - 3_600_000, when + between(1, 20) * 86_400_000) : null;
        const tags = [
          ...(vaultId === v.work ? [t.work, ...(chance(0.3) ? [sprint] : [])] : chance(0.5) ? [pick([t.home, tag('money'), tag('car'), tag('house'), tag('shopping')])] : []),
          ...(chance(0.35) ? [pick([t.high, t.medium, t.low])] : []),
        ];
        payload = {
          type: 'todo',
          title: pick(TODO_TITLES),
          due,
          ...(due && chance(0.3) ? { dueTime: `${String(between(8, 20)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}` } : {}),
          ...(due && chance(0.15) ? { start: addDays(due, -between(1, 5)) < day ? day : addDays(due, -between(1, 5)) } : {}),
          ...(!done && chance(0.12) ? { waiting: true } : {}),
          status: done ? 'done' : 'open',
          completedAt: finished,
          tags,
          content: chance(0.6) ? doc(p()) : chance(0.5) ? doc(checklist(...some(CHECK_ITEMS, 2, 5).map((i): [string, boolean] => [i, done || chance(0.4)]))) : doc(styled()),
          createdAt: when,
        };
      } else {
        const { title, content, tags, pages } = compose(kind, vaultId, when, sam, trip);
        if (vaultId === v.personal || vaultId === v.diary) {
          if (chance(vaultId === v.diary ? 0.5 : 0.08)) tags.push(moodOf());
          if (chance(0.06)) tags.push(...some(persons, 1, 2));
          if (chance(0.04)) tags.push(pick([t.ideas, tag('journal'), tag('gratitude'), tag('dreams'), tag('film'), tag('music'), tag('podcasts'), tag('friends'), tag('garden'), tag('learning'), t.recipes]));
        }
        payload = { type: 'note', title, content, tags: [...new Set(tags)], createdAt: when, ...(pages ? { pages } : {}) };
        if (title) (titled.get(vaultId) ?? titled.set(vaultId, []).get(vaultId)!).push({ id, title });
      }
      if (chance(0.07)) extras.color = pick(COLORS);
      if (age > 365 && chance(0.04)) extras.archived = true;
      if (chance(0.006)) extras.viewOnly = true;
      if (chance(0.012)) extras.preview = pick([{ photos: 'large' }, { photos: 'off' }, { links: 'compact' }, { links: 'off' }, { photos: 'thumbs', links: 'card' }]);
      if (vaultId === v.family && chance(0.25)) extras.reactions = { [pick(['👍', '❤️', '😂', '🎉'])]: some([people.demo, people.sam], 1, 2) };
      else if (chance(0.01)) extras.reactions = { [pick(['⭐', '🔥', '💡'])]: [people.demo] };
      Object.assign(payload, extras);
      drafts.push({ id, vaultId, at: when, payload, phone: chance(0.4), sam });
      // Some edited later, so their history has an earlier version, from the other device.
      if (payload.type === 'note' && chance(0.025)) {
        const first = (payload.content.content ?? []).slice(0, 1);
        earlier.push({ id, vaultId, at: when - 3_600_000, payload: { ...payload, content: doc(...(first.length ? first : [p()])) }, phone: !drafts[drafts.length - 1].phone, sam });
      }
      if ((vaultId === v.family || vaultId === v.work) && chance(0.08)) {
        const [ask, answer] = pick(COMMENTS);
        comments.push({ card: id, sam: !sam, body: ask }, { card: id, sam, body: answer, resolved: chance(0.4) });
      }
      // Now and then, flashcards gathered in a stack, in an order of their own.
      if (vaultId === v.personal && chance(0.004)) {
        const [name, cards] = pick(STACKS);
        const ids = cards.map(([front, back], i) => {
          const card = nextId();
          drafts.push({ id: card, vaultId, at: when + i * 60_000, phone: false, sam: false, payload: { type: 'note', title: '', tags: [tag('language')], content: lines(front), pages: [lines(back)], createdAt: when + i * 60_000 } });
          return card;
        });
        drafts.push({ id: nextId(), vaultId, at: when + 300_000, phone: false, sam: false, payload: { type: 'note', title: name, tags: [tag('language')], content: lines('Flip each card for the answer.'), stack: some(ids, ids.length, ids.length), createdAt: when + 300_000 } });
      }
    }
  }

  // Repeating todos, still going: due soon, each from when it was first set.
  REPEATING.forEach(([title, repeat], i) => {
    const from = [...repeating][i];
    const when = at(from, 8, 30);
    drafts.push({
      id: nextId(),
      vaultId: i === 2 ? v.work : v.personal,
      at: when,
      phone: false,
      sam: false,
      payload: { type: 'todo', title, due: addDays(today, between(0, 6)), ...(chance(0.5) ? { dueTime: '09:00' } : {}), repeat, status: 'open', completedAt: null, tags: i === 2 ? [t.work] : [t.home], content: doc(p()), createdAt: when },
    });
  });
  // Two templates of its own.
  for (const [title, vaultId, content] of [
    ['Trip plan, {date}', v.personal, doc(h('Where'), p(), h('Bookings'), checklist(['Flights', false], ['Hotel', false], ['Insurance', false]), h('Ideas'), bullets(''))],
    ['Meeting notes, {date}', v.work, doc(h('Attendees'), bullets(''), h('Decisions'), bullets(''), h('Actions'), checklist(['', false]))],
  ] as [string, string, JSONNode][]) {
    const when = at(400, 9);
    drafts.push({ id: nextId(), vaultId, at: when, phone: false, sam: false, payload: { type: 'note', title, tags: [], content, template: true, createdAt: when } });
  }
  // The Trash: entries put there over the last few weeks, from any time.
  for (let i = 0; i < 150; i++) {
    const age = between(30, SPAN);
    const when = at(age, between(8, 22));
    const { title, content, tags } = compose(pick(['one', 'para', 'checklist', 'list', 'photos', 'web', 'zh']), v.personal, when, false, undefined);
    drafts.push({ id: nextId(), vaultId: v.personal, at: at(between(1, 25), between(8, 22)), phone: chance(0.4), sam: false, deleted: true, payload: { type: 'note', title, content, tags, createdAt: when } });
  }

  return { drafts, earlier, attachments, comments, entries: drafts.length - tagsAt };
}
