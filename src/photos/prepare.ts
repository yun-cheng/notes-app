import type { PreparedPhoto } from './types';

/** Long edge after shrinking. Plenty for a phone or laptop screen, and usually well under 1 MB. */
const MAX_EDGE = 2048;
const QUALITY = 0.85;
const KEEP_AS_IS = ['image/gif', 'image/png', 'image/webp'];

/**
 * Shrinks a photo on the device before it is saved, so uploads are small and Drive fills slowly.
 * Camera photos are re-encoded as JPEG with the orientation applied. Small GIF, PNG and WebP files
 * keep their format, so animation and transparency survive.
 */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (!file.type.startsWith('image/')) throw new Error("That file isn't an image this browser can read.");
    return { blob: file, mime: file.type, width: null, height: null };
  }
  const { width, height } = bitmap;
  if (KEEP_AS_IS.includes(file.type) && file.size < 2_000_000 && Math.max(width, height) <= MAX_EDGE) {
    bitmap.close();
    return { blob: file, mime: file.type, width, height };
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error("That photo couldn't be prepared.");
  return { blob, mime: 'image/jpeg', width: w, height: h };
}
