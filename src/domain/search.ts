import MiniSearch from 'minisearch';
import { cardText, pagesText, resolveTags, type CardIndex } from './cardIndex';
import type { Card } from './types';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Splits on punctuation, and treats each CJK character as its own term because those scripts have no spaces. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const [word] of text.matchAll(/[\p{L}\p{M}\p{N}_]+/gu)) {
    let run = '';
    for (const ch of word) {
      if (CJK.test(ch)) {
        if (run) tokens.push(run);
        run = '';
        tokens.push(ch);
      } else {
        run += ch;
      }
    }
    if (run) tokens.push(run);
  }
  return tokens;
}

export interface SearchHit {
  card: Card;
  snippet: string;
}

export interface CardSearch {
  search(query: string): SearchHit[];
}

const built = new WeakMap<CardIndex, CardSearch>();

/**
 * The search over an index's cards, made once for each index (each change to the cards makes a new one): indexing
 * thousands of entries takes a while, so the search page, the command palette and a page's search share it.
 */
export function buildSearch(index: CardIndex): CardSearch {
  let search = built.get(index);
  if (!search) built.set(index, (search = makeSearch(index)));
  return search;
}

function makeSearch(index: CardIndex): CardSearch {
  const engine = new MiniSearch<{ id: string; title: string; text: string; tags: string }>({
    fields: ['title', 'text', 'tags'],
    tokenize,
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND', tokenize },
  });
  const texts = new Map<string, string>();
  engine.addAll(
    index.live.map((card) => {
      // Words on the pages behind a card's front are found too.
      const text = [cardText(index, card), pagesText(index, card)].filter(Boolean).join(' ');
      texts.set(card.id, text);
      return { id: card.id, title: card.title, text, tags: resolveTags(index, card.tags).map((t) => t.title).join(' ') };
    }),
  );

  return {
    search(query) {
      if (!query.trim()) return [];
      return engine.search(query).flatMap((r) => {
        const card = index.byId.get(String(r.id));
        return card ? [{ card, snippet: snippet(texts.get(card.id) ?? '', r.terms) }] : [];
      });
    },
  };
}

function snippet(text: string, terms: string[], width = 140): string {
  const lower = text.toLowerCase();
  const positions = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((p) => p >= 0);
  const at = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, at - 40);
  const body = text.slice(start, start + width);
  return `${start > 0 ? '…' : ''}${body}${start + width < text.length ? '…' : ''}`;
}
