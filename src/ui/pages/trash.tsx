import { displayTitle, plainText } from '../../domain/content';
import { relativeDayInSentence, toDateKey } from '../../domain/dates';
import { isStack } from '../../domain/stacks';
import type { Card } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Empty, Page } from '../components';
import { entries } from '../entryActions';
import { Icon, type IconName } from '../Icon';
import { useToast } from '../Toast';
import { useUndo } from '../useUndo';
import { usePermissions } from '../viewOnly';

const KIND: Record<Card['type'], { icon: IconName; name: string }> = {
  note: { icon: 'note', name: 'Note' },
  todo: { icon: 'todo', name: 'Todo' },
  tag: { icon: 'tag', name: 'Tag' },
};

/**
 * What's been moved to the Trash, newest first, each with Restore, and Restore all when there are several. A page
 * of its own (it was a section of Settings until 2026-11-18), in the sidebar under the journal's pages.
 */
export function TrashPage() {
  const { index, repo } = useCards();
  const today = useToday();
  const toast = useToast();
  const may = usePermissions();
  const { undoAction } = useUndo();
  const trash = index.trash;
  const restorable = trash.filter((c) => may(c).manage);

  const restore = async (cards: Card[]) => {
    if (!cards.length) return;
    const action = repo.action();
    await Promise.all(cards.map((c) => repo.setDeleted(c.id, false)));
    toast(cards.length === 1 ? `Restored “${displayTitle(cards[0])}”` : `Restored ${entries(cards.length)}`, {
      action: { label: 'Undo', run: () => void undoAction(action) },
    });
  };

  return (
    <Page
      title={
        <>
          Trash
          {trash.length > 0 && <span className="page__count">{trash.length}</span>}
        </>
      }
      actions={
        restorable.length > 1 && (
          <button type="button" className="btn btn--quiet" onClick={() => void restore(restorable)}>
            Restore all
          </button>
        )
      }
    >
      <>
        {trash.length ? (
          <>
            <p className="prose-note">Entries and tags moved to the Trash, kept until you restore them. They’re left out of the journal and search.</p>
            <div className="list">
              {trash.map((c) => {
                const kind = isStack(c) ? { icon: 'stack' as const, name: 'Stack' } : KIND[c.type];
                const text = plainText(c.content).replace(/\s+/g, ' ').trim();
                const title = displayTitle(c);
                return (
                  <div className="row" key={c.id}>
                    <i className="row__icon">
                      <Icon name={kind.icon} size={18} />
                    </i>
                    <span className="row__body">
                      <span className="row__title">{title}</span>
                      {text && text !== title && <span className="row__preview">{text}</span>}
                      <span className="row__due">
                        {kind.name}, trashed {relativeDayInSentence(toDateKey(new Date(c.updatedAt)), today)}
                      </span>
                    </span>
                    {may(c).manage && (
                      <button type="button" className="btn" onClick={() => void restore([c])}>
                        Restore
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <Empty>Trash is empty. Entries you move to the Trash wait here, to restore.</Empty>
        )}
      </>
    </Page>
  );
}
