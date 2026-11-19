import type { Hono } from 'hono';
import type { ServerTranscript } from '../src/sync/protocol';
import { utcDay } from './translate';
import type { AppEnv, Database } from './db';

/**
 * The model that turns speech into words: OpenAI's Whisper (large v3, turbo), which knows many languages and names
 * the one it hears. On Workers AI, like translating, so a voice message goes no further than Cloudflare.
 */
export const TRANSCRIBE_MODEL = '@cf/openai/whisper-large-v3-turbo';

/** How much speech one account may have transcribed a day: an hour, plenty for voice notes, a ceiling on the cost. */
export const DAILY_SECONDS = 60 * 60;

/**
 * The sound sent, one piece of a voice message at a time: WAV, 16 kHz, one channel, 16 bits, what the model takes in
 * anyway, so each browser sends the same whatever it recorded. A piece is at most this long.
 */
export const PIECE_SECONDS = 120;
const BYTES_PER_SECOND = 16_000 * 2;
const HEADER = 44;
const MAX_BYTES = HEADER + (PIECE_SECONDS + 5) * BYTES_PER_SECOND;

/** Whether the bytes are a WAV of the kind sent: RIFF, PCM, one channel, 16 kHz, 16 bits. */
export function isPieceWav(bytes: Uint8Array): boolean {
  if (bytes.length <= HEADER) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  return (
    tag(0) === 'RIFF' &&
    tag(8) === 'WAVE' &&
    tag(12) === 'fmt ' &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === 16_000 &&
    view.getUint16(34, true) === 16
  );
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Counts `seconds` more for an account today, unless that would pass `DAILY_SECONDS`: false then. One statement, so
 * two at once can't both take the last of it.
 */
async function countSeconds(db: Database, userId: string, day: string, seconds: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO transcription_seconds (user_id, day, seconds) SELECT ?, ?, ? WHERE ? <= ?
       ON CONFLICT (user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds WHERE seconds + excluded.seconds <= ?
       RETURNING seconds`,
    )
    .bind(userId, day, seconds, seconds, DAILY_SECONDS, DAILY_SECONDS)
    .first<{ seconds: number }>();
  return !!row;
}

interface WhisperAnswer {
  text?: unknown;
  transcription_info?: { language?: unknown };
  segments?: { start?: unknown; end?: unknown; text?: unknown }[];
}

/**
 * `POST /transcribe?vault=` with one piece of a voice message (a WAV as `isPieceWav` says) answers with its words:
 * the whole text, the language heard, and when each stretch starts. For a vault this account can change, and never an
 * encrypted one, whose sound never reaches the server. Each account gets `DAILY_SECONDS` a day (UTC), after which
 * it's a 429 until tomorrow. Nothing of the sound or the words is kept.
 */
export function transcribeRoutes(app: Hono<AppEnv>, now: () => number) {
  app.post('/transcribe', async (c) => {
    const ai = c.env.AI;
    if (!ai) return c.json({ error: 'Transcribing isn’t set up on this server' }, 501);
    const user = c.get('user').id;
    const vault = await c.env.DB.prepare(
      `SELECT v.encryption FROM vaults v JOIN vault_members m ON m.vault_id = v.id WHERE v.id = ? AND m.user_id = ? AND m.role IN ('owner', 'editor')`,
    )
      .bind(c.req.query('vault') ?? '', user)
      .first<{ encryption: string | null }>();
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    if (vault.encryption) return c.json({ error: 'Voice in an encrypted vault isn’t sent to the server' }, 403);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_BYTES) return c.json({ error: 'Too long to transcribe at once' }, 413);
    if (!isPieceWav(bytes)) return c.json({ error: 'Invalid sound' }, 400);
    const seconds = Math.max(1, Math.ceil((bytes.length - HEADER) / BYTES_PER_SECOND));
    if (!(await countSeconds(c.env.DB, user, utcDay(now()), seconds))) {
      return c.json({ error: `That’s ${DAILY_SECONDS / 60} minutes of voice transcribed today, as much as a day has` }, 429);
    }
    const out = (await ai.run(TRANSCRIBE_MODEL, { audio: toBase64(bytes), vad_filter: true, condition_on_previous_text: false })) as WhisperAnswer;
    if (typeof out?.text !== 'string') return c.json({ error: 'The transcript didn’t come back' }, 502);
    const language = typeof out.transcription_info?.language === 'string' ? out.transcription_info.language : null;
    const cues = (Array.isArray(out.segments) ? out.segments : []).flatMap((s) =>
      typeof s?.start === 'number' && Number.isFinite(s.start) && typeof s.text === 'string' && s.text.trim() ? [{ start: Math.max(0, s.start), text: s.text.trim() }] : [],
    );
    return c.json<ServerTranscript>({ text: out.text.trim(), language, cues });
  });
}
