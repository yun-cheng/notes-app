import { describe, expect, it } from 'vitest';
import { crc32, zip } from './zip';

const join = (parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) all.set(p, (at += p.length) - p.length);
  return all;
};

describe('zip', () => {
  it('checks bytes as the zip format does', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('stores each file whole, with its name, and lists them all at the end', () => {
    const a = new TextEncoder().encode('first');
    const b = new Uint8Array([1, 2, 3]);
    const bytes = join(zip([{ name: 'a.jpg', bytes: a }, { name: 'Café.jpg', bytes: b }]));
    const view = new DataView(bytes.buffer);
    // The first file, then the second right after it.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(crc32(a));
    expect(new TextDecoder().decode(bytes.slice(30, 35))).toBe('a.jpg');
    expect(new TextDecoder().decode(bytes.slice(35, 40))).toBe('first');
    expect(view.getUint32(40, true)).toBe(0x04034b50);
    // The end says how many, and where the list starts.
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const list = view.getUint32(end + 16, true);
    expect(view.getUint32(list, true)).toBe(0x02014b50);
    expect(view.getUint32(list + 42, true)).toBe(0);
    // A name in UTF-8, flagged as such.
    const second = list + 46 + 5;
    expect(view.getUint16(second + 8, true)).toBe(0x0800);
    expect(view.getUint32(second + 42, true)).toBe(40);
    expect(new TextDecoder().decode(bytes.slice(second + 46, second + 46 + view.getUint16(second + 28, true)))).toBe('Café.jpg');
  });
});
