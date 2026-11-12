import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { displayTitle } from '../../domain/content';
import type { TagGroup } from '../../domain/tagGroups';
import type { TagCard } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { Empty, Page, Section } from '../components';
import { colorClass, ColorSwatches } from '../EntryStyle';
import { Icon } from '../Icon';
import { journalPath } from '../paths';
import { useToast } from '../Toast';
import { usePopover } from '../usePopover';

/** Moving tags in and out of groups, and making groups. A tag is in one group at most. */
function useGroupEdits() {
  const { index, repo } = useCards();
  const groupCards = () => [...index.byId.values()].filter((c): c is TagCard => c.type === 'tag' && !c.deleted && Array.isArray(c.members));
  const liveIds = (g: TagGroup) => g.members.map((m) => m.id);

  /** The tag's ID, made first if no tag has that name. */
  const tagNamed = (name: string) => {
    const found = index.tags.find((t) => t.title.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const id = repo.newId();
    void repo.createTag({ id, title: name });
    return id;
  };

  const addTo = (group: TagGroup, tagId: string) => {
    for (const other of groupCards()) {
      if (other.id !== group.id && other.members?.includes(tagId)) void repo.update(other.id, { members: other.members.filter((m) => m !== tagId) });
    }
    void repo.update(group.id, { members: [...liveIds(group).filter((m) => m !== tagId), tagId] });
  };
  const removeFrom = (group: TagGroup, tagId: string) => void repo.update(group.id, { members: liveIds(group).filter((m) => m !== tagId) });
  const move = (group: TagGroup, tagId: string, by: -1 | 1) => {
    const ids = liveIds(group);
    const i = ids.indexOf(tagId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void repo.update(group.id, { members: ids });
  };

  const createGroup = (title: string, init: { choice?: 'one' | 'many'; ordered?: boolean; tags?: string[] } = {}) => {
    const members = (init.tags ?? []).map(tagNamed);
    // Tags already in another group move to this one.
    for (const other of groupCards()) {
      const kept = other.members?.filter((m) => !members.includes(m));
      if (kept && kept.length !== other.members?.length) void repo.update(other.id, { members: kept });
    }
    void repo.createTag({ title, members, choice: init.choice ?? 'many', ordered: init.ordered ?? false });
  };

  return { tagNamed, addTo, removeFrom, move, createGroup };
}

const tagCount = (index: ReturnType<typeof useCards>['index'], id: string) => (index.backlinks.get(id) ?? []).filter((l) => l.kind === 'tag').length;

/**
 * Every tag: groups first, like Priority (one per entry, in order) or Topics (any number), then the tags in no
 * group. Pinned tags show in the sidebar; groups always do.
 */
export function TagsPage() {
  const { index, repo } = useCards();
  const edits = useGroupEdits();
  const { groups, loose } = index.tagGroups;
  const [title, setTitle] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const taken = (name: string) => index.tags.some((t) => t.title.toLowerCase() === name.toLowerCase()) || groups.some((g) => g.title.toLowerCase() === name.toLowerCase());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim().replace(/^#/, '');
    if (!text) return;
    setTitle('');
    if (!taken(text)) void repo.createTag({ title: text });
  };
  const submitGroup = (e: FormEvent) => {
    e.preventDefault();
    const text = groupTitle.trim();
    if (!text || taken(text)) return;
    setGroupTitle('');
    edits.createGroup(text);
  };

  return (
    <Page title="Tags">
      <Section title="Groups">
        <p className="prose-note">
          A group gathers tags under a name. In a group of one choice, like Priority, an entry takes one of its tags, and adding another swaps it. An ordered group can sort the journal.
        </p>
        {groups.map((g) => (
          <GroupBlock key={g.id} group={g} />
        ))}
        {!groups.some((g) => g.title.toLowerCase() === 'priority') && (
          <button type="button" className="btn" onClick={() => edits.createGroup('Priority', { choice: 'one', ordered: true, tags: ['High', 'Medium', 'Low'] })}>
            Add Priority: High, Medium, Low
          </button>
        )}
        <form className="quick-add" onSubmit={submitGroup}>
          <input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="New group, like Topics or Area" aria-label="New group" enterKeyHint="done" />
          <button type="submit" aria-label="Add group" disabled={!groupTitle.trim() || taken(groupTitle.trim())}>
            <Icon name="plus" size={18} />
          </button>
        </form>
      </Section>

      <Section title={groups.length ? 'Other tags' : 'Tags'}>
        <form className="quick-add" onSubmit={submit}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New tag" aria-label="New tag" enterKeyHint="done" />
          <button type="submit" aria-label="Add tag" disabled={!title.trim()}>
            <Icon name="plus" size={18} />
          </button>
        </form>
        {loose.length ? (
          <div className="list">
            {loose.map((t) => (
              <div className="row" key={t.id}>
                <TagColor tag={t} />
                <TagLink tag={t} />
                <button
                  type="button"
                  className={`icon-btn${t.pinned ? ' is-active' : ''}`}
                  aria-pressed={t.pinned}
                  aria-label={`${t.pinned ? 'Unpin' : 'Pin'} ${t.title} as a folder`}
                  title={t.pinned ? 'Unpin from sidebar' : 'Pin to sidebar as a folder'}
                  onClick={() => void repo.update(t.id, { pinned: !t.pinned })}
                >
                  <Icon name="pin" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty>{index.tags.length ? 'Every tag is in a group.' : 'No tags yet. Pin a tag and it appears as a folder.'}</Empty>
        )}
      </Section>
    </Page>
  );
}

/** A tag's color, shown on its chips: a dot that opens the colors. */
function TagColor({ tag }: { tag: TagCard }) {
  const { repo } = useCards();
  const { open, root, toggle, close } = usePopover();
  return (
    <div ref={root} className="tag-color">
      <button type="button" className={`tag-color__dot${colorClass(tag)}`} aria-haspopup="menu" aria-expanded={!!open} aria-label={`Color of ${tag.title}`} title="Color" onClick={toggle} />
      {open && (
        <div className={`style-menu tag-color__menu${open === 'up' ? ' style-menu--up' : ''}`} role="menu" aria-label={`Color of ${tag.title}`}>
          <ColorSwatches
            value={tag.color}
            onPick={(color) => {
              void repo.update(tag.id, { color });
              close();
            }}
          />
        </div>
      )}
    </div>
  );
}

function TagLink({ tag }: { tag: TagCard }) {
  const { index } = useCards();
  const count = tagCount(index, tag.id);
  return (
    <Link className="row__body" to={journalPath({ tagId: tag.id })}>
      <span className="row__title">{displayTitle(tag)}</span>
      <span className="row__preview">
        {count} {count === 1 ? 'entry' : 'entries'}
      </span>
    </Link>
  );
}

/** One group: its name, its rule, and its tags in order. */
function GroupBlock({ group }: { group: TagGroup }) {
  const { index, repo } = useCards();
  const toast = useToast();
  const edits = useGroupEdits();
  const [name, setName] = useState(group.title);
  const [adding, setAdding] = useState('');
  const q = adding.trim().replace(/^#/, '').toLowerCase();
  const options = q ? index.tags.filter((t) => t.title.toLowerCase().includes(q) && !group.members.some((m) => m.id === t.id)).slice(0, 6) : [];
  const exact = index.tags.find((t) => t.title.toLowerCase() === q);

  const rename = () => {
    const text = name.trim();
    if (text && text !== group.title) void repo.update(group.id, { title: text });
    else setName(group.title);
  };
  const add = (tagId: string) => {
    edits.addTo(group, tagId);
    setAdding('');
  };
  const remove = () => {
    void repo.setDeleted(group.id, true);
    toast(`Removed the ${group.title} group. Its tags stay on entries.`, { action: { label: 'Undo', run: () => void repo.setDeleted(group.id, false) } });
  };

  return (
    <div className="tag-group">
      <div className="tag-group__head">
        <input className="tag-group__name" value={name} aria-label="Group name" onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <button type="button" className="icon-btn" aria-label={`Remove the ${group.title} group`} title="Remove group (its tags stay)" onClick={remove}>
          <Icon name="trash" />
        </button>
      </div>
      <div className="tag-group__rules">
        <div className="segmented" role="group" aria-label="How many per entry">
          <button type="button" aria-pressed={group.choice === 'one'} onClick={() => void repo.update(group.id, { choice: 'one' })}>
            One per entry
          </button>
          <button type="button" aria-pressed={group.choice === 'many'} onClick={() => void repo.update(group.id, { choice: 'many' })}>
            Any number
          </button>
        </div>
        <label className="tag-group__ordered">
          <input type="checkbox" checked={group.ordered} onChange={(e) => void repo.update(group.id, { ordered: e.target.checked })} />
          Ordered, to sort the journal by it
        </label>
      </div>
      {group.members.length > 0 && (
        <div className="list">
          {group.members.map((t, i) => (
            <div className="row" key={t.id}>
              {group.ordered && <span className="tag-group__rank">{i + 1}</span>}
              <TagColor tag={t} />
              <TagLink tag={t} />
              <button type="button" className="icon-btn" aria-label={`Move ${t.title} up`} disabled={i === 0} onClick={() => edits.move(group, t.id, -1)}>
                <Icon name="up" />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move ${t.title} down`} disabled={i === group.members.length - 1} onClick={() => edits.move(group, t.id, 1)}>
                <Icon name="down" />
              </button>
              <button type="button" className="icon-btn" aria-label={`Take ${t.title} out of ${group.title}`} title="Take out of the group (the tag stays)" onClick={() => edits.removeFrom(group, t.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="tag-picker">
        <input
          className="tag-picker__input"
          value={adding}
          placeholder={`Add a tag to ${group.title}`}
          aria-label={`Add a tag to ${group.title}`}
          enterKeyHint="done"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !q) return;
            e.preventDefault();
            add(exact ? exact.id : edits.tagNamed(adding.trim().replace(/^#/, '')));
          }}
        />
        {q && (
          <div className="tag-picker__options">
            {options.map((t) => {
              const from = index.tagGroups.groupOf.get(t.id);
              return (
                <button key={t.id} type="button" className="chip chip--option" onClick={() => add(t.id)}>
                  {t.title}
                  {from && <span className="batch__of">from {from.title}</span>}
                </button>
              );
            })}
            {!exact && (
              <button type="button" className="chip chip--option chip--new" onClick={() => add(edits.tagNamed(adding.trim().replace(/^#/, '')))}>
                Create “{adding.trim().replace(/^#/, '')}”
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
