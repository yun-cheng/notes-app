import { describe, expect, it } from 'vitest';
import {
  appendRecent, canRedo, canUndo, changedFields, describeChange, groupChanges, inLog, isTextChange, madeBy, matchesChange, mergeHistory, nextRedo, nextUndo, reachOf,
  refreshRecent, revertCard, sealLocked, syncedChange, versionEntry, type Change, type ChangeSource,
} from './changes';
import type { RecentVersion } from '../sync/protocol';
import { doc, note, p, tag, text, todo } from './testFixtures';
import type { Card } from './types';

const TODAY = '2026-11-13';
let n = 0;
const change = (before: Card | null, after: Card, over: Partial<Change> = {}): Change => ({
  n: ++n, at: n, until: n, group: `g${n}`, cardId: after.id, before, after, fields: before ? changedFields(before, after) : [], sealed: false, ...over,
});
const body = (t: string) => doc(p(text(t)));

describe('changed fields', () => {
  it('names what differs, leaving out the bookkeeping every save touches', () => {
    const before = note('a', 'One');
    expect(changedFields(before, { ...before, title: 'Two', updatedAt: 9, seq: 4 })).toEqual(['title']);
    expect(changedFields(before, { ...before, deleted: true, vaultId: 'w' })).toEqual(['deleted', 'vaultId']);
    expect(changedFields(before, { ...before, content: { ...before.content } })).toEqual([]);
  });

  it('counts a field only one side has', () => {
    const open = todo('t', '2026-11-13');
    expect(changedFields(open, { ...open, dueTime: '09:00' })).toEqual(['dueTime']);
    const asNote = note('t', 't');
    expect(changedFields(open, asNote)).toEqual(['completedAt', 'due', 'status', 'type']);
  });

  it('knows a change to the words from any other', () => {
    expect(isTextChange(['content', 'title'])).toBe(true);
    expect(isTextChange(['content', 'tags'])).toBe(false);
    expect(isTextChange([])).toBe(false);
  });
});

describe('describing a change', () => {
  const open = todo('t', null);
  const says = (before: Card | null, after: Card) => describeChange(change(before, after));

  it('says what happened in a few words', () => {
    expect(says(null, open)).toBe('Created');
    expect(says(open, { ...open, deleted: true })).toBe('Moved to Trash');
    expect(says({ ...open, deleted: true }, open)).toBe('Restored from Trash');
    expect(says(open, { ...open, status: 'done', completedAt: 5 })).toBe('Marked done');
    expect(says({ ...open, status: 'done', completedAt: 5 }, open)).toBe('Reopened');
    expect(says(open, note('t', 't'))).toBe('Turned into a note');
    expect(says(open, { ...open, vaultId: 'w' })).toBe('Moved to another vault');
    expect(says(open, { ...open, due: '2026-11-14' })).toBe('Changed due date');
    expect(says(open, { ...open, tags: ['x'] })).toBe('Changed tags');
    expect(says(open, { ...open, color: 'red' })).toBe('Changed color');
  });

  it('calls new words an edit, and a new title on a note or tag a rename', () => {
    expect(says(open, { ...open, title: 'milk' })).toBe('Edited');
    expect(says(note('a', 'One'), note('a', 'Two'))).toBe('Renamed');
    expect(says(note('a', 'One'), note('a', 'Two', { content: body('x') }))).toBe('Edited');
    expect(says(tag('g', 'Work'), tag('g', 'Work', true))).toBe('Pinned');
  });
});

describe('undo and redo of one change', () => {
  const before = todo('t', null, { title: 'milk' });
  const after = { ...before, status: 'done' as const, completedAt: 50, updatedAt: 50 };
  const ticked = change(before, after);

  it('takes back only the fields the change set, keeping what the card gained since', () => {
    const current = { ...after, tags: ['x'], updatedAt: 60, seq: 3 };
    expect(canUndo(ticked, current)).toBe(true);
    const undone = revertCard(current, ticked, 'undo');
    expect(undone).toEqual({ ...current, status: 'open', completedAt: null });
    expect(canRedo({ ...ticked, undoneAt: 70 }, undone)).toBe(true);
    expect(revertCard(undone, ticked, 'redo')).toEqual(current);
  });

  it('refuses when the card no longer holds what the change left', () => {
    expect(canUndo(ticked, { ...after, status: 'open', completedAt: null })).toBe(false);
    expect(canUndo(ticked, undefined)).toBe(false);
    expect(canUndo({ ...ticked, undoneAt: 70 }, after)).toBe(false);
    expect(canUndo({ ...ticked, sealed: true }, after)).toBe(false);
    expect(canRedo(ticked, before)).toBe(false);
    expect(canRedo({ ...ticked, undoneAt: 70 }, after)).toBe(false);
  });

  it('drops fields the other side never had, so a note turned todo goes back whole', () => {
    const asNote = note('n', '', { content: body('buy milk') });
    const asTodo = todo('n', null, { title: 'buy milk' });
    const retyped = change(asNote, asTodo);
    const back = revertCard(asTodo, retyped, 'undo');
    expect(back).toEqual(asNote);
    expect(Object.keys(back)).not.toContain('status');
  });

  it('undoes a new card by moving it to the Trash, whatever was written in it since', () => {
    const made = change(null, before);
    const current = { ...before, title: 'oat milk' };
    expect(canUndo(made, current)).toBe(true);
    const gone = revertCard(current, made, 'undo');
    expect(gone).toEqual({ ...current, deleted: true });
    expect(canUndo(made, gone)).toBe(false);
    expect(canRedo({ ...made, undoneAt: 9 }, gone)).toBe(true);
    expect(revertCard(gone, made, 'redo')).toEqual(current);
  });
});

