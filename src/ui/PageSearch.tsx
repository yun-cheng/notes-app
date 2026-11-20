import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { buildSearch } from '../domain/search';
import { useCards } from '../state/CardsContext';
import { Icon } from './Icon';

/**
 * Searching in place on a page (the journal, Links, Files): a button for its title bar, which `/` presses too when
 * nothing's being typed into, and a field under the title. What's typed narrows the page as it's typed; `found` is
 * the entries with all its words (as the Search page finds them), null while there are none to look for. Each
 * change of words shows the page from where it starts: the foot (`fromFoot`, the journal in written order) or the top.
 */
export function usePageSearch({ placeholder, fromFoot = false, off = false }: { placeholder: string; fromFoot?: boolean; off?: boolean }) {
  const { index } = useCards();
  // Null while closed.
  const [query, setQuery] = useState<string | null>(null);
  const words = query?.trim() ?? '';
  const engine = useMemo(() => (words ? buildSearch(index) : null), [index, !!words]);
  const found = useMemo(() => (engine ? new Set(engine.search(words).map((h) => h.card.id)) : null), [engine, words]);
  const box = useRef<HTMLInputElement>(null);
  const open = () => {
    setQuery((q) => q ?? '');
    setTimeout(() => box.current?.focus());
  };

  useEffect(() => {
    if (off) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (typing || document.querySelector('.dialog-backdrop')) return;
      // Before the app's own `/`, which opens the commands on pages with no search of their own.
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [off]);

  useLayoutEffect(() => {
    if (query !== null) window.scrollTo(0, fromFoot ? document.documentElement.scrollHeight : 0);
  }, [words]);

  const shown = query !== null && !off;
  const button = off ? null : (
    <button
      type="button"
      className={`icon-btn${shown ? ' is-active' : ''}`}
      aria-label={placeholder}
      aria-expanded={shown}
      title={`${placeholder} (/)`}
      onClick={() => (shown ? setQuery(null) : open())}
    >
      <Icon name="search" />
    </button>
  );
  const field = shown ? <SearchField ref={box} query={query} placeholder={placeholder} onChange={setQuery} /> : null;
  return { words: off ? '' : words, found: off ? null : found, button, field };
}

/** Whether `text` holds every one of `words`, in any case: for what's held in entries, like a link's address or a file's name. */
export function holdsWords(text: string, words: string): boolean {
  const lower = text.toLowerCase();
  return words
    .toLowerCase()
    .split(/\s+/)
    .every((w) => lower.includes(w));
}

/** The field under the title. Esc empties it, then closes it. */
function SearchField({ ref, query, placeholder, onChange }: { ref: Ref<HTMLInputElement>; query: string; placeholder: string; onChange: (query: string | null) => void }) {
  return (
    <div className="page-search">
      <Icon name="search" size={18} />
      <input
        ref={ref}
        type="search"
        autoFocus
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onChange(query ? '' : null);
        }}
      />
      <button type="button" className="page-search__close" aria-label="Close search" title="Close search (Esc)" onClick={() => onChange(null)}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
