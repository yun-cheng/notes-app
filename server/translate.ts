import type { Hono } from 'hono';
import type { ServerTranslation } from '../src/sync/protocol';
import { allows, cardAccess, inEncryptedVault } from './access';
import type { AppEnv, Database } from './db';

/** Cloudflare's Workers AI, as a Worker reaches it through its `AI` binding: no key, the account's own. */
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

/**
 * The model that translates: Google's Gemma 4, which knows many languages, names the one it's reading, and keeps
 * the pieces apart when told to answer in a fixed shape. On Workers AI, so the words go no further than Cloudflare,
 * which already keeps the notes, and aren't used to train it.
 */
export const TRANSLATE_MODEL = '@cf/google/gemma-4-26b-a4b-it';

/** How many entries one account may have translated a day: plenty for a person, a ceiling on what it can cost. */
export const DAILY_TRANSLATIONS = 200;

const MAX_PIECES = 60;
const MAX_CHARS = 8000;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const base = (code: string) => code.toLowerCase().split('-')[0];
const sameLanguage = (a: string, b: string) => base(a) === base(b);

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** What the model answers, read from either shape Workers AI gives: a chat completion, or a bare `response`. */
function answerOf(out: unknown): unknown {
  const o = out as { choices?: { message?: { content?: unknown } }[]; response?: unknown };
  const content = o?.choices?.[0]?.message?.content ?? o?.response;
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
}

/** One call: the language the pieces are in, and each piece in `to`, in order. Null if the answer doesn't fit. */
export async function translatePieces(ai: AiBinding, pieces: string[], to: string): Promise<{ from: string; pieces: string[] } | null> {
  const target = `${languageName(to)} (${to})`;
  const out = await ai.run(TRANSLATE_MODEL, {
    messages: [
      {
        role: 'system',
        content:
          `You translate a person's notes into ${target}. You get a JSON array of pieces of one note. ` +
          `Answer with JSON only: {"from": the BCP 47 code of the language the note is mostly written in, "pieces": each piece translated into ${target}, in the same order}. ` +
          'Keep line breaks, list markers, emoji, web addresses, numbers, #tags and "•••" exactly as they are. ' +
          'An empty piece stays empty. Never add, merge, drop or explain pieces.',
      },
      { role: 'user', content: JSON.stringify(pieces) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'translation',
        strict: true,
        schema: {
          type: 'object',
          properties: { from: { type: 'string' }, pieces: { type: 'array', items: { type: 'string' }, minItems: pieces.length, maxItems: pieces.length } },
          required: ['from', 'pieces'],
          additionalProperties: false,
        },
      },
    },
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0.2,
    max_completion_tokens: Math.min(8192, 400 + pieces.join('').length * 3),
  });
  const answer = answerOf(out) as { from?: unknown; pieces?: unknown } | null;
  if (!answer || !Array.isArray(answer.pieces) || answer.pieces.length !== pieces.length || !answer.pieces.every((p) => typeof p === 'string')) return null;
  const from = typeof answer.from === 'string' && LANGUAGE.test(answer.from.trim()) ? answer.from.trim() : 'und';
  // Blank pieces stay blank, whatever came back for them.
  return { from, pieces: answer.pieces.map((p: string, i) => (pieces[i].trim() ? p : pieces[i])) };
}

/** UTC's date for a moment, the day a translation counts towards. */
export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * Counts one more translation for an account today, unless it has had `DAILY_TRANSLATIONS` already: false then.
 * One statement, so two at once can't both take the last one.
 */
async function countTranslation(db: Database, userId: string, day: string): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO translation_counts (user_id, day, count) VALUES (?, ?, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 WHERE count < ?
       RETURNING count`,
    )
    .bind(userId, day, DAILY_TRANSLATIONS)
    .first<{ count: number }>();
  return !!row;
}

/**
 * `POST /translate {cardId, pieces, to, otherwise}` translates what an entry's bubble shows: into `to`, or into
 * `otherwise` when the entry is in `to` already. The entry has to be one this account can read, and not in an
 * encrypted vault, whose words never reach the server. Each account gets `DAILY_TRANSLATIONS` a day (UTC), after
 * which it's a 429 until tomorrow. Nothing of the words is kept.
 */
export function translateRoutes(app: Hono<AppEnv>, now: () => number) {
  app.post('/translate', async (c) => {
    const ai = c.env.AI;
    if (!ai) return c.json({ error: 'Translating isn’t set up on this server' }, 501);
    const body = await c.req.json<{ cardId?: unknown; pieces?: unknown; to?: unknown; otherwise?: unknown }>().catch(() => null);
    const { cardId, pieces, to, otherwise } = body ?? {};
    if (
      typeof cardId !== 'string' ||
      !Array.isArray(pieces) ||
      !pieces.length ||
      pieces.length > MAX_PIECES ||
      !pieces.every((p) => typeof p === 'string') ||
      typeof to !== 'string' ||
      !LANGUAGE.test(to) ||
      (otherwise !== undefined && (typeof otherwise !== 'string' || !LANGUAGE.test(otherwise)))
    ) {
      return c.json({ error: 'Invalid translation' }, 400);
    }
    if ((pieces as string[]).join('').length > MAX_CHARS) return c.json({ error: 'Too long to translate here' }, 413);
    if (!allows(await cardAccess(c.env.DB, c.get('user').id, cardId), 'read')) return c.json({ error: 'Card not found' }, 404);
    if (await inEncryptedVault(c.env.DB, cardId)) return c.json({ error: 'Entries in an encrypted vault aren’t sent to the server' }, 403);
    if (!(await countTranslation(c.env.DB, c.get('user').id, utcDay(now())))) {
      return c.json({ error: `That’s ${DAILY_TRANSLATIONS} translations today, as many as a day has` }, 429);
    }

    const text = pieces as string[];
    let into = to;
    let done = await translatePieces(ai, text, into);
    if (done && sameLanguage(done.from, into)) {
      if (!otherwise || sameLanguage(otherwise, into)) return c.json<ServerTranslation>({ kind: 'same', from: done.from });
      into = otherwise;
      done = await translatePieces(ai, text, into);
    }
    if (!done) return c.json({ error: 'The translation didn’t come back whole' }, 502);
    return c.json<ServerTranslation>({ kind: 'done', from: done.from, to: into, pieces: done.pieces });
  });
}
