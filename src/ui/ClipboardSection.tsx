import { COPY_STYLES, PASTE_STYLES, setClipboardPrefs, useClipboardPrefs, type CopyStyle, type PasteStyle } from './clipboardPrefs';
import { Section } from './components';
import { Choice } from './DisplaySection';

const COPY_NOTE: Record<CopyStyle, string> = {
  rich: 'Copied text keeps its bold, lists and links in apps like Mail, Notes and Docs, and is plain words where only text goes.',
  markdown: 'Copied text is Markdown, with **bold**, - lists and [links](…), and copied todos read [ ] Title @date #tag.',
  plain: 'Copied text is just the words: lists keep their markers, links show their addresses.',
};

const PASTE_NOTE: Record<PasteStyle, string> = {
  rich: 'Pasted text keeps the formatting it was copied with.',
  markdown: 'Pasted text is read as Markdown, so **bold**, # headings and - lists become formatting.',
  plain: 'Pasted text comes in as plain words, without its formatting.',
};

/** The style text is copied out of the app and pasted into it by default, on this device. Copied entries always paste back whole. */
export function ClipboardSection() {
  const prefs = useClipboardPrefs();
  return (
    <Section title="Copy & paste">
      <p className="prose-note">The style each copy and paste starts in on this device. After each one, the message at the bottom of the screen offers the other styles for it.</p>
      <Choice label="Copy as" options={COPY_STYLES} value={prefs.copy} onPick={(copy: CopyStyle) => setClipboardPrefs({ copy })} />
      <p className="prose-note">{COPY_NOTE[prefs.copy]} Entries pasted back into the journal come back whole either way.</p>
      <Choice label="Paste as" options={PASTE_STYLES} value={prefs.paste} onPick={(paste: PasteStyle) => setClipboardPrefs({ paste })} />
      <p className="prose-note">{PASTE_NOTE[prefs.paste]} Code blocks always take text as it is.</p>
    </Section>
  );
}
