import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { displayTitle } from '../../domain/content';
import { isGroupName, type TagGroup } from '../../domain/tagGroups';
import type { TagCard } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { Empty, Page, Section } from '../components';
import { colorClass, ColorSwatches } from '../EntryStyle';
import { Icon } from '../Icon';
import { journalPath } from '../paths';
import { useToast } from '../Toast';
import { useUndo } from '../useUndo';
import { usePopover } from '../usePopover';
import { composing } from '../composing';
import { usePermissions } from '../viewOnly';
import { mainVault } from '../../domain/access';
import { tagNamedIn } from '../../domain/tagScope';
import type { Vault } from '../../domain/types';

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
  const { index, repo, vaults, accountId } = useCards();
  const edits = useGroupEdits();
  const { groups, loose } = index.tagGroups;
  const homes = useTagHomes();
  const [title, setTitle] = useState('');
  // A new tag is kept to a vault, the account's own unless another is picked; '' is every vault.
  const [scope, setScope] = useState(() => mainVault(vaults, accountId)?.id ?? '');
  const [groupTitle, setGroupTitle] = useState('');
  const isGroup = (name: string) => groups.some((g) => g.title.toLowerCase() === name.toLowerCase());
  const taken = (name: string) => index.tags.some((t) => t.title.toLowerCase() === name.toLowerCase()) || isGroup(name);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim().replace(/^#/, '');
    if (!text) return;
    setTitle('');
    if (!tagNamedIn(index.tags, text, scope || undefined) && !isGroup(text)) void repo.createTag({ title: text, vaultId: scope || undefined });
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
        <p className="prose-note">A tag is kept to its vault: it's offered only on entries there, and everyone in the vault has it. One for all vaults is offered everywhere, and only you see it.</p>
        <form className="quick-add" onSubmit={submit}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New tag" aria-label="New tag" enterKeyHint="done" />
          {homes.length > 0 && <ScopeSelect value={scope} vaults={homes} label="Where the new tag can go" onChange={setScope} />}
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
                <TagScope tag={t} />
                <TrashTag tag={t} />
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

/** The vaults a tag can be kept to: open ones this account can write in. */
function useTagHomes(): Vault[] {
  const { vaults, locked } = useCards();
  return vaults.filter((v) => !locked.has(v.id) && !v.withheld && (v.role ?? 'owner') !== 'viewer');
}

function ScopeSelect({ value, vaults, label, onChange }: { value: string; vaults: Vault[]; label: string; onChange: (vaultId: string) => void }) {
  return (
    <select className="vault-select tag-scope" value={value} aria-label={label} title={label} onChange={(e) => onChange(e.target.value)}>
      {vaults.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
      <option value="">All vaults</option>
    </select>
  );
}

/** Where a tag can go: kept to a vault, moving it there, or every vault. With an undo. */
function TagScope({ tag }: { tag: TagCard }) {
  const { repo, vaults } = useCards();
  const can = usePermissions();
  const homes = useTagHomes();
  const toast = useToast();
  const { undoAction } = useUndo();
  const value = tag.scope === 'vault' ? tag.vaultId : '';
  if (!can(tag).manage || !homes.length || (value && !homes.some((v) => v.id === value))) {
    const name = value ? vaults.find((v) => v.id === value)?.name : 'All vaults';
    return name ? <span className="tag-scope tag-scope--fixed">{name}</span> : null;
  }
  const change = (vaultId: string) => {
    if (vaultId === value) return;
    const action = repo.action();
    void repo.setTagScope(tag.id, vaultId || null);
    const where = vaultId ? `kept to ${vaults.find((v) => v.id === vaultId)?.name ?? 'its vault'}` : 'for all vaults';
    toast(`${tag.title} is ${where}`, { action: { label: 'Undo', run: () => void undoAction(action) } });
  };
  return <ScopeSelect value={value} vaults={homes} label={`Where ${tag.title} can go`} onChange={change} />;
}

/**
 * Moves a tag to the Trash, with an undo. Entries keep it, unseen, so restoring it from the Trash puts it back on
 * them; emptying the Trash takes it off for good.
 */
function TrashTag({ tag }: { tag: TagCard }) {
  const { index, repo } = useCards();
  const can = usePermissions();
  const toast = useToast();
  const { undoAction } = useUndo();
  if (!can(tag).manage) return null;
  const trash = () => {
    const count = tagCount(index, tag.id);
    const action = repo.action();
    void repo.setDeleted(tag.id, true);
    toast(`Moved ${tag.title} to Trash${count ? `, off ${count} ${count === 1 ? 'entry' : 'entries'}` : ''}`, { action: { label: 'Undo', run: () => void undoAction(action) } });
  };
  return (
    <button type="button" className="icon-btn" aria-label={`Move ${tag.title} to Trash`} title="Move to Trash" onClick={trash}>
      <Icon name="trash" />
    </button>
  );
}

/**
 * A tag's name, leading to its entries, and its count; the pencil renames it in place (Enter or leaving the field
 * keeps it, Escape doesn't), with an undo. Entries hold the tag itself, not its name, so they all follow. A name
 * another tag already has where this one can go, or a group's, is refused.
 */
function TagLink({ tag }: { tag: TagCard }) {
  const { index, repo } = useCards();
  const can = usePermissions();
  const toast = useToast();
  const { undoAction } = useUndo();
  const [editing, setEditing] = useState<string | null>(null);
  const count = tagCount(index, tag.id);

  const save = () => {
    if (editing === null) return;
    setEditing(null);
    const name = editing.trim().replace(/^#/, '');
    if (!name || name === tag.title) return;
    const other = tagNamedIn(index.tags, name, tag.scope === 'vault' ? tag.vaultId : undefined);
    if (other && other.id !== tag.id) return toast(`There's a ${other.title} tag already.`);
    if (isGroupName(name, index.tagGroups.groups)) return toast(`${name} is a group's name.`);
    const action = repo.action();
    void repo.update(tag.id, { title: name });
    toast(`Renamed ${tag.title} to ${name}`, { action: { label: 'Undo', run: () => void undoAction(action) } });
  };

  if (editing !== null) {
    return (
      <span className="row__body">
        <input
          className="tag-group__name"
          value={editing}
          autoFocus
          // The whole name is picked, so typing replaces it, as renaming a file does.
          onFocus={(e) => e.currentTarget.select()}
          aria-label={`New name for ${tag.title}`}
          enterKeyHint="done"
          onChange={(e) => setEditing(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composing(e)) {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(null);
            }
          }}
        />
      </span>
    );
  }
  return (
    <>
      <Link className="row__body" to={journalPath({ tagId: tag.id })}>
        <span className="row__title">{displayTitle(tag)}</span>
        <span className="row__preview">
          {count} {count === 1 ? 'entry' : 'entries'}
        </span>
      </Link>
      {can(tag).edit && (
        <button type="button" className="icon-btn" aria-label={`Rename ${tag.title}`} title="Rename" onClick={() => setEditing(tag.title)}>
          <Icon name="edit" />
        </button>
      )}
    </>
  );
}

/** One group: its name, its rule, and its tags in order. */
function GroupBlock({ group }: { group: TagGroup }) {
  const { index, repo } = useCards();
  const toast = useToast();
  const { undoAction } = useUndo();
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
    const action = repo.action();
    void repo.setDeleted(group.id, true);
    toast(`Removed the ${group.title} group. Its tags stay on entries.`, { action: { label: 'Undo', run: () => void undoAction(action) } });
  };

  return (
    <div className="tag-group">
      <div className="tag-group__head">
        <input className="tag-group__name" value={name} aria-label="Group name" onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && !composing(e) && e.currentTarget.blur()} />
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
              <TagScope tag={t} />
              <TrashTag tag={t} />
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
            if (e.key !== 'Enter' || composing(e) || !q) return;
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
