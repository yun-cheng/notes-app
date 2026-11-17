import { useSyncExternalStore } from 'react';
import type { TranslationStore } from '../storage/types';
import { translateOnServer } from '../sync/http';

/**
 * Translating an entry's words, shown in its bubble. The server translates it (server/translate.ts), with a model
 * that reads a whole note better than a browser's, except for an entry in an encrypted vault, whose words never go
 * there. Where the server can't (offline, or this account's translations for the day are used up), the browser
 * does it on the device if it can (Chrome's built-in Translator and LanguageDetector), and the text never leaves
 * it. When neither can, Google Translate opens in a new tab with the text, which then goes to Google: the menu
 * says so ("with Google").
 */

interface Detector {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
interface TranslatorInstance {
  translate(text: string): Promise<string>;
}
interface TranslatorApi {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
}
interface DetectorApi {
  create(): Promise<Detector>;
}

const api = () => {
  const g = globalThis as unknown as { Translator?: TranslatorApi; LanguageDetector?: DetectorApi };
  return g.Translator && g.LanguageDetector ? { translator: g.Translator, detector: g.LanguageDetector } : null;
};

/** Whether this browser translates on the device. */
export const translatesOnDevice = () => !!api();

/** The language to translate into: this device's, as the translator names it (Traditional Chinese is zh-Hant). */
export function deviceLanguage(lang = navigator.language): string {
  const lower = lang.toLowerCase();
  if (/^zh-(tw|hk|mo|hant)/.test(lower)) return 'zh-Hant';
  return lower.split('-')[0] || 'en';
}

export function languageName(code: string, inLang = navigator.language): string {
  try {
    return new Intl.DisplayNames([inLang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Google Translate with the text, into the device's language. Long text is cut to what an address can carry. */
export function googleTranslateUrl(text: string, to = deviceLanguage()): string {
  const target = to === 'zh-Hant' ? 'zh-TW' : to;
  return `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(target)}&op=translate&text=${encodeURIComponent(text.slice(0, 4000))}`;
}

export const googleSearchUrl = (text: string) => `https://www.google.com/search?q=${encodeURIComponent(text.trim().slice(0, 500))}`;

/** A translation of an entry's words: the pieces in order, and the languages. */
export interface Translation {
  /** What was translated, so a changed entry shows its own words again. */
  source: string;
  pieces: string[];
  from: string;
  to: string;
  /** Showing in the bubble; Show original hides it, kept, so showing it again asks nothing. */
  shown: boolean;
  /** Kept on this device too, not only while the app is open. */
  saved: boolean;
}

type State = Translation | 'working';

const translations = new Map<string, State>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** How long a translation is kept on the device. One of an entry edited since is never shown, and goes then too. */
const KEEP_FOR = 90 * 86_400_000;

/** The signed-in account's database, where translations are kept on this device. */
let store: TranslationStore | null = null;

const save = (id: string, t: Translation) =>
  void store?.putTranslation({ cardId: id, source: t.source, pieces: t.pieces, from: t.from, to: t.to, shown: t.shown, savedAt: Date.now() }).catch(() => undefined);

/**
 * Keeps translations in an account's database from now on, and shows those kept there; null when no account is
 * open. Each account has its own, and they go with its database when it signs out.
 */
export async function keepTranslationsIn(next: TranslationStore | null): Promise<void> {
  store = next;
  translations.clear();
  changed();
  if (!next) return;
  const kept = await next.listTranslations().catch(() => []);
  if (store !== next) return;
  const old = Date.now() - KEEP_FOR;
  for (const t of kept) {
    if (t.savedAt >= old && !translations.has(t.cardId)) translations.set(t.cardId, { source: t.source, pieces: t.pieces, from: t.from, to: t.to, shown: t.shown, saved: true });
  }
  changed();
  const stale = kept.filter((t) => t.savedAt < old).map((t) => t.cardId);
  if (stale.length) await next.deleteTranslations(stale).catch(() => undefined);
}

/** Forgets the saved translations of entries `drop` picks, like those now in an encrypted vault. */
export function forgetTranslations(drop: (cardId: string) => boolean) {
  const gone = [...translations].flatMap(([id, t]) => (t !== 'working' && t.saved && drop(id) ? [id] : []));
  if (!gone.length) return;
  for (const id of gone) translations.delete(id);
  changed();
  void store?.deleteTranslations(gone).catch(() => undefined);
}

/** An entry's translation, kept on this device, or 'working' while it's being made. */
export function useTranslation(id: string): State | undefined {
  return useSyncExternalStore(subscribe, () => translationOf(id));
}

export const translationOf = (id: string): State | undefined => translations.get(id);

/** Shows an entry's translation in its bubble again, or its own words, keeping the translation either way. */
export function showTranslation(id: string, shown: boolean) {
  const kept = translations.get(id);
  if (!kept || kept === 'working') return;
  const next = { ...kept, shown };
  translations.set(id, next);
  changed();
  if (next.saved) save(id, next);
}

export function clearTranslation(id: string) {
  translations.delete(id);
  changed();
  void store?.deleteTranslations([id]).catch(() => undefined);
}

/** How long the device gets to detect and translate, its language models fetched the first time included. */
const TIME_LIMIT = 60_000;

/** A promise that gives up after a while: a browser can wait on a model it never gets. */
const within = <T>(work: Promise<T>, ms = TIME_LIMIT): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('Took too long')), ms)));
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
};

