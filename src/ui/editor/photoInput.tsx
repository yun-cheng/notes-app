import { useRef, type RefObject } from 'react';
import { useNavigate } from 'react-router';
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
  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);

  /** Adds each picture in turn, in order: at the cursor, or from `at` on. */
  const addAll = async (pictures: (() => Promise<Blob>)[], at?: number) => {
    let pos = at;
    let added = 0;
    for (const picture of pictures) {
      try {
        const id = await photos.add(await picture(), vaultId()!);
        const ed = editor.current;
        if (!ed || ed.isDestroyed) return;
        const node = { type: 'photo', attrs: { id } };
        // At the start of a line with words on it, the picture goes before the line rather than splitting it.
        const { $from, empty } = ed.state.selection;
        if (pos === undefined && empty && $from.depth === 1 && $from.parentOffset === 0 && $from.parent.content.size) pos = $from.before();
        if (pos === undefined) ed.chain().focus().insertContent(node).run();
        else ed.chain().focus().insertContentAt(Math.min(pos, ed.state.doc.content.size), node).run();
        // The editor leaves the photo picked, so the next key would replace it. The cursor goes on the line after
        // it instead, a new one if a line doesn't follow, and the next picture goes in after this one.
        const end = ed.state.selection.to;
        if (!ed.state.doc.resolve(end).nodeAfter?.isTextblock) ed.commands.insertContentAt(end, { type: 'paragraph' });
        ed.commands.setTextSelection(end + 1);
        pos = end;
        added++;
      } catch (err) {
        toast(err instanceof Error ? err.message : "That photo couldn't be added.");
      }
    }
    if (!added) return;
    // A photo shows here at once either way; said when it can't go on to the server, so other devices won't have it.
    await photos.upload();
    const { problem } = photos.getState();
    const these = added > 1 ? 'These photos stay' : 'This photo stays';
    if (problem === 'needs_drive') toast(`${these} on this device until Google Drive is connected.`, { action: { label: 'Settings', run: () => void navigate('/settings') } });
    else if (problem === 'not_configured') toast(`${these} on this device for now: photo storage isn't set up on the server yet.`);
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
