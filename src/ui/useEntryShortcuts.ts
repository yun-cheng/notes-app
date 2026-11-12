import { useEffect, useRef } from 'react';
import { decodeEntries, ENTRIES_TYPE } from '../domain/clipboard';
import type { StreamFilter } from '../domain/stream';
import { useToday } from '../state/CardsContext';
import { useEntryActions } from './entryActions';
import type { Selection } from './selection';
import { journalDefaults } from './useSaveEntry';

/** Sent to the journal box with something pasted outside it, for the box to take as if pasted there. */
export const BOX_PASTE = 'journal-box-paste';
export interface ForwardedPaste {
  text: string;
  html: string;
  files: File[];
}

const EDITABLE = 'input, textarea, select, [contenteditable="true"]';
const typingIn = (el: EventTarget | null) => el instanceof Element && !!el.closest(EDITABLE);
const dialogOpen = () => !!document.querySelector('.dialog-backdrop');
const textSelected = () => !!String(window.getSelection() ?? '').trim();

/**
 * The element last focused from the keyboard (Tab, or the arrows between bubbles), not by a click. `:focus-visible`
 * can't tell: a key pressed after a click turns it on.
 */
let keyboardFocused: Element | null = null;
let pressing = false;
if (typeof document !== 'undefined') {
  const release = () => setTimeout(() => (pressing = false));
  document.addEventListener('pointerdown', () => (pressing = true), true);
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  document.addEventListener('focusin', (e) => (keyboardFocused = pressing ? null : (e.target as Element)), true);
}

/** The entry whose bubble has the keyboard's focus. A bubble focused by a click doesn't count, so a stray key can't trash it. */
function focusedEntry(): string[] {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el !== keyboardFocused || el.getAttribute('role') !== 'article') return [];
  const id = el.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
  return id ? [id] : [];
}

/**
 * The journal's keys for entries, outside text boxes: Cmd/Ctrl+A picks everything shown; Cmd+C copies the picked
 * entries (or the focused one), Cmd+X cuts them, and Delete or Backspace moves them to the Trash. Cmd+V pastes
 * copied entries as new ones; anything else pasted goes to the journal box to look over before saving. Text
 * selected in a message is copied as text, as usual.
 */
export function useEntryShortcuts(selection: Selection, filter: StreamFilter, enabled: boolean) {
  const actions = useEntryActions();
  const today = useToday();
  const latest = useRef({ selection, filter, today, actions });
  latest.current = { selection, filter, today, actions };

  useEffect(() => {
    if (!enabled) return;
    const targets = () => (latest.current.selection.ids.length ? latest.current.selection.ids : focusedEntry());

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || dialogOpen() || typingIn(e.target)) return;
      const { selection: picked, actions: act } = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && key === 'a') {
        if (!document.querySelector('[data-entry-id]')) return;
        e.preventDefault();
        picked.selectAll();
      } else if (mod && !e.shiftKey && (key === 'c' || key === 'x')) {
        const ids = targets();
        if (!ids.length || textSelected()) return;
        e.preventDefault();
        if (key === 'c') act.copy(ids);
        else {
          picked.clear();
          void act.cut(ids);
        }
      } else if (!mod && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        const ids = targets();
        if (!ids.length) return;
        e.preventDefault();
        picked.clear();
        void act.trash(ids);
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data || dialogOpen() || typingIn(e.target) || typingIn(document.activeElement)) return;
      const { selection: picked, actions: act, filter: f, today: day } = latest.current;
      const copied = decodeEntries(data.getData(ENTRIES_TYPE));
      e.preventDefault();
      picked.clear();
      if (copied) {
        void act.paste(copied, journalDefaults(f, day));
        return;
      }
      // Read now: the clipboard can't be read once this event is over.
      const forwarded: ForwardedPaste = { text: data.getData('text/plain'), html: data.getData('text/html'), files: [...data.files].filter((file) => file.type.startsWith('image/')) };
      if (!forwarded.text.trim() && !forwarded.html && !forwarded.files.length) return;
      // After the box shows again, if picking had hidden it.
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent<ForwardedPaste>(BOX_PASTE, { detail: forwarded })));
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, [enabled]);
}
