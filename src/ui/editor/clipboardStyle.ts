import { Fragment, Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { toMarkdown, toPlainText, type TitleResolver } from '../../domain/markdown';
import { fromMarkdown, type LinkResolver } from '../../domain/markdownIn';
import type { JSONNode } from '../../domain/types';
import { clipboardPrefs } from '../clipboardPrefs';

/**
 * Copying and pasting in an editor the way the Copy & paste settings say. Rich text is the editor's own HTML,
 * with plain words beside it for apps that take only text. Text inside a code block is always copied and pasted
 * as it is.
 */
export function clipboardProps(title: () => TitleResolver, resolve: () => LinkResolver = () => () => null) {
  const copy = (view: EditorView, event: ClipboardEvent, cut: boolean) => {
    const style = clipboardPrefs().copy;
    const { selection } = view.state;
    if (style === 'rich' || selection.empty || !event.clipboardData) return false;
    const text = selection.$from.parent.type.spec.code && selection.$from.sameParent(selection.$to) ? view.state.doc.textBetween(selection.from, selection.to) : sliceText(selection.content(), style, title());
    event.preventDefault();
    event.clipboardData.clearData();
    event.clipboardData.setData('text/plain', text);
    if (cut && view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
    return true;
  };
  return {
    handleDOMEvents: {
      copy: (view: EditorView, event: Event) => copy(view, event as ClipboardEvent, false),
      cut: (view: EditorView, event: Event) => copy(view, event as ClipboardEvent, true),
    },
    // Rich text's plain half: the same words as Plain text, rather than the editor's lines padded with blank ones.
    clipboardTextSerializer: (slice: Slice) => sliceText(slice, 'plain', title()),
    handlePaste: (view: EditorView, event: ClipboardEvent) => pasteStyled(view, event.clipboardData?.getData('text/plain') ?? '', resolve()),
  };
}

/**
 * The words picked, as Markdown or plain text. A pick inside one paragraph of a list item or quote comes out as
 * just its words, without the list marker or quote mark around it.
 */
function sliceText(slice: Slice, style: 'markdown' | 'plain', title: TitleResolver): string {
  let { content, openStart, openEnd } = slice;
  while (content.childCount === 1 && openStart > 0 && openEnd > 0 && !content.firstChild!.isTextblock) {
    content = content.firstChild!.content;
    openStart--;
    openEnd--;
  }
  const doc: JSONNode = { type: 'doc', content: (content.toJSON() as JSONNode[] | null) ?? [] };
  return style === 'markdown' ? toMarkdown(doc, title) : toPlainText(doc, title);
}

/**
 * Pastes `text` as the paste setting says, or returns false to leave it to the editor (formatting kept, or
 * nothing but a photo on the clipboard). Markdown that names a node this editor doesn't have is pasted as written.
 */
export function pasteStyled(view: EditorView, text: string, resolve: LinkResolver): boolean {
  const style = clipboardPrefs().paste;
  const { schema } = view.state;
  if (style === 'rich' || !text || view.state.selection.$from.parent.type.spec.code) return false;
  const lines = () => Fragment.from(text.replace(/\r\n?/g, '\n').split('\n').map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null)));
  let content: Fragment;
  try {
    // An editor without links to cards (the writing box) keeps `[[Title]]` as written.
    content = style === 'plain' ? lines() : schema.nodeFromJSON(fromMarkdown(text, schema.nodes.cardLink ? resolve : () => null)).content;
  } catch {
    content = lines();
  }
  // Not marked as a paste, so the editor's own paste rules don't turn `**words**` in plain text into bold.
  view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(content)).scrollIntoView());
  return true;
}

/** The editor's link lookup for pasted `[[Title]]`: a card the account can see, by its title. */
export function titleResolver(cards: { id: string; title: string; type: string }[]): LinkResolver {
  return (wanted) => {
    const lower = wanted.toLowerCase();
    const card = cards.find((c) => c.type !== 'tag' && c.title.trim().toLowerCase() === lower);
    return card ? { id: card.id, label: card.title } : null;
  };
}
