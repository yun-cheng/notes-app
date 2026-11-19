import { Fragment, Slice, type Node as ProseNode, type Schema } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { toHTML } from '../../domain/html';
import { toMarkdown, toPlainText, type TitleResolver } from '../../domain/markdown';
import { fromMarkdown, type LinkResolver } from '../../domain/markdownIn';
import type { JSONNode } from '../../domain/types';
import { clipboardPrefs, COPY_STYLES, COPY_WORDS, PASTE_STYLES, PASTE_WORDS, type CopyStyle, type PasteStyle } from '../clipboardPrefs';
import { writeClipboard, writingClipboard } from '../entryActions';
import { hasEditorChoice, showEditorChoice } from './clipboardChoices';

/** Shows a message with a button for each other style: the toast, in the app, for an editor without `ClipboardChoices`. */
export type OfferStyles = (message: string, actions: { label: string; run: () => void }[]) => void;

/** What was pasted, read while the paste event lasts. */
export interface Pasted {
  text: string;
  html: string;
}

/**
 * Copying and pasting in an editor. Each goes in the style the Copy & paste settings pick, and a chip right after
 * the text (`ClipboardChoices`) offers the other styles for that one copy or paste: a copy is made again, a paste is
 * put back the other way. Rich text is the editor's own HTML, with plain words beside it for
 * apps that take only text. Text inside a code block is always copied and pasted as it is, with nothing offered.
 */
export function clipboardProps(title: () => TitleResolver, offer: OfferStyles, resolve: () => LinkResolver = () => () => null) {
  const copy = (view: EditorView, event: ClipboardEvent, cut: boolean) => {
    const { selection } = view.state;
    // A copy this app asks the browser for (a chip's other style) is `writeClipboard`'s.
    if (selection.empty || !event.clipboardData || writingClipboard()) return false;
    if (selection.$from.parent.type.spec.code && selection.$from.sameParent(selection.$to)) {
      put(event, view.state.doc.textBetween(selection.from, selection.to));
    } else {
      const doc = sliceDoc(selection.content());
      const style = clipboardPrefs().copy;
      const { from, to } = selection;
      const say = (now: CopyStyle) => {
        if (view.isDestroyed) return;
        const options = (Object.keys(COPY_STYLES) as CopyStyle[]).map((s) => ({
          label: COPY_STYLES[s],
          current: s === now,
          run: () => {
            const again = copyText(doc, s, title());
            void writeClipboard(again.text, undefined, again.html).then((ok) => (ok ? say(s) : offer("Couldn't copy here.", [])));
          },
        }));
        const choice = { kind: 'copy' as const, title: `Copied as ${COPY_WORDS[now]}`, options };
        // After a cut, where the words were.
        const at = cut ? view.state.selection.from : null;
        if (hasEditorChoice(view.state)) showEditorChoice(view, { ...choice, from: at ?? from, to: at ?? to });
        else offer(choice.title, options.filter((o) => !o.current));
      };
      // Once the copy, or the cut, is done.
      queueMicrotask(() => say(style));
      // Rich text is the editor's own copy, which keeps the most of what was picked; its plain words come from
      // `clipboardTextSerializer` below.
      if (style === 'rich') return false;
      put(event, copyText(doc, style, title()).text);
    }
    if (cut && view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
    return true;
  };

  /** Pastes in the setting's style, then offers the others that would come out differently. */
  const paste = (view: EditorView, pasted: Pasted): boolean => {
    if ((!pasted.text && !pasted.html) || view.state.selection.$from.parent.type.spec.code) return false;
    const style = clipboardPrefs().paste;
    const start = view.state.selection.from;
    pasteAs(view, pasted, style, resolve());
    // Styles that would paste the same are offered once, so a paste of plain words offers nothing.
    const kinds = pasteKinds(view.state.schema, pasted, resolve());
    const distinct = [style, ...others(PASTE_STYLES, style)].filter((s, i, list) => list.findIndex((o) => kinds[o] === kinds[s]) === i);
    if (distinct.length < 2) return true;
    const again = (other: PasteStyle, doc: ProseNode, end: number) => {
      // Only while the text is as the paste left it, so nothing typed since is lost.
      if (view.isDestroyed || !view.state.doc.eq(doc)) return false;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)));
      pasteAs(view, pasted, other, resolve());
      view.focus();
      say(other);
      return true;
    };
    // In a chip after the pasted text where the editor has one, else in the toast.
    const say = (now: PasteStyle) => {
      const { doc } = view.state;
      const end = view.state.selection.to;
      if (hasEditorChoice(view.state)) {
        showEditorChoice(view, {
          kind: 'paste',
          from: start,
          to: end,
          title: `Pasted ${PASTE_WORDS[now]}`,
          options: distinct.map((s) => ({ label: PASTE_STYLES[s], current: s === now, run: () => void again(s, doc, end) })),
        });
        return;
      }
      offer(
        `Pasted ${PASTE_WORDS[now]}`,
        distinct
          .filter((s) => s !== now)
          .map((other) => ({
            label: PASTE_STYLES[other],
            run: () => void (again(other, doc, end) || offer('The text has changed since, so the paste stays as it is.', [])),
          })),
      );
    };
    say(style);
    return true;
  };

  return {
    handleDOMEvents: {
      copy: (view: EditorView, event: Event) => copy(view, event as ClipboardEvent, false),
      cut: (view: EditorView, event: Event) => copy(view, event as ClipboardEvent, true),
    },
    // Rich text's plain half: the same words as Plain text, rather than the editor's lines padded with blank ones.
    clipboardTextSerializer: (slice: Slice) => toPlainText(sliceDoc(slice), title()),
    // A paste the editor makes itself (rich text, below) has no clipboard and is left to the editor.
    handlePaste: (view: EditorView, event: ClipboardEvent) =>
      !!event.clipboardData && paste(view, { text: event.clipboardData.getData('text/plain'), html: event.clipboardData.getData('text/html') }),
    paste,
  };
}

