import { describe, expect, it } from 'vitest';
import { HEADER_BYTES, openAttachment, PIECE_BYTES, sealAttachment, sealedFacts, sealedVault } from './attachmentSeal';

const vaultKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('sealed photos and files', () => {
  it('opens with the vault key as what it was, and hides it from anyone without', async () => {
    const key = await vaultKey();
    const plain = new Blob(['Dear diary, the lease is signed.'], { type: 'text/plain' });
    const sealed = await sealAttachment(key, plain, 'a1', 'diary', { mime: 'text/plain', name: 'Lease notes.txt' });
    expect(sealed.type).toBe('application/octet-stream');
    const text = new TextDecoder().decode(await bytes(sealed));
    expect(text).not.toContain('lease');
    expect(text).not.toContain('Lease notes');
    expect(await sealedVault(sealed)).toBe('diary');
    const opened = await openAttachment(key, sealed, 'a1');
    expect(opened!.facts).toEqual({ mime: 'text/plain', name: 'Lease notes.txt', size: plain.size });
    expect(opened!.blob.type).toBe('text/plain');
    expect(await opened!.blob.text()).toBe('Dear diary, the lease is signed.');
    // Another vault's key, or the same bytes under another attachment's ID, open nothing.
    expect(await openAttachment(await vaultKey(), sealed, 'a1')).toBeNull();
    expect(await openAttachment(key, sealed, 'a2')).toBeNull();
    expect(await sealedVault(plain)).toBeNull();
    expect(await openAttachment(key, plain, 'a1')).toBeNull();
  });

  it('seals a big one a piece at a time, and notices pieces dropped, cut or swapped', async () => {
    const key = await vaultKey();
    const data = new Uint8Array(PIECE_BYTES * 2 + 1000).map((_, i) => i % 251);
    const sealed = await sealAttachment(key, new Blob([data]), 'v1', 'diary', { mime: 'video/mp4', width: 1920, height: 1080, duration: 12.5 });
    const opened = await openAttachment(key, sealed, 'v1');
    expect(await bytes(opened!.blob)).toEqual(data);
    expect(opened!.facts).toMatchObject({ mime: 'video/mp4', width: 1920, height: 1080, duration: 12.5 });
    // The facts come from the start alone, as a range of it is fetched to tell what a file in the Trash is.
    expect(await sealedFacts(key, await bytes(sealed.slice(0, HEADER_BYTES)), 'v1')).toMatchObject({ mime: 'video/mp4', size: data.length });

    const all = await bytes(sealed);
    const body = all.length - (PIECE_BYTES * 2 + 1000 + 3 * 16);
    const piece = PIECE_BYTES + 16;
    const head = all.slice(0, body);
    const [p0, p1, p2] = [0, 1, 2].map((i) => all.slice(body + i * piece, body + (i + 1) * piece));
    for (const broken of [[head, p0, p1], [head, p1, p0, p2], [head, p0, p2], [all.slice(0, all.length - 1)]]) {
      expect(await openAttachment(key, new Blob(broken), 'v1')).toBeNull();
    }
  });

  it('seals an empty one too', async () => {
    const key = await vaultKey();
    const opened = await openAttachment(key, await sealAttachment(key, new Blob([]), 'e', 'diary', { mime: 'text/plain' }), 'e');
    expect(opened!.blob.size).toBe(0);
  });
});
