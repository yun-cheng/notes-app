import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { displayTitle } from '../../domain/content';
import { toDateKey } from '../../domain/dates';
import { entryMatcher, isFiltered, type StreamItem } from '../../domain/stream';
import type { Card, NoteCard, TodoCard } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Page } from '../components';
import { entries, useEntryActions } from '../entryActions';
import { FilterBar, FilterSheet, useJournalFilter } from '../FilterPanel';
import { Icon } from '../Icon';
import { SelectionProvider, useSelectionState, type Selection } from '../selection';
import { MOD } from '../Shortcuts';
import { TrashedAttachments } from '../TrashedAttachments';
import { InTrash, useCanRestore } from '../viewOnly';
import { FloatDock, Stream } from './journal';

const isEntry = (c: Card): c is NoteCard | TodoCard => c.type === 'note' || c.type === 'todo';

/**
 * What's been moved to the Trash, as the journal shows entries: bubbles under the day each was trashed, newest
 * first, narrowed by the journal's filters, its tags and vaults. They can be read and copied but not changed: each
 * has Restore where its pencil would be, and in its menu. A press picks one, and the bar for those picked restores
 * them all; Restore all, in the title bar, everything shown. Trashed tags are listed after the entries, unfiltered.
 * A page of its own since 2026-11-18, a list at the foot of Settings before, then a plain list here.
 */
export function TrashPage() {
  const { index, sharedInto, attachments } = useCards();
  const heldThere = !!useSyncExternalStore(attachments.subscribe, attachments.getState).trash?.length;
  const today = useToday();
  const filter = useJournalFilter();
  const canRestore = useCanRestore();
  const { restore, copy } = useEntryActions();
  const [filtering, setFiltering] = useState(false);

  const keep = entryMatcher(filter, today, sharedInto);
  // Each under the day it was trashed, at the time it was: the last change to a card in the Trash is trashing it.
  const items: StreamItem[] = index.trash.filter(isEntry).flatMap((card) => (keep(card) ? [{ card, day: toDateKey(new Date(card.updatedAt)), at: card.updatedAt }] : []));
  const tags = isFiltered(filter) ? [] : index.trash.filter((c) => c.type === 'tag');
  const order = items.map((i) => i.card.id);
  const selection = useSelectionState(order);
  useTrashKeys(selection, copy);

  const shown = [...items.map((i) => i.card), ...tags];
  const restorable = shown.filter(canRestore);
  const picked = selection.ids.filter((id) => {
    const c = index.byId.get(id);
    return !!c && canRestore(c);
  });

  return (
    <InTrash.Provider value>
      <SelectionProvider value={selection}>
        <Page
          title={
            <>
              {selection.selecting ? `${selection.ids.length} selected` : 'Trash'}
              {shown.length > 0 && (
                <span className="page__count" title={entries(shown.length)}>
                  {selection.selecting ? `of ${items.length}` : shown.length}
                </span>
              )}
            </>
          }
          actions={
            selection.selecting ? (
              <>
                <button type="button" className="btn btn--quiet" onClick={selection.selectAll} title={`Select all (${MOD}A)`}>
                  Select all
                </button>
                <button type="button" className="btn" onClick={selection.clear}>
                  Done
                </button>
              </>
            ) : (
              <>
                {restorable.length > 1 && (
                  // On a narrow phone only its icon, so the title keeps its room, as the journal's sort does.
                  <button
                    type="button"
                    className="btn btn--quiet restore-all"
                    aria-label="Restore all"
                    onClick={() => void restore(restorable.map((c) => c.id))}
                    title="Restore everything shown here"
                  >
                    <Icon name="undo" size={16} />
                    <span className="restore-all__label">Restore all</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`icon-btn only-mobile${filter.tagId || filter.vaultId ? ' is-active' : ''}`}
                  aria-label="Tags and vaults"
                  title="Tags and vaults"
                  onClick={() => setFiltering(true)}
                >
                  <Icon name="filter" />
                </button>
              </>
            )
          }
          below={<FilterBar filter={filter} />}
        >
          {/* Photos and files have no tags, kind or date of their own: a vault narrows them, any other filter hides them. */}
          {!isFiltered({ ...filter, vaultId: undefined }) && <TrashedAttachments vaultId={filter.vaultId} />}
          <Stream
            key={`trash:${JSON.stringify(filter)}`}
            items={items}
            // Not the written order: it opens at the top, newest first, under days that are only labels.
            sort="edited"
            empty={
              isFiltered(filter)
                ? 'Nothing in the Trash matches these filters.'
                : tags.length || heldThere
                  ? 'No entries in the Trash.'
                  : 'The Trash is empty. Entries you move to the Trash wait here until you restore them.'
            }
          />
          {tags.length > 0 && <TrashedTags tags={tags} />}
          <FloatDock open={selection.selecting}>
            <div className="batch" role="toolbar" aria-label="Selected entries in the Trash">
              <div className="batch__bar">
                <span className="batch__count">{selection.ids.length} selected</span>
                <button type="button" className="btn btn--primary" disabled={!picked.length} onClick={() => (selection.clear(), void restore(picked))}>
                  <Icon name="undo" size={16} />
                  Restore
                </button>
                <button type="button" className="icon-btn" aria-label="Copy" title={`Copy (${MOD}C)`} onClick={() => copy(selection.ids)}>
                  <Icon name="copy" />
                </button>
                <span className="note-sheet__spacer" />
                <button type="button" className="icon-btn batch__close" aria-label="Stop selecting" title="Stop selecting (Esc)" onClick={selection.clear}>
                  ×
                </button>
              </div>
              </div>
          </FloatDock>
          {filtering && <FilterSheet onClose={() => setFiltering(false)} />}
        </Page>
      </SelectionProvider>
    </InTrash.Provider>
  );
}

/** Tags aren't entries, so they have no bubbles: a short list of them, after the entries, each with Restore. */
function TrashedTags({ tags }: { tags: Card[] }) {
  const canRestore = useCanRestore();
  const { restore } = useEntryActions();
  return (
    <section className="section trash-tags" aria-label="Tags in the Trash">
      <h2>Tags</h2>
      <div className="list">
        {tags.map((t) => (
          <div className="row" key={t.id}>
            <i className="row__icon">
              <Icon name="tag" size={18} />
            </i>
            <span className="row__body">
              <span className="row__title">{displayTitle(t)}</span>
            </span>
            {canRestore(t) && (
              <button type="button" className="btn" onClick={() => void restore([t.id])}>
                Restore
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Cmd+A picks every entry shown, and Cmd+C copies those picked, as in the journal. Nothing here is cut, trashed or pasted. */
function useTrashKeys(selection: Selection, copy: (ids: string[]) => void) {
  const latest = useRef({ selection, copy });
  latest.current = { selection, copy };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.defaultPrevented || document.querySelector('.dialog-backdrop')) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      const { selection: picked, copy: copyIds } = latest.current;
      if (key === 'a' && document.querySelector('[data-entry-id]')) {
        e.preventDefault();
        picked.selectAll();
      } else if (key === 'c' && picked.ids.length && window.getSelection()?.isCollapsed !== false) {
        e.preventDefault();
        copyIds(picked.ids);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
