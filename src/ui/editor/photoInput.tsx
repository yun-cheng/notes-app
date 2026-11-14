import { useRef, type RefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { useCards } from '../../state/CardsContext';
import { useToast } from '../Toast';

const images = (files: Iterable<File> | undefined | null) => [...(files ?? [])].filter((f) => f.type.startsWith('image/'));

/**
 * Photos added to an editor: pasted, dropped where they land, or picked from the device. Each is saved on the
 * device first, in the vault `vaultId()` names, and goes in the text at once. `editorProps` goes to `useEditor`,
 * `input` somewhere on the page, and `pick` opens the picker.
 */
export function usePhotoInput(editor: RefObject<TiptapEditor | null>, vaultId: () => string | undefined) {
  const { photos } = useCards();
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);

  const add = async (files: File[], at?: number) => {
    for (const file of images(files)) {
      try {
        const id = await photos.add(file, vaultId()!);
        const node = { type: 'photo', attrs: { id } };
        const chain = editor.current?.chain().focus();
        if (at === undefined) chain?.insertContent(node).run();
        else chain?.insertContentAt(at, node).run();
      } catch (err) {
        toast(err instanceof Error ? err.message : "That photo couldn't be added.");
      }
    }
  };
  // The editor keeps the props it was made with, so they reach the newest `add` through this.
  const latest = useRef(add);
  latest.current = add;

  const editorProps = useRef({
    handlePaste: (_view: EditorView, event: ClipboardEvent) => {
      const files = images(event.clipboardData?.files);
      if (!files.length) return false;
      void latest.current(files);
      return true;
    },
    handleDrop: (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) => {
      const files = images(event.dataTransfer?.files);
      if (moved || !files.length) return false;
      event.preventDefault();
      void latest.current(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
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
