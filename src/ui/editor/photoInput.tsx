import { useRef, type RefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { picturesInHtml } from '../../photos/pasted';
import { useCards } from '../../state/CardsContext';
import { SyncOffline } from '../../sync/engine';
import { fetchWebPicture } from '../../sync/http';
import { clipboardPrefs } from '../clipboardPrefs';
import { useToast } from '../Toast';

const images = (files: Iterable<File> | undefined | null) => [...(files ?? [])].filter((f) => f.type.startsWith('image/'));

/** A picture pasted as an address: a `data:` one is read here, a web one fetched by the server. */
async function pictureAt(src: string): Promise<Blob> {
  if (src.startsWith('data:')) return (await fetch(src)).blob();
  try {
    return await fetchWebPicture(src);
  } catch (err) {
    if (err instanceof SyncOffline) throw new Error('A picture copied from the web needs a connection to bring in.');
    throw err;
  }
}

/**
 * Photos added to an editor: pasted, dropped where they land, or picked from the device. Each is saved on the
 * device first, in the vault `vaultId()` names, and goes in the text at once. A picture copied from a web page or
 * an app often comes as just its address in HTML, with no file; it's fetched and added like a pasted file. Pictures
 * among copied words follow the words when the paste keeps formatting. `editorProps` goes to `useEditor`, `input`
 * somewhere on the page, and `pick` opens the picker.
 */
export function usePhotoInput(editor: RefObject<TiptapEditor | null>, vaultId: () => string | undefined) {
  const { photos } = useCards();
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);

  /** Adds each picture in turn, in order: at the cursor, or from `at` on. */
  const addAll = async (pictures: (() => Promise<Blob>)[], at?: number) => {
    let pos = at;
    for (const picture of pictures) {
      try {
        const id = await photos.add(await picture(), vaultId()!);
        const ed = editor.current;
        if (!ed || ed.isDestroyed) return;
        const node = { type: 'photo', attrs: { id } };
        if (pos === undefined) ed.chain().focus().insertContent(node).run();
        else ed.chain().focus().insertContentAt(Math.min(pos, ed.state.doc.content.size), node).run();
        if (pos !== undefined) pos = ed.state.selection.to;
      } catch (err) {
        toast(err instanceof Error ? err.message : "That photo couldn't be added.");
      }
    }
  };
  const add = (files: File[], at?: number) => addAll(images(files).map((file) => async () => file), at);

  // The editor keeps the props it was made with, so they reach the newest functions through this.
  const latest = useRef({ add, addAll });
  latest.current = { add, addAll };

  const editorProps = useRef({
    handlePaste: (view: EditorView, event: ClipboardEvent) => {
      const files = images(event.clipboardData?.files);
      if (files.length) {
        void latest.current.add(files);
        return true;
      }
      const html = event.clipboardData?.getData('text/html');
      const found = html ? picturesInHtml(html) : null;
      if (!found?.sources.length) return false;
      const pictures = found.sources.map((src) => () => pictureAt(src));
      if (found.alone) {
        void latest.current.addAll(pictures);
        return true;
      }
      // Words with pictures among them: the words paste as usual, then the pictures follow, unless the paste
      // is set to drop formatting.
      if (clipboardPrefs().paste === 'rich') setTimeout(() => void latest.current.addAll(pictures, view.state.selection.to));
      return false;
    },
    handleDrop: (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) => {
      const files = images(event.dataTransfer?.files);
      if (moved || !files.length) return false;
      event.preventDefault();
      void latest.current.add(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
      return true;
    },
  }).current;

  const input = (
    <input
      ref={picker}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        void add(files);
      }}
    />
  );
  return { add, pick: () => picker.current?.click(), input, editorProps };
}
