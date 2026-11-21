import { fromBase64, toBase64 } from '../domain/base64';

/**
 * Photos and files in an encrypted vault, encrypted on the device before they're kept or uploaded, so the server and
 * Google Drive hold only bytes they can't read, and this device's storage too.
 *
 * Each gets a random AES-256-GCM key of its own. What it is (that key, its type and name, its size, a picture's
 * size in pixels and a clip's length) is sealed with the vault key, bound to the attachment's ID and vault, in a
 * header at its start. The rest is the file in pieces of 1 MiB, each sealed with the file's key under a nonce made
 * of the piece's number and whether it's the last, so pieces can't be reordered, dropped or cut short unnoticed,
 * and a 1 GB video is sealed and opened a piece at a time, gathered into a Blob in batches, never held whole. Its own key per file leaves room to give
 * one file to someone without the vault.
 *
 * Its size is hidden too, near enough: the file is padded with zeros to a rounder size before it's sealed (`padded`),
 * and what it says of itself to a multiple of 128 bytes, so a name's length doesn't show either. Its real size is
 * in what it says of itself, and opening it cuts the padding off. One sealed before padding opens as it is.
 *
 * Layout: "nae1", the piece size (u32), the vault ID's length (u16) and the vault ID, the sealed facts' length
 * (u32) and the sealed facts (IV then ciphertext), then the pieces. Numbers are big-endian.
 */

type Bytes = Uint8Array<ArrayBuffer>;

const MAGIC = [0x6e, 0x61, 0x65, 0x31]; // "nae1"
export const PIECE_BYTES = 1024 * 1024;
const TAG_BYTES = 16;
/** Enough of a sealed file's start to hold its header: a vault ID of up to 64 characters and a long name fit. */
export const HEADER_BYTES = 2048;

/** What a sealed attachment says of itself, once opened. */
export interface SealedFacts {
  mime: string;
  /** Its size before it was sealed. */
  size: number;
  /** A file's name. */
  name?: string;
  width?: number | null;
  height?: number | null;
  /** A clip's length, in seconds. */
  duration?: number | null;
}

/** What a sealed file's start tells anyone: that it's sealed, and for which vault. Null for one that isn't. */
export interface SealedHeader {
  vaultId: string;
  pieceBytes: number;
  /** Where the pieces start. */
  bodyAt: number;
  facts: Bytes;
}

/**
 * A file's size rounded up as Padmé does (Nikitin et al., 2019): to a multiple of a power of two that's about 1/32 of
 * it for a big file, 1/8 for a small one, so many sizes look the same while padding adds at most 12%, and mostly a
 * few percent. A size within a server limit that's a multiple of 512 KB (25 MB, 1 GB) stays within it.
 */
export function padded(size: number): number {
  if (size < 2) return size;
  const e = Math.floor(Math.log2(size));
  const s = Math.floor(Math.log2(e)) + 1;
  const step = 2 ** (e - s);
  return Math.ceil(size / step) * step;
}

const FACTS_STEP = 128;

/** How much of a file is gathered in memory before it goes into the Blob being built (`Gathered`). */
export const BATCH_BYTES = 16 * 1024 * 1024;

/**
 * A Blob built a batch at a time from pieces as they're sealed or opened, so a 1 GB video is never held whole in the
 * page's memory: each batch goes into the browser's own storage for Blobs, which keeps big ones on disk, and the
 * Blob so far is only referred to, not copied.
 */
class Gathered {
  private blob: Blob;
  private batch: Uint8Array<ArrayBuffer>[] = [];
  private size = 0;

  constructor(private type: string) {
    this.blob = new Blob([], { type });
  }

  add(bytes: Uint8Array<ArrayBuffer>) {
    this.batch.push(bytes);
    this.size += bytes.length;
    if (this.size >= BATCH_BYTES) this.flush();
  }

  private flush() {
    if (!this.batch.length) return;
    this.blob = new Blob([this.blob, ...this.batch], { type: this.type });
    this.batch = [];
    this.size = 0;
  }

  done(): Blob {
    this.flush();
    return this.blob;
  }
}

const factsAad = (id: string, vaultId: string): Bytes => new TextEncoder().encode(`notes-app attachment v1|${id}|${vaultId}`);

function nonce(index: number, last: boolean): Bytes {
  const n = new Uint8Array(12);
  new DataView(n.buffer).setUint32(0, index);
  n[11] = last ? 1 : 0;
  return n;
}