const others = <T extends string>(styles: Record<T, string>, current: T) => (Object.keys(styles) as T[]).filter((s) => s !== current);

function put(event: ClipboardEvent, text: string) {
  event.preventDefault();
  event.clipboardData!.clearData();
  event.clipboardData!.setData('text/plain', text);
}

/**
 * What was picked, as a document. A pick inside one paragraph of a list item or quote is just that paragraph, so
 * it copies without the list marker or quote mark around it.
 */
function sliceDoc(slice: Slice): JSONNode {
  let { content, openStart, openEnd } = slice;
  while (content.childCount === 1 && openStart > 0 && openEnd > 0 && !content.firstChild!.isTextblock) {
    content = content.firstChild!.content;
    openStart--;
    openEnd--;
  }
  return { type: 'doc', content: (content.toJSON() as JSONNode[] | null) ?? [] };
}

function copyText(doc: JSONNode, style: CopyStyle, title: TitleResolver): { text: string; html?: string } {
  if (style === 'markdown') return { text: toMarkdown(doc, title) };
  const text = toPlainText(doc, title);
  return style === 'plain' ? { text } : { text, html: toHTML(doc, title) };
}

const lines = (schema: Schema, text: string) =>
  Fragment.from(text.replace(/\r\n?/g, '\n').split('\n').map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null)));

/** Markdown read into this editor's nodes; an editor without links to cards (the writing box) keeps `[[Title]]` as written. */
function markdown(schema: Schema, text: string, resolve: LinkResolver): Fragment {
  try {
    return schema.nodeFromJSON(fromMarkdown(text, schema.nodes.cardLink ? resolve : () => null)).content;
  } catch {
    return lines(schema, text);
  }
}

/** Which styles would paste the same: rich text with no HTML is plain text, and so is Markdown with no marks in it. */
function pasteKinds(schema: Schema, pasted: Pasted, resolve: LinkResolver): Record<PasteStyle, string> {
  return {
    rich: pasted.html ? 'rich' : 'plain',
    markdown: pasted.text && !markdown(schema, pasted.text, resolve).eq(lines(schema, pasted.text)) ? 'markdown' : 'plain',
    plain: pasted.text ? 'plain' : 'rich',
  };
}

/**
 * Pastes in one style over what's selected. Rich text is the editor's own paste; Markdown and plain text aren't
 * marked as a paste, so the editor's paste rules don't turn `**words**` in plain text into bold.
 */
function pasteAs(view: EditorView, pasted: Pasted, style: PasteStyle, resolve: LinkResolver) {
  if (style === 'rich' || !pasted.text) {
    if (pasted.html) view.pasteHTML(pasted.html);
    else view.pasteText(pasted.text);
    return;
  }
  const { schema } = view.state;
  const content = style === 'plain' ? lines(schema, pasted.text) : markdown(schema, pasted.text, resolve);
  view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(content)).scrollIntoView());
}

/** The editor's link lookup for pasted `[[Title]]`: a card the account can see, by its title. */
export function titleResolver(cards: { id: string; title: string; type: string }[]): LinkResolver {
  return (wanted) => {
    const lower = wanted.toLowerCase();
    const card = cards.find((c) => c.type !== 'tag' && c.title.trim().toLowerCase() === lower);
    return card ? { id: card.id, label: card.title } : null;
  };
}
