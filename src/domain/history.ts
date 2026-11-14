import { previewLines } from './content';
import { repeatLabel } from './repeat';
import type { Card, JSONNode, Repeat } from './types';

export type Piece = { kind: 'same' | 'added' | 'removed'; text: string };
/** One line of a comparison. A changed line carries word-level pieces. */
export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string } | { kind: 'changed'; pieces: Piece[] };

type TitleOf = (id: string, label: string) => string;

/**
 * A card as lines of text, for comparing two versions of it. Formatting is dropped; the title,
 * tags and todo fields are lines too, so changes to them show up.
 */
export function cardLines(card: Card, titleOf?: TitleOf, tagName: (id: string) => string = (id) => id): string[] {
  const lines: string[] = [];
  lines.push(`Title: ${card.title.trim() || 'Untitled'}`);
  if (card.type === 'todo') {
    lines.push(`Status: ${card.status === 'done' ? 'Done' : 'Open'}`);
    if (card.due) lines.push(`Due: ${card.due}${card.dueTime ? ` ${card.dueTime}` : ''}`);
    if (card.repeat) lines.push(`Repeats: ${repeatLabel(card.repeat)}`);
  }
  if (card.tags.length) lines.push(`Tags: ${card.tags.map(tagName).join(', ')}`);
  lines.push(...previewLines(card.content, titleOf, true));
  return lines;
}

/** Longest-common-subsequence diff. Falls back to "all removed, all added" when inputs are huge. */
function lcsDiff<T>(a: T[], b: T[], same: (x: T, y: T) => boolean, limit = 4_000_000): ('same' | 'removed' | 'added')[] | null {
  const n = a.length;
  const m = b.length;
  if (n * m > limit) return null;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = same(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: ('same' | 'removed' | 'added')[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(a[i], b[j])) {
      ops.push('same');
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push('removed');
      i++;
    } else {
      ops.push('added');
      j++;
    }
  }
  while (i++ < n) ops.push('removed');
  while (j++ < m) ops.push('added');
  return ops;
}

/** Words, runs of spaces, and single CJK characters, which aren't separated by spaces. */
const TOKEN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]|\s+|[^\s぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]+/g;

export function diffWords(before: string, after: string): Piece[] {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  const ops = lcsDiff(a, b, (x, y) => x === y, 1_000_000);
  if (!ops) {
    return [
      { kind: 'removed', text: before },
      { kind: 'added', text: after },
    ];
  }
  const pieces: Piece[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    const text = op === 'added' ? b[j++] : a[i++];
    if (op === 'same') j++;
    const last = pieces.at(-1);
    if (last?.kind === op) last.text += text;
    else pieces.push({ kind: op, text });
  }
  return pieces;
}

/** Share of a line that must survive an edit for the edit to be shown word by word. */
const MOSTLY_KEPT = 0.4;

/**
 * Compares two versions line by line. A run of removed lines followed by added ones is paired up
 * as changed lines, so a small edit in a long paragraph shows only the words that changed.
 */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  const ops = lcsDiff(before, after, (x, y) => x === y) ?? [...before.map(() => 'removed' as const), ...after.map(() => 'added' as const)];
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === 'same') {
      out.push({ kind: 'same', text: before[i++] });
      j++;
      k++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (k < ops.length && ops[k] !== 'same') {
      if (ops[k] === 'removed') removed.push(before[i++]);
      else added.push(after[j++]);
      k++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++) {
      const pieces = diffWords(removed[p], added[p]);
      const kept = pieces.filter((piece) => piece.kind === 'same').reduce((n, piece) => n + piece.text.trim().length, 0);
      // A line that was mostly rewritten reads better as the old line and the new one.
      if (kept < MOSTLY_KEPT * Math.max(removed[p].length, added[p].length)) {
        out.push({ kind: 'removed', text: removed[p] }, { kind: 'added', text: added[p] });
      } else {
        out.push({ kind: 'changed', pieces });
      }
    }
    for (const text of removed.slice(pairs)) out.push({ kind: 'removed', text });
    for (const text of added.slice(pairs)) out.push({ kind: 'added', text });
  }
  return out;
}

/** Where unchanged lines were left out of a comparison, and how many. */
export type DiffGap = { kind: 'gap'; count: number };

/** Only the lines that changed, each with a line or so of what's around it, for showing a change in a long card. */
export function diffExcerpt(lines: DiffLine[], context = 1): (DiffLine | DiffGap)[] {
  const keep = lines.map(() => false);
  lines.forEach((line, i) => {
    if (line.kind === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | DiffGap)[] = [];
  let skipped = 0;
  const gap = () => {
    if (skipped) out.push({ kind: 'gap', count: skipped });
    skipped = 0;
  };
  lines.forEach((line, i) => {
    if (!keep[i]) return void skipped++;
    gap();
    out.push(line);
  });
  gap();
  return out;
}

/** Counts of words added and removed, for a version's summary line. */
export function changeSize(diff: DiffLine[]): { added: number; removed: number } {
  const words = (text: string) => (text.match(TOKEN) ?? []).filter((t) => t.trim()).length;
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === 'added') added += words(line.text);
    else if (line.kind === 'removed') removed += words(line.text);
    else if (line.kind === 'changed') {
      for (const p of line.pieces) {
        if (p.kind === 'added') added += words(p.text);
        else if (p.kind === 'removed') removed += words(p.text);
      }
    }
  }
  return { added, removed };
}

export interface RestoreFields {
  type?: 'note' | 'todo';
  title?: string;
  content?: JSONNode;
  tags?: string[];
  status?: 'open' | 'done';
  due?: string | null;
  dueTime?: string | null;
  repeat?: Repeat | null;
  pinned?: boolean;
}

/** The fields a restore puts back, a note or todo's type among them (one can become the other). The ID and vault stay as they are. */
export function restorePatch(version: Card): RestoreFields {
  switch (version.type) {
    case 'note':
      return { type: 'note', title: version.title, content: version.content, tags: version.tags };
    case 'todo':
      return { type: 'todo', title: version.title, content: version.content, tags: version.tags, status: version.status, due: version.due, dueTime: version.dueTime ?? null, repeat: version.repeat ?? null };
    case 'tag':
      return { title: version.title, content: version.content, pinned: version.pinned };
  }
}

/** True if the two hold the same text and fields, ignoring sync bookkeeping. */
export function sameContent(a: Card, b: Card): boolean {
  return JSON.stringify(restorePatch(a)) === JSON.stringify(restorePatch(b));
}
