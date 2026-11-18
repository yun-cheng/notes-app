import { useState, type KeyboardEvent } from 'react';
import { COMMON_REACTIONS, emojisIn, reactedBy, reactionCounts, toggleReaction } from '../domain/reactions';
import type { NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { EMOJI_GROUPS, searchEmoji } from './emojiData';
import { Icon } from './Icon';
import { usePopover } from './usePopover';
import { useInTrash, usePermissions } from './viewOnly';

type Entry = NoteCard | TodoCard;

const RECENT_KEY = 'notes-app:recent-reactions';
const RECENT_LIMIT = 16;

function recentReactions(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

function remember(emoji: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recentReactions().filter((e) => e !== emoji)].slice(0, RECENT_LIMIT)));
  } catch {
    // Without storage, the picker just has no Recent row.
  }
}

/**
 * Puts this account's reaction on an entry, or takes it off. Undefined where it can't react: anyone who could
 * change the entry can, even while it's set to view only, since a reaction leaves its words alone; not in the Trash.
 */
export function useReact(card: Entry): ((emoji: string) => void) | undefined {
  const { repo, accountId } = useCards();
  const may = usePermissions();
  const trashed = useInTrash();
  if (trashed || !may(card).protect) return undefined;
  return (emoji) => {
    void repo.update(card.id, { reactions: toggleReaction(card.reactions, emoji, accountId) });
  };
}

/** An entry's reactions, each emoji with how many put it on; pressed where this account did, and a press toggles it. */
export function ReactionChips({ card, react }: { card: Entry; react?: (emoji: string) => void }) {
  const { accountId } = useCards();
  const counts = reactionCounts(card.reactions, accountId);
  if (!counts.length) return null;
  return (
    <>
      {counts.map((r) => {
        const label = `${r.emoji} ${r.count}: ${reactedBy(r)}`;
        return react ? (
          <button
            key={r.emoji}
            type="button"
            className={`reaction${r.mine ? ' is-mine' : ''}`}
            aria-pressed={r.mine}
            aria-label={label}
            title={`${reactedBy(r)}. ${r.mine ? 'Press to take yours off' : 'Press to add yours'}`}
            onClick={() => react(r.emoji)}
          >
            <span className="reaction__emoji">{r.emoji}</span>
            {r.count}
          </button>
        ) : (
          <span key={r.emoji} className={`reaction${r.mine ? ' is-mine' : ''}`} aria-label={label} title={reactedBy(r)}>
            <span className="reaction__emoji">{r.emoji}</span>
            {r.count}
          </span>
        );
      })}
    </>
  );
}

/**
 * The common reactions in a row, then More for any emoji: the picker's groups, a search by name, and whatever's typed
 * or pasted in from the system's emoji keyboard.
 */
export function ReactionPicker({ mine, onPick }: { mine: (emoji: string) => boolean; onPick: (emoji: string) => void }) {
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const pick = (emoji: string) => {
    remember(emoji);
    onPick(emoji);
  };
  const cell = (emoji: string) => (
    <button key={emoji} type="button" className={`emoji-cell${mine(emoji) ? ' is-mine' : ''}`} aria-pressed={mine(emoji)} aria-label={emoji} title={emoji} onClick={() => pick(emoji)}>
      {emoji}
    </button>
  );

  const typed = emojisIn(query);
  const found = query.trim() ? [...new Set([...typed, ...searchEmoji(query)])] : [];
  const recent = recentReactions();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && found[0]) {
      e.preventDefault();
      pick(found[0]);
    }
  };

  return (
    <div className="reaction-picker">
      <div className="reaction-picker__quick" role="group" aria-label="Common reactions">
        {COMMON_REACTIONS.map(cell)}
        <button type="button" className="emoji-cell emoji-cell--more" aria-expanded={more} aria-label="More emoji" title="Any emoji" onClick={() => setMore(!more)}>
          <Icon name={more ? 'up' : 'plus'} size={16} />
        </button>
      </div>
      {more && (
        <>
          <input
            className="text-input reaction-picker__search"
            type="search"
            value={query}
            placeholder="Search, or type any emoji"
            aria-label="Search emoji, or type any emoji"
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="reaction-picker__grid">
            {query.trim() ? (
              found.length ? (
                <div className="reaction-picker__cells">{found.map(cell)}</div>
              ) : (
                <p className="reaction-picker__empty">No emoji called that. Type or paste one, from the emoji keyboard (Ctrl ⌘ Space on a Mac, Win . on Windows).</p>
              )
            ) : (
              <>
                {recent.length > 0 && (
                  <section>
                    <h3 className="reaction-picker__group">Recent</h3>
                    <div className="reaction-picker__cells">{recent.map(cell)}</div>
                  </section>
                )}
                {EMOJI_GROUPS.map((g) => (
                  <section key={g.name}>
                    <h3 className="reaction-picker__group">{g.name}</h3>
                    <div className="reaction-picker__cells">{[...new Set(g.emoji.map((e) => e.char))].map(cell)}</div>
                  </section>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** A smiley that opens the picker, and closes it once an emoji is picked. `look` is the bubble's hover button or the sheet's chip. */
export function AddReaction({ card, react, look = 'bubble' }: { card: Entry; react: (emoji: string) => void; look?: 'bubble' | 'sheet' }) {
  const { accountId } = useCards();
  const { open, root, toggle, close, fixedStyle } = usePopover();
  return (
    // Clicks in the menu stay out of the bubble's own click handling (picking, opening).
    <div ref={root} className={`bubble-menu${open ? ' is-open' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={look === 'bubble' ? 'bubble__add' : 'reaction reaction--add'}
        aria-haspopup="dialog"
        aria-expanded={!!open}
        aria-label="Add a reaction"
        title="Add a reaction"
        onClick={toggle}
      >
        <Icon name="smile" size={look === 'bubble' ? 12 : 15} />
      </button>
      {open && (
        <div className={`style-menu reaction-menu${open === 'up' ? ' style-menu--up' : ''}`} style={fixedStyle(296)} role="dialog" aria-label="Reactions">
          <ReactionPicker
            mine={(emoji) => !!card.reactions?.[emoji]?.includes(accountId)}
            onPick={(emoji) => {
              react(emoji);
              close();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** An entry's reactions with the button that adds one, for a bubble's bottom row or the entry's sheet. */
export function ReactionsRow({ card, look = 'bubble' }: { card: Entry; look?: 'bubble' | 'sheet' }) {
  const react = useReact(card);
  const any = reactionCounts(card.reactions, '').length > 0;
  if (!any && !react) return null;
  return (
    // A press on a reaction toggles it, without opening or picking the entry.
    <span className={look === 'bubble' ? 'reactions' : 'reactions note-sheet__reactions'} onClick={(e) => e.stopPropagation()}>
      <ReactionChips card={card} react={react} />
      {react && <AddReaction card={card} react={react} look={look} />}
    </span>
  );
}