export type TranslateResult =
  | { kind: 'done'; from: string; to: string }
  | { kind: 'same'; language: string }
  | { kind: 'unavailable' }
  | { kind: 'failed' }
  /** The server's translations for today are used up, and the device couldn't either. */
  | { kind: 'limit' };

type Outcome = { kind: 'done'; from: string; to: string; pieces: string[] } | Exclude<TranslateResult, { kind: 'done' }>;

/** The device's translation: from the language it's in into the device's, or into English when it's in that already. */
async function onDevice({ translator, detector: detectors }: NonNullable<ReturnType<typeof api>>, pieces: string[]): Promise<Outcome> {
  const detector = await within(detectors.create());
  const [best] = await within(detector.detect(pieces.join('\n')));
  const from = best?.detectedLanguage && best.detectedLanguage !== 'und' ? best.detectedLanguage : 'en';
  const mine = deviceLanguage();
  const same = from.split('-')[0] === mine.split('-')[0];
  const to = same ? (mine === 'en' ? null : 'en') : mine;
  if (!to) return { kind: 'same', language: from };
  if ((await within(translator.availability({ sourceLanguage: from, targetLanguage: to }))) === 'unavailable') return { kind: 'unavailable' };
  const instance = await within(translator.create({ sourceLanguage: from, targetLanguage: to }));
  const out = await within(Promise.all(pieces.map((p) => (p.trim() ? instance.translate(p) : Promise.resolve(p)))));
  return { kind: 'done', from, to, pieces: out };
}

/** The server's translation, into the device's language, or into English when it's in that already. */
async function onServer(id: string, pieces: string[]): Promise<Outcome> {
  const mine = deviceLanguage();
  try {
    const out = await within(translateOnServer(id, pieces, mine, mine === 'en' ? undefined : 'en'), 30_000);
    return out.kind === 'same' ? { kind: 'same', language: out.from } : out;
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * Translates an entry's pieces of text (its title, lines and so on): with `server`, by the server, and where it
 * can't, on the device where the browser can. Unavailable where neither may. With `keep`, it's kept on this device
 * after the app closes; never for an entry in an encrypted vault, which this device keeps only encrypted.
 */
export async function translateEntry(id: string, pieces: string[], { server = false, keep = false } = {}): Promise<TranslateResult> {
  const found = api();
  if (!found && !server) return { kind: 'unavailable' };
  const source = pieces.join('\n');
  translations.set(id, 'working');
  changed();
  let out: Outcome = server ? await onServer(id, pieces) : { kind: 'unavailable' };
  if (found && (out.kind === 'unavailable' || out.kind === 'failed' || out.kind === 'limit')) {
    const device = await onDevice(found, pieces).catch((): Outcome => ({ kind: 'failed' }));
    // Used up on the server and not possible here either: that's the one to say.
    if (out.kind !== 'limit' || device.kind === 'done' || device.kind === 'same') out = device;
  }
  if (out.kind !== 'done') {
    clearTranslation(id);
    return out;
  }
  const made: Translation = { source, pieces: out.pieces, from: out.from, to: out.to, shown: true, saved: keep };
  translations.set(id, made);
  changed();
  if (keep) save(id, made);
  return { kind: 'done', from: out.from, to: out.to };
}

/** Opens a page in a new tab, with nothing of this app's sent along. */
export const openOutside = (url: string) => void window.open(url, '_blank', 'noopener,noreferrer');