describe('filtered history', () => {
  const open = todo('t', null, { createdAt: new Date(2026, 10, 13, 9).getTime(), tags: ['work'] });
  const done = { ...open, status: 'done' as const, completedAt: 5 };

  it('keeps a change whose card passed the filter before it or after it', () => {
    const ticked = change(open, done);
    expect(matchesChange(ticked, {}, TODAY)).toBe(true);
    expect(matchesChange(ticked, { status: 'open' }, TODAY)).toBe(true);
    expect(matchesChange(ticked, { status: 'done' }, TODAY)).toBe(true);
    expect(matchesChange(ticked, { type: 'note' }, TODAY)).toBe(false);
    expect(matchesChange(ticked, { tagId: 'work' }, TODAY)).toBe(true);
    expect(matchesChange(change(open, { ...open, tags: [] }), { tagId: 'work' }, TODAY)).toBe(true);
    expect(matchesChange(ticked, { tagId: 'home' }, TODAY)).toBe(false);
    expect(matchesChange(ticked, { when: 'today' }, TODAY)).toBe(true);
    expect(matchesChange(ticked, { when: '2026-11-12' }, TODAY)).toBe(false);
    expect(matchesChange(change(open, { ...open, vaultId: 'w' }), { vaultId: 'w' }, TODAY)).toBe(true);
    expect(matchesChange(ticked, { vaultId: 'w' }, TODAY)).toBe(false);
  });

  it('shows changes to tags when nothing narrows the entries, or under the tag itself', () => {
    const renamed = change(tag('work', 'Work'), tag('work', 'Job'));
    expect(matchesChange(renamed, {}, TODAY)).toBe(true);
    expect(matchesChange(renamed, { vaultId: 'v' }, TODAY)).toBe(true);
    expect(matchesChange(renamed, { tagId: 'work' }, TODAY)).toBe(true);
    expect(matchesChange(renamed, { tagId: 'home' }, TODAY)).toBe(false);
    expect(matchesChange(renamed, { type: 'todo' }, TODAY)).toBe(false);
  });

  it('knows only the vault of a change it cannot read', () => {
    const locked = change(open, done, { sealed: true });
    expect(matchesChange(locked, {}, TODAY)).toBe(true);
    expect(matchesChange(locked, { vaultId: 'v' }, TODAY)).toBe(true);
    expect(matchesChange(locked, { vaultId: 'w' }, TODAY)).toBe(false);
    expect(matchesChange(locked, { type: 'todo' }, TODAY)).toBe(false);
    expect(matchesChange(locked, { tagId: 'work' }, TODAY)).toBe(false);
  });
});

describe('changes in a locked vault', () => {
  it('can’t be read while the vault they are in, or came from, is locked', () => {
    const a = { ...note('a', 'One'), vaultId: 'v' };
    const edit = change(a, { ...a, title: 'Two' });
    const move = change(a, { ...a, vaultId: 'w' });
    expect(sealLocked(edit, new Set(['v']))).toMatchObject({ sealed: true });
    expect(sealLocked(move, new Set(['v'])).sealed).toBe(true);
    expect(sealLocked(move, new Set(['w'])).sealed).toBe(true);
    expect(sealLocked(change(null, a), new Set(['v'])).sealed).toBe(true);
    expect(sealLocked(edit, new Set(['w']))).toBe(edit);
    expect(sealLocked(edit, new Set())).toBe(edit);
  });
});