/** Reads a sealed file's header from its first bytes (at least `HEADER_BYTES`, or all of it). */
export function readHeader(start: Uint8Array): SealedHeader | null {
  if (start.length < 14 || MAGIC.some((b, i) => start[i] !== b)) return null;
  const view = new DataView(start.buffer, start.byteOffset, start.byteLength);
  const pieceBytes = view.getUint32(4);
  const idLength = view.getUint16(8);
  const factsAt = 10 + idLength;
  if (pieceBytes < 1 || start.length < factsAt + 4) return null;
  const vaultId = new TextDecoder().decode(start.slice(10, factsAt));
  const factsLength = view.getUint32(factsAt);
  const bodyAt = factsAt + 4 + factsLength;
  if (factsLength < 12 + TAG_BYTES || start.length < bodyAt) return null;
  return { vaultId, pieceBytes, bodyAt, facts: new Uint8Array(start.slice(factsAt + 4, bodyAt)) };
}

const startOf = async (blob: Blob): Promise<Bytes> => new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());

/** The vault a sealed file was sealed for, or null for one that isn't sealed. */
export async function sealedVault(blob: Blob): Promise<string | null> {
  return readHeader(await startOf(blob))?.vaultId ?? null;
}

async function openFacts(vaultKey: CryptoKey, header: SealedHeader, id: string): Promise<{ key: CryptoKey; facts: SealedFacts } | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.facts.slice(0, 12), additionalData: factsAad(id, header.vaultId) }, vaultKey, header.facts.slice(12));
    const { k, ...facts } = JSON.parse(new TextDecoder().decode(plain)) as SealedFacts & { k: string };
    if (typeof k !== 'string' || typeof facts.mime !== 'string' || typeof facts.size !== 'number') return null;
    return { key: await crypto.subtle.importKey('raw', fromBase64(k), 'AES-GCM', false, ['decrypt']), facts };
  } catch {
    return null;
  }
}

/** What a sealed file is, from its header alone, or null if this key doesn't open it. */
export async function sealedFacts(vaultKey: CryptoKey, start: Uint8Array, id: string): Promise<SealedFacts | null> {
  const header = readHeader(start);
  return header && ((await openFacts(vaultKey, header, id))?.facts ?? null);
}

/** Seals a photo or file for attachment `id` in `vaultId`, under the vault's key. */
export async function sealAttachment(vaultKey: CryptoKey, blob: Blob, id: string, vaultId: string, facts: Omit<SealedFacts, 'size'>): Promise<Blob> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const json = JSON.stringify({ ...facts, size: blob.size, k: toBase64(raw) });
  // Spaces after the JSON, which it reads past, so how long a name is doesn't show in the header's length.
  const length = new TextEncoder().encode(json).length;
  const told = new TextEncoder().encode(json + ' '.repeat(Math.ceil(length / FACTS_STEP) * FACTS_STEP - length));
  const sealedFacts = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: factsAad(id, vaultId) }, vaultKey, told));
  const vault = new TextEncoder().encode(vaultId);
  const head = new Uint8Array(10 + vault.length + 4 + 12 + sealedFacts.length);
  const view = new DataView(head.buffer);
  head.set(MAGIC);
  view.setUint32(4, PIECE_BYTES);
  view.setUint16(8, vault.length);
  head.set(vault, 10);
  view.setUint32(10 + vault.length, 12 + sealedFacts.length);
  head.set(iv, 14 + vault.length);
  head.set(sealedFacts, 26 + vault.length);
  const out = new Gathered('application/octet-stream');
  out.add(head);
  const plain = new Blob([blob, new Uint8Array(padded(blob.size) - blob.size)]);
  const count = Math.max(1, Math.ceil(plain.size / PIECE_BYTES));
  for (let i = 0; i < count; i++) {
    const piece = await plain.slice(i * PIECE_BYTES, (i + 1) * PIECE_BYTES).arrayBuffer();
    out.add(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(i, i === count - 1) }, key, piece)));
  }
  return out.done();
}

/** A sealed photo or file opened, as its own type, with what it says of itself; null if it isn't sealed, or this key doesn't open it. */
export async function openAttachment(vaultKey: CryptoKey, blob: Blob, id: string): Promise<{ blob: Blob; facts: SealedFacts } | null> {
  const header = readHeader(await startOf(blob));
  const opened = header && (await openFacts(vaultKey, header, id));
  if (!header || !opened) return null;
  const sealedPiece = header.pieceBytes + TAG_BYTES;
  const body = blob.size - header.bodyAt;
  const count = Math.max(1, Math.ceil(body / sealedPiece));
  const gathered = new Gathered(opened.facts.mime);
  try {
    for (let i = 0; i < count; i++) {
      const at = header.bodyAt + i * sealedPiece;
      const piece = await blob.slice(at, at + sealedPiece).arrayBuffer();
      gathered.add(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(i, i === count - 1) }, opened.key, piece)));
    }
  } catch {
    return null;
  }
  const out = gathered.done();
  const { size, mime } = opened.facts;
  // Padded, or sealed before padding was.
  if (out.size !== padded(size) && out.size !== size) return null;
  return { blob: out.size === size ? out : out.slice(0, size, mime), facts: opened.facts };
}
