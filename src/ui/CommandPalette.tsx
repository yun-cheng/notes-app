import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { displayTitle } from '../domain/content';
import { formatTime, relativeDayInSentence } from '../domain/dates';
import { repeatLabel } from '../domain/repeat';
import { parseEntry } from '../domain/entry';
import { sortVaults } from '../domain/locks';
import { buildSearch } from '../domain/search';
import { CONTAINS_LABEL, SORT_LABEL, STATUS_LABEL, TYPE_LABEL, WHEN_LABEL, type Contains, type EntryType, type BaseSort, type StreamFilter, type TodoStatus } from '../domain/stream';
import type { Card } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';
import { useNewNote } from './components';
import { LINK_STYLES, PHOTO_STYLES, setDisplayPrefs, type LinkStyle, type PhotoStyle } from './displayPrefs';
import { useFilterPath, useJournalFilter } from './FilterPanel';
import { Icon, type IconName } from './Icon';
import { cardPath, historyPath, journalPath, sheetState } from './paths';
import { MOD, REDO_KEYS } from './Shortcuts';
import { useToast } from './Toast';
import { useSaveEntries } from './useSaveEntry';
import { useUndo } from './useUndo';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: IconName;
  /** Extra words it matches, beyond its label and group. */
  keywords?: string;
  run: () => void;
}

const TYPE_ICON: Record<Card['type'], IconName> = { note: 'note', todo: 'todo', tag: 'tag' };
const TYPE_NAME: Record<Card['type'], string> = { note: 'Note', todo: 'Todo', tag: 'Tag' };

