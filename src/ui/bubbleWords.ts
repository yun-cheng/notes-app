import { useEffect } from 'react';
import { wordsToDoc } from '../domain/content';
import { toHTML } from '../domain/html';
import { toMarkdown } from '../domain/markdown';
import { showChoiceNear, type ChipAnchor } from './clipboardChoice';
import { clipboardPrefs, COPY_STYLES, COPY_WORDS, type CopyStyle } from './clipboardPrefs';
import { writeClipboard, writingClipboard } from './entryActions';

/** A bubble shows a linked card by its title, so that's what's copied. */
const asShown = (_id: string, label: string) => label;

/**
 * Words selected in a bubble in a copy style: Plain text is them as shown; Markdown and Rich text read the bubble's
 * list markers as lists and its addresses as links (`wordsToDoc`), Rich text with the words as shown for apps that
 * take only text. None of the bubble's own look (its font, colors) goes with them.
 */
export function styledWords(words: string, style: CopyStyle): { text: string; html?: string } {
  if (style === 'plain') return { text: words };
  const doc = wordsToDoc(words);
  return style === 'markdown' ? { text: toMarkdown(doc, asShown) } : { text: words, html: toHTML(doc, asShown) };
}

/** The chip for words copied from a bubble, just under `anchor`; another style copies them again that way. */
export function offerWordStyles(words: string, now: CopyStyle, anchor: ChipAnchor) {
  showChoiceNear(
    anchor,
    {
      kind: 'copy',
      title: `Copied as ${COPY_WORDS[now]}`,
      options: (Object.keys(COPY_STYLES) as CopyStyle[]).map((s) => ({
        label: COPY_STYLES[s],
        current: s === now,
        run: () => {
          const again = styledWords(words, s);
          void writeClipboard(again.text, undefined, again.html).then((ok) => ok && offerWordStyles(words, s, anchor));
        },
      })),
    },
    'after',
  );
}

/** Where selected words end, for the chip to sit just under. */
export function endOf(range: Range): ChipAnchor {
  const end = range.cloneRange();
  end.collapse(false);
  const rects = range.getClientRects();
  return {
    getBoundingClientRect: () => end.getClientRects()[0] ?? rects[rects.length - 1] ?? range.getBoundingClientRect(),
    get isConnected() {
      return range.endContainer.isConnected;
    },
  };
}

const bubbleOf = (node: Node | null) => {
  const el = node instanceof Element ? node : node?.parentElement;
  return el && !el.closest('.ProseMirror, input, textarea') ? el.closest('[data-entry-id]') : null;
};

/**
 * Words selected in the journal's bubbles (an entry not open to edit) copy in the Copy setting's style, like words
 * copied in an editor, with the chip just under where they end offering the others. Before 2026-11-19 they were the browser's
 * own copy, which took the bubble's font and colors along into Mail or Docs. Code selected inside one snippet is
 * still copied as it is.
 */
export function useBubbleWordsCopy() {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (e.defaultPrevented || !e.clipboardData || writingClipboard()) return;
      const picked = window.getSelection();
      if (!picked || picked.isCollapsed || !picked.rangeCount) return;
      const range = picked.getRangeAt(0);
      if (!bubbleOf(range.startContainer) || !bubbleOf(range.endContainer)) return;
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      if (start?.closest('pre')?.contains(range.endContainer)) return;
      const words = picked.toString();
      if (!words.trim()) return;
      const style = clipboardPrefs().copy;
      const { text, html } = styledWords(words, style);
      e.preventDefault();
      e.clipboardData.clearData();
      e.clipboardData.setData('text/plain', text);
      if (html) e.clipboardData.setData('text/html', html);
      offerWordStyles(words, style, endOf(range.cloneRange()));
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);
}