describe('what undo and redo pick', () => {
  const a = note('a', 'A');
  const b = note('b', 'B');
  const all = () => true;

  it('gathers changes by action, newest first', () => {
    const one = change(a, { ...a, deleted: true }, { group: 'x' });
    const two = change(b, { ...b, deleted: true }, { group: 'x' });
    const three = change(a, { ...a, title: 'AA' }, { group: 'y' });
    expect(groupChanges([one, two, three]).map((g) => [g.group, g.changes.map((c) => c.n)])).toEqual([['y', [three.n]], ['x', [two.n, one.n]]]);
  });

  it('undoes the newest action that has anything to undo, skipping what cannot be', () => {
    const one = change(a, { ...a, deleted: true }, { group: 'x' });
    const two = change(b, { ...b, deleted: true }, { group: 'x' });
    const three = change(a, { ...a, title: 'AA' }, { group: 'y' });
    expect(nextUndo([one, two, three], all)).toEqual([three]);
    expect(nextUndo([one, two, { ...three, undoneAt: 99 }], all)).toEqual([two, one]);
    expect(nextUndo([one, two, three], (c) => c.cardId === 'b')).toEqual([two]);
    expect(nextUndo([{ ...one, undoneAt: 99 }], all)).toEqual([]);
  });

  it('redoes what was undone last, until a new change is made', () => {
    const one = change(a, { ...a, title: 'A1' }, { until: 10 });
    const two = change(b, { ...b, title: 'B1' }, { until: 20 });
    expect(nextRedo([one, two], all)).toEqual([]);
    const undoneTwo = { ...two, undoneAt: 30 };
    expect(nextRedo([one, undoneTwo], all)).toEqual([undoneTwo]);
    const undoneOne = { ...one, undoneAt: 40 };
    expect(nextRedo([undoneOne, undoneTwo], all)).toEqual([undoneOne]);
    // With the first redone, the second is next: nothing was made after it was undone.
    expect(nextRedo([one, undoneTwo], all)).toEqual([undoneTwo]);
    const fresh = change(a, { ...a, title: 'A2' }, { until: 50 });
    expect(nextRedo([one, undoneTwo, fresh], all)).toEqual([]);
    expect(nextRedo([one, undoneTwo], () => false)).toEqual([]);
  });
});

