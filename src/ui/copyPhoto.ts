import { useCards } from '../state/CardsContext';
import { useToast } from './Toast';

/** A picture as a PNG, the one kind of picture every browser's clipboard takes; the photos here are mostly JPEGs. */
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((done, fail) => canvas.toBlob((png) => (png ? done(png) : fail(new Error('No PNG'))), 'image/png'));
}

/**
 * Copying a photo, whole, as a picture to paste into another app or back into an entry; a toast says how it went.
 * The clipboard item is made at once, with the picture to come, as Safari takes one only straight from the click.
 */
export function useCopyPhoto() {
  const { photos } = useCards();
  const toast = useToast();
  return (id: string) => {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      toast("This browser can't copy pictures.");
      return;
    }
    let missing = false;
    const png = photos.blob(id).then((blob) => {
      if (!blob) {
        missing = true;
        throw new Error('Not here');
      }
      return asPng(blob);
    });
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => toast('Copied the photo'),
      () => toast(missing ? "This photo hasn't been uploaded from its device yet." : "Couldn't copy the photo here."),
    );
  };
}