/** Every query word appears somewhere in the command's words. */
function matches(command: Command, words: string[]): boolean {
  const hay = `${command.label} ${command.group} ${command.keywords ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Cmd+K (Ctrl+K): one box for doing anything. With nothing typed it lists every action; typing narrows them,
 * offers to save the text to the journal (markers like `[]` and `#tag` work), and finds notes by their text.
 */
export function CommandPalette({ onClose, onShortcuts }: { onClose: () => void; onShortcuts: () => void }) {
  const { index, vaults, locked, locks } = useCards();
  const today = useToday();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { saveText } = useSaveEntries();
  const newNote = useNewNote();
  const { undo, redo } = useUndo();
  const current = useJournalFilter();
  const filterPath = useFilterPath();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const engine = useMemo(() => buildSearch(index), [index]);

  const go = (to: string) => () => void navigate(to);
  // A filter narrows the page it's picked on: the history from there, the journal from anywhere else.
  const narrow = (next: StreamFilter) => go(filterPath({ ...current, ...next }));
  const order = (sort: StreamFilter['sort']) => go(journalPath({ ...current, sort }));

  const commands = (() => {
    const all: Command[] = [
      { id: 'new-note', group: 'Write', label: 'New note', icon: 'plus', keywords: 'create add', run: () => void newNote() },
      { id: 'go-journal', group: 'Go to', label: 'Journal', icon: 'notes', keywords: 'home all everything', run: go('/journal') },
      { id: 'go-history', group: 'Go to', label: 'History', icon: 'history', keywords: 'changes recent activity log undo redo', run: go(historyPath(current)) },
      { id: 'go-calendar', group: 'Go to', label: 'Calendar', icon: 'calendar', keywords: 'month day date', run: go('/calendar') },
      { id: 'go-search', group: 'Go to', label: 'Search', icon: 'search', keywords: 'find', run: go('/search') },
      { id: 'go-tags', group: 'Go to', label: 'All tags', icon: 'tag', keywords: 'labels folders', run: go('/tags') },
      { id: 'go-vaults', group: 'Go to', label: 'Vaults', icon: 'lock', keywords: 'private pin members', run: go('/vaults') },
      { id: 'go-settings', group: 'Go to', label: 'Backup & settings', icon: 'settings', keywords: 'trash export import ai photos account sign out', run: go('/settings') },
      { id: 'undo', group: 'Edit', label: 'Undo', hint: `${MOD}Z`, icon: 'undo', keywords: 'take back revert last change', run: () => void undo() },
      { id: 'redo', group: 'Edit', label: 'Redo', hint: REDO_KEYS, icon: 'redo', keywords: 'put back again', run: () => void redo() },
      { id: 'shortcuts', group: 'Help', label: 'Keyboard shortcuts', hint: '?', keywords: 'keys help copy paste select', run: onShortcuts },
      { id: 'show-all', group: 'Filter', label: 'Show everything', icon: 'notes', keywords: 'clear reset all', run: go(filterPath({ sort: current.sort })) },
    ];
    for (const type of Object.keys(TYPE_LABEL) as EntryType[]) {
      all.push({ id: `type-${type}`, group: 'Filter', label: `Show ${TYPE_LABEL[type].toLowerCase()}`, icon: TYPE_ICON[type], keywords: 'type only', run: narrow({ type, status: undefined }) });
    }
    for (const status of Object.keys(STATUS_LABEL) as TodoStatus[]) {
      all.push({ id: `status-${status}`, group: 'Filter', label: `Todos: ${STATUS_LABEL[status].toLowerCase()}`, icon: 'todo', keywords: 'todo task status due', run: narrow({ status, type: undefined }) });
    }
    for (const has of Object.keys(CONTAINS_LABEL) as Contains[]) {
      all.push({ id: `has-${has}`, group: 'Filter', label: `Show entries ${CONTAINS_LABEL[has].toLowerCase()}`, icon: has === 'link' ? 'link' : 'image', keywords: 'contains url web pictures images', run: narrow({ has }) });
    }
    for (const when of Object.keys(WHEN_LABEL)) {
      all.push({ id: `when-${when}`, group: 'Filter', label: WHEN_LABEL[when], icon: 'calendar', keywords: 'written date when', run: narrow({ when }) });
    }
    for (const tag of index.tags) {
      const g = index.tagGroups.groupOf.get(tag.id);
      all.push({ id: `tag-${tag.id}`, group: 'Filter', label: g ? `${g.title}: ${tag.title}` : `#${tag.title}`, icon: 'tag', keywords: `tag folder #${tag.title}`, run: narrow({ tagId: tag.id }) });
    }
    for (const vault of sortVaults(vaults).filter((v) => !(v.hidden && locked.has(v.id)))) {
      all.push({ id: `vault-${vault.id}`, group: 'Filter', label: `Vault: ${vault.name}`, icon: locked.has(vault.id) ? 'lock' : undefined, keywords: 'vault private unlock', run: narrow({ vaultId: vault.id }) });
    }
    for (const links of Object.keys(LINK_STYLES) as LinkStyle[]) {
      all.push({ id: `links-${links}`, group: 'Display', label: `Link previews: ${LINK_STYLES[links].toLowerCase()}`, icon: 'link', keywords: 'url web card preview style', run: () => setDisplayPrefs({ links }) });
    }
    for (const photos of Object.keys(PHOTO_STYLES) as PhotoStyle[]) {
      all.push({ id: `photos-${photos}`, group: 'Display', label: `Photos: ${PHOTO_STYLES[photos].toLowerCase()}`, icon: 'image', keywords: 'pictures images preview style size', run: () => setDisplayPrefs({ photos }) });
    }
    for (const sort of Object.keys(SORT_LABEL) as BaseSort[]) {
      all.push({ id: `sort-${sort}`, group: 'Sort', label: `Sort: ${SORT_LABEL[sort].toLowerCase()}`, icon: 'upcoming', keywords: 'order', run: order(sort) });
    }
    for (const g of index.tagGroups.groups.filter((x) => x.ordered)) {
      all.push({ id: `sort-group-${g.id}`, group: 'Sort', label: `Sort: by ${g.title.toLowerCase()}`, icon: 'upcoming', keywords: 'order group rank', run: order(`group:${g.id}`) });
    }
    const unlocked = vaults.filter((v) => v.lock === 'pin' && !locked.has(v.id));
    if (unlocked.length) {
      all.push({ id: 'lock-all', group: 'Vaults', label: 'Lock private vaults', icon: 'lock', keywords: 'close hide pin', run: () => locks.lockAll() });
    }
    return all;
  })();

  // A leading `/` asks for commands only: no notes, and nothing to save.
  const onlyCommands = query.trimStart().startsWith('/');
  const text = (onlyCommands ? query.trimStart().slice(1) : query).trim();
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  // Text with markers (`[]`, `#tag`, `@friday`) is clearly something to write, so saving it comes first.
  // Otherwise commands come first, then notes that match, and saving the text comes last.
  const writes: Command[] = [];
  let writing = false;
  const entry = text && !onlyCommands ? parseEntry(text, today) : null;
  if (entry) {
    writing = entry.kind !== 'note' || entry.tags.length > 0 || !!entry.diary;
    const where = `${entry.kind === 'todo' ? 'as a todo' : 'as a note'}${entry.diary ? ' in the diary' : ''}`;
    const tags = entry.tags.length ? `, tagged ${entry.tags.map((t) => `#${t}`).join(' ')}` : '';
    const at = entry.dueTime ? ` at ${formatTime(entry.dueTime)}` : '';
    const repeats = entry.repeat ? `, ${repeatLabel(entry.repeat).toLowerCase()}` : '';
    const due = entry.due ? `, due ${relativeDayInSentence(entry.due, today)}${at}${repeats}` : '';
    const write = (todo: boolean) => () =>
      void saveText(text, { todo }).then((result) => {
        if (result.saved) toast(result.saved === 1 ? 'Saved to the journal' : `Saved ${result.saved} entries to the journal`, { action: { label: 'Show', run: () => void navigate('/journal') } });
        else if (result.unlock) {
          toast('Unlock the vault first, then save it again.', { action: { label: 'Unlock', run: () => void navigate(journalPath({ vaultId: result.unlock })) } });
        }
      }, (err: unknown) => {
        console.error('Saving failed', err);
        toast("Couldn't save all of it. Check the journal before saving again.");
      });
    const icon: IconName = entry.kind === 'todo' ? 'todo' : entry.diary ? 'diary' : 'note';
    writes.push({ id: 'save', group: 'Write', label: `Save “${text}”`, hint: `${where}${due}${tags}`, icon, run: write(false) });
    if (entry.kind === 'note') writes.push({ id: 'save-todo', group: 'Write', label: `Add todo “${text}”`, icon: 'todo', run: write(true) });
  }

  const found: Command[] = text && !onlyCommands
    ? engine.search(text).slice(0, 8).map((hit) => ({
        id: `card-${hit.card.id}`,
        group: 'Notes',
        label: displayTitle(hit.card),
        hint: TYPE_NAME[hit.card.type],
        icon: TYPE_ICON[hit.card.type],
        run: () => void navigate(cardPath(hit.card), { state: sheetState(location, hit.card) }),
      }))
    : [];
  // Commands whose name has every word come before those that match only by group or keyword.
  const inLabel = (c: Command) => words.every((w) => c.label.toLowerCase().includes(w));
  const matched = words.length ? commands.filter((c) => matches(c, words)).sort((a, b) => Number(inLabel(b)) - Number(inLabel(a))) : commands;
  const items = writing ? [...writes, ...matched, ...found] : [...matched, ...found, ...writes];

  const pick = Math.min(active, Math.max(items.length - 1, 0));
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${pick}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [pick]);

  const runItem = (item: Command | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  let lastGroup = '';
  return (
    <div className="dialog-backdrop palette-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Commands">
        <input
          className="palette__input"
          autoFocus
          value={query}
          placeholder="Search, write a note, or type / for commands"
          aria-label="Command"
          aria-controls="palette-list"
          aria-activedescendant={items[pick] ? `palette-${items[pick].id}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((pick + step + items.length) % Math.max(items.length, 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              runItem(items[pick]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="palette__list" id="palette-list" role="listbox" ref={list}>
          {items.length === 0 && <p className="palette__empty">Nothing matches.</p>}
          {items.map((item, i) => {
            const heading = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {heading && <p className="palette__group">{heading}</p>}
                <button
                  type="button"
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={i === pick}
                  data-index={i}
                  className={`palette__item${i === pick ? ' is-active' : ''}`}
                  onMouseMove={() => i !== pick && setActive(i)}
                  onClick={() => runItem(item)}
                >
                  {item.icon ? <Icon name={item.icon} size={18} /> : <span className="palette__pad" />}
                  <span className="palette__label">{item.label}</span>
                  {item.hint && <span className="palette__hint">{item.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <p className="palette__keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> to move, <kbd>↵</kbd> to run, <kbd>esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