describe('changes that came by sync', () => {
  const version = (over: Partial<RecentVersion> = {}): RecentVersion => ({
    id: 7, started_at: 100, saved_at: 160, author: 'Ann', via: null, card_id: 'a', vault_id: 'v', payload: 'new', deleted: false,
    before: { payload: 'old', deleted: false }, mine: true, device: { here: false, name: 'Safari on iPhone' }, ...over,
  });
  const by = (over: Partial<ChangeSource> = {}): ChangeSource => ({ author: 'Ann', mine: true, via: null, device: null, ...over });

  it('reads a version as a log entry of its own, outside the log’s numbering', () => {
    expect(versionEntry(version({ deleted: true }))).toEqual({
      n: -7, at: 100, until: 160, group: 'v:7', cardId: 'a', fields: [],
      before: { id: 'a', vault_id: 'v', updated_at: 100, deleted: false, seq: 0, payload: 'old' },
      after: { id: 'a', vault_id: 'v', updated_at: 160, deleted: true, seq: 0, payload: 'new' },
    });
    expect(versionEntry(version({ before: null })).before).toBeNull();
  });

  it('says what a version changed and who made it', () => {
    const before = note('a', 'One');
    const made = syncedChange(change(before, { ...before, title: 'Two' }, { fields: [] }), version({ via: 'Claude' }))!;
    expect(made.fields).toEqual(['title']);
    expect(made.by).toEqual({ author: 'Ann', mine: true, via: 'Claude', device: { here: false, name: 'Safari on iPhone' } });
    expect(describeChange(syncedChange(change(before, { ...before, deleted: true }, { fields: [] }), version())!)).toBe('Moved to Trash');
  });

  it('drops a version that changed nothing, and takes a card’s first words for its making', () => {
    const before = note('a', 'One');
    expect(syncedChange(change(before, { ...before, updatedAt: 9 }, { fields: [] }), version())).toBeNull();
    const blank = { ...note('b', ''), content: doc() };
    expect(syncedChange(change(null, blank), version())).toBeNull();
    expect(syncedChange(change(blank, { ...blank, title: 'Hello' }, { fields: [] }), version())).toMatchObject({ before: null, fields: [] });
    expect(syncedChange(change(before, before, { sealed: true, fields: [] }), version())).toMatchObject({ sealed: true, by: { author: 'Ann' } });
  });

  it('names who or what made it', () => {
    expect(madeBy(by({ via: 'Claude' }))).toBe('Claude (AI)');
    expect(madeBy(by({ mine: false, author: 'Ben', via: 'Claude' }))).toBe('Ben via Claude (AI)');
    expect(madeBy(by({ mine: false, author: 'Ben' }))).toBe('Ben');
    expect(madeBy(by({ mine: false, author: null }))).toBe('Someone');
    expect(madeBy(by({ device: { here: true, name: 'Chrome on Mac' } }))).toBe('This device');
    expect(madeBy(by({ device: { here: false, name: 'Safari on iPhone' } }))).toBe('Safari on iPhone');
    expect(madeBy(by({ device: { here: false, name: null } }))).toBe('Another device');
    expect(madeBy(by())).toBe('One of your devices');
  });

  it('leaves this device’s own changes to its log, for as far back as the log goes', () => {
    const a = note('a', 'One');
    const log = [change(a, { ...a, title: 'Two' }, { at: 500, until: 560 })];
    const synced = (source: Partial<ChangeSource>, at: number, until: number, card = a) => change(card, { ...card, title: 'x' }, { at, until, by: by(source) });
    const here = { device: { here: true, name: null } };
    expect(inLog(synced(here, 900, 950, note('b', 'B')), log)).toBe(true);
    expect(inLog(synced(here, 100, 499), log)).toBe(false);
    expect(inLog(synced({ device: { here: false, name: null } }, 500, 560), log)).toBe(false);
    expect(inLog(synced({ ...here, via: 'Claude' }, 500, 560), log)).toBe(false);
    expect(inLog(synced({ ...here, mine: false }, 500, 560), log)).toBe(false);
    expect(inLog(synced(here, 500, 560), [])).toBe(false);
  });

  it('takes an unsigned version for this device’s when the log has the card changing then', () => {
    const a = note('a', 'One');
    const log = [change(a, { ...a, title: 'Two' }, { at: 500, until: 560 }), change(a, { ...a, title: 'Three' }, { at: 700, until: 700, undoneAt: 800 })];
    const synced = (at: number, until: number, card = a) => change(card, { ...card, title: 'x' }, { at, until, by: by() });
    expect(inLog(synced(540, 600), log)).toBe(true);
    expect(inLog(synced(561, 650), log)).toBe(false);
    expect(inLog(synced(540, 600, note('b', 'B')), log)).toBe(false);
    // Undoing a change saved the card again.
    expect(inLog(synced(790, 800), log)).toBe(true);
  });

  it('keeps the older pages when the newest is asked again, unless too much is new to meet them', () => {
    const at = (...ids: number[]) => ids.map((id) => version({ id, saved_at: id * 10 }));
    const ids = (pages: { versions: RecentVersion[] }) => pages.versions.map((v) => v.id);
    const had = appendRecent({ versions: at(9, 8, 7), next: '70-7' }, { versions: at(7, 6, 5), next: '50-5' });
    expect(ids(had)).toEqual([9, 8, 7, 6, 5]);
    expect(reachOf(had)).toBe(50);
    expect(reachOf({ versions: at(1), next: null })).toBe(-Infinity);
    expect(reachOf(null)).toBe(-Infinity);

    const met = refreshRecent(had, { versions: at(11, 10, 9), next: '90-9' });
    expect([ids(met), met.next]).toEqual([[11, 10, 9, 8, 7, 6, 5], '50-5']);
    // A version saved again moves up, and isn't listed twice.
    const moved = refreshRecent(had, { versions: [version({ id: 6, saved_at: 120 }), ...at(9, 8)], next: '80-8' });
    expect([ids(moved), moved.next]).toEqual([[6, 9, 8, 7, 5], '50-5']);
    const apart = refreshRecent(had, { versions: at(30, 29, 28), next: '280-28' });
    expect([ids(apart), apart.next]).toEqual([[30, 29, 28], '280-28']);
    expect(refreshRecent(had, { versions: at(9, 8), next: null }).next).toBeNull();
    expect(refreshRecent(null, { versions: at(9), next: '90-9' }).next).toBe('90-9');
  });

  it('puts both kinds in one history, newest first', () => {
    const a = note('a', 'One');
    const local = groupChanges([change(a, a, { until: 100, group: 'y' }), change(a, a, { until: 300, group: 'x' }), change(a, a, { until: 300, group: 'x' })]);
    const synced = [change(a, a, { n: -1, until: 300, group: 'v:1' }), change(a, a, { n: -2, until: 200, group: 'v:2' })];
    expect(mergeHistory(local, synced).map((g) => [g.group, g.changes.length, g.at])).toEqual([['x', 2, 300], ['v:1', 1, 300], ['v:2', 1, 200], ['y', 1, 100]]);
  });
});
