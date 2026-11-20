import { useRef, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { NodeSelection } from '@tiptap/pm/state';
import type { JSONNode } from '../../domain/types';
import { picturesInHtml } from '../../photos/pasted';
import { isVideoFile } from '../../photos/video';
import { isAudioFile, probeAudio } from '../../photos/audio';
import { fileProblem } from '../../photos/service';
import { canChangeInTheOpen } from '../../domain/access';
import { voiceExtension, voiceName } from '../../domain/voice';
import { recordedHere, useVoiceRecorder, type Recording } from '../voice';
import { useCards } from '../../state/CardsContext';
import { SyncOffline } from '../../sync/engine';
import { fetchWebPicture } from '../../sync/http';
import { clipboardPrefs } from '../clipboardPrefs';
import { useToast } from '../Toast';

const isPicture = (f: File) => f.type.startsWith('image/') && f.type !== 'image/svg+xml';

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

/** Something to add: a photo, or a file of another kind kept as it is. Saving it gives the block for the text. */
type Adding = () => Promise<JSONNode>;

/**
 * Photos, videos and files added to an editor: pasted, dropped where they land, or picked from the device. A picture
 * is a photo; a video, or a sound, plays where it is; a file of any other kind (a PDF, a spreadsheet) is attached as it is. Each is saved on the device first, in
 * the vault `vaultId()` names, and goes in the text at once. A picture copied from a web page or an app often comes as
 * just its address in HTML, with no file; it's fetched and added like a pasted file. Pictures among copied words
 * follow the words when the paste keeps formatting. `editorProps` goes to `useEditor`, `input` somewhere on the page,
 * `pick` opens the photo and video picker and `pickFile` the file picker; `record` records a voice message.
 */
export function usePhotoInput(editor: RefObject<TiptapEditor | null>, vaultId: () => string | undefined) {
  const { photos, vaults } = useCards();
  const toast = useToast();
  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const photo = (picture: () => Promise<Blob>): Adding => async () => ({ type: 'photo', attrs: { id: await photos.add(await picture(), vaultId()!) } });

  /** Adds each in turn, in order: at the cursor, or from `at` on. */
  const addAll = async (adding: Adding[], at?: number) => {
    let pos = at;
    let added = 0;
    let files = 0;
    let videos = 0;
    let voices = 0;
    for (const add of adding) {
      try {
        const node = await add();
        const ed = editor.current;
        if (!ed || ed.isDestroyed) return;
        const mime = String(node.attrs?.mime);
        if (node.type === 'file') files += mime.startsWith('video/') || mime.startsWith('audio/') ? 0 : 1;
        if (mime.startsWith('video/')) videos++;
        if (mime.startsWith('audio/')) voices++;
        // At the start of a line with words on it, the picture goes before the line rather than splitting it.
        const { $from, empty } = ed.state.selection;
        // With a photo, a file or a voice message picked (pressing its buttons picks it), it goes after it, not in its place.
        if (pos === undefined && ed.state.selection instanceof NodeSelection) pos = ed.state.selection.to;
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
        toast(err instanceof Error ? err.message : "That couldn't be added.");
      }
    }
    if (!added) return;
    // It shows here at once either way; said when it can't go on to the server, so other devices won't have it.
    await photos.upload();
    const { problem } = photos.getState();
    const what =
      files === added
        ? ['file', 'files']
        : videos === added
          ? ['video', 'videos']
          : voices === added
            ? ['voice message', 'voice messages']
            : files || videos || voices
              ? ['attachment', 'attachments']
              : ['photo', 'photos'];
    const these = added > 1 ? `These ${what[1]} stay` : `This ${what[0]} stays`;
    if (problem === 'needs_drive') toast(`${these} on this device until Google Drive is connected.`, { action: { label: 'Settings', run: () => void navigate('/settings') } });
    else if (problem === 'not_configured') toast(`${these} on this device for now: storage isn't set up on the server yet.`);
  };
  /** A sound, kept as it is, with its length and how loud it is along it, to play where it is. */
  const sound = (file: File, recorded?: Recording): Adding => async () => {
    // Said before reading it, so a huge one isn't decoded only to be turned down.
    const problem = fileProblem(file);
    if (problem) throw new Error(problem);
    const facts = await probeAudio(file);
    const attrs = await photos.addFile(file, vaultId()!, facts.duration ?? recorded?.seconds ?? null);
    // Held for transcribing only where it will be: not in an encrypted vault, whose sound stays on the device.
    if (recorded && canChangeInTheOpen(vaults.find((v) => v.id === vaultId()))) recordedHere.set(attrs.id, facts.samples);
    return { type: 'file', attrs: { ...attrs, ...(facts.peaks.length ? { peaks: facts.peaks } : {}) } };
  };
  /** Pictures as photos, videos and sounds to play where they are, and any other file as it is, in the order given. */
  const add = (files: File[], at?: number) =>
    addAll(
      files.map((file) =>
        isPicture(file)
          ? photo(async () => file)
          : isVideoFile(file)
            ? async () => ({ type: 'file', attrs: { ...(await photos.addVideo(file, vaultId()!)) } })
            : isAudioFile(file)
              ? sound(file)
              : async () => ({ type: 'file', attrs: await photos.addFile(file, vaultId()!) }),
      ),
      at,
    );
  /** A voice message just recorded goes in where the cursor was, named for when it was made, and is transcribed. */
  const recorder = useVoiceRecorder((recorded) => {
    const file = new File([recorded.blob], voiceName(new Date(recorded.startedAt), voiceExtension(recorded.blob.type)), { type: recorded.blob.type });
    void latest.current.addAll([sound(file, recorded)]);
  });

  // The editor keeps the props it was made with, so they reach the newest functions through this.
  const latest = useRef({ add, addAll });
  latest.current = { add, addAll };

  const editorProps = useRef({
    handlePaste: (view: EditorView, event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) {
        void latest.current.add(files);
        return true;
      }
      const html = event.clipboardData?.getData('text/html');
      const found = html ? picturesInHtml(html) : null;
      if (!found?.sources.length) return false;
      const pictures = found.sources.map((src) => photo(() => pictureAt(src)));
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
      const files = [...(event.dataTransfer?.files ?? [])];
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
      accept="image/*,video/*"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        void add(files);
      }}
    />
  );
  const fileInput = (
    <input
      ref={filePicker}
      type="file"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        void add(files);
      }}
    />
  );
  return {
    add,
    pick: () => picker.current?.click(),
    pickFile: () => filePicker.current?.click(),
    record: recorder.start,
    recording: recorder.recording,
    input: (
      <>
        {input}
        {fileInput}
        {recorder.view}
      </>
    ),
    editorProps,
  };
}
