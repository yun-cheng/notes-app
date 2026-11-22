import { useRef, useState, type FormEvent } from 'react';
import { count as plural } from '../../domain/plural';
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
import { canWriteIn, mainVault } from '../../domain/access';
import { tagNamedIn, tagVaults } from '../../domain/tagScope';
import { SyncOffline } from '../../sync/engine';
import { shareCard, unshareCard } from '../../sync/http';
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
        <p className="prose-note">A tag is kept to the vaults you pick: it's offered only on entries there, and everyone in them has it. One for all vaults is offered everywhere, and only you see it.</p>
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
  return vaults.filter((v) => canWriteIn(v, locked));
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

/** A vault a tag kept to it can't share with another: what's in it is sealed or behind a PIN there. */
const keptAlone = (v: Vault) => !!v.encryption || v.lock === 'pin';

/**
 * Sets the vaults a tag is offered in (null: every vault): it lives in one of them, the one it's in now if it stays,
 * and is in the others besides, as an entry can be, so their members see it. Being in another vault needs a
 * connection, and the tag synced first. Undo sets back what it was.
 */
function useSetTagVaults() {
  const { index, repo, engine, sharedInto, vaults } = useCards();
  const toast = useToast();
  const latest = useRef({ index, sharedInto, vaults });
  latest.current = { index, sharedInto, vaults };
  const names = (ids: string[] | null) => (ids ? ids.map((id) => latest.current.vaults.find((v) => v.id === id)?.name ?? 'a vault').join(', ') : 'all vaults');

  const change = async (id: string, next: string[] | null) => {
    const tag = latest.current.index.byId.get(id);
    if (tag?.type !== 'tag') return;
    const shared = latest.current.sharedInto.get(id) ?? [];
    const home = next ? (next.includes(tag.vaultId) ? tag.vaultId : next[0]) : null;
    const besides = next ? next.filter((v) => v !== home) : [];
    for (const v of shared) if (!besides.includes(v)) await unshareCard(id, 'vault', v);
    await repo.setTagScope(id, home);
    if (besides.some((v) => !shared.includes(v))) {
      // The server must have it where it now lives before it can be in other vaults besides.
      await engine.sync();
      for (const v of besides) if (!shared.includes(v)) await shareCard(id, { vault_id: v }, 'edit');
    }
    await engine.sync();
  };
  const failed = (err: unknown) =>
    toast(err instanceof SyncOffline ? 'Offering a tag in more than one vault needs a connection.' : "That didn't work. A new tag can go in more vaults once it has synced.");

  return async (tag: TagCard, next: string[] | null) => {
    const before = tagVaults(tag, latest.current.sharedInto);
    try {
      await change(tag.id, next);
      toast(`${tag.title} is offered in ${names(next)}`, { action: { label: 'Undo', run: () => void change(tag.id, before).catch(failed) } });
    } catch (err) {
      failed(err);
    }
  };
}

/** Which vaults a tag is offered in, ticked in a menu, or all of them. */
function TagScope({ tag }: { tag: TagCard }) {
  const { vaults, sharedInto } = useCards();
  const can = usePermissions();
  const homes = useTagHomes();
  const setVaults = useSetTagVaults();
  const { open, root, toggle, close } = usePopover();
  const current = tagVaults(tag, sharedInto);
  const vaultOf = (id: string) => vaults.find((v) => v.id === id);
  const label = current ? current.map((id) => vaultOf(id)?.name ?? 'a vault').join(', ') : 'All vaults';
  if (!can(tag).manage || !homes.length || current?.some((id) => !homes.some((v) => v.id === id))) return <span className="tag-scope tag-scope--fixed">{label}</span>;

  const pick = (v: Vault) => {
    const on = !!current?.includes(v.id);
    if (on && current!.length === 1) return;
    // A vault whose things are sealed or behind a PIN keeps the tag to itself.
    const alone = keptAlone(v) || !!current?.some((id) => { const c = vaultOf(id); return !!c && keptAlone(c); });
    void setVaults(tag, on ? current!.filter((id) => id !== v.id) : alone || !current ? [v.id] : [...current, v.id]);
  };
  return (
    <div ref={root} className="tag-color tag-scope-menu">
      <button type="button" className="vault-select tag-scope" aria-haspopup="menu" aria-expanded={!!open} aria-label={`Where ${tag.title} is offered: ${label}`} title="Which vaults offer it" onClick={toggle}>
        {label}
      </button>
      {open && (
        <div className={`style-menu tag-color__menu vault-choices${open === 'up' ? ' style-menu--up' : ''}`} role="menu" aria-label={`Where ${tag.title} is offered`}>
          <div className="style-menu__group" role="group" aria-label="Offered in">
            <span className="style-menu__label">Offered in</span>
            {homes.map((v) => {
              const on = !!current?.includes(v.id);
              return (
                <button key={v.id} type="button" role="menuitemcheckbox" aria-checked={on} disabled={on && current!.length === 1} onClick={() => pick(v)}>
                  {on && <Icon name="check" size={14} />}
                  {v.name}
                  {keptAlone(v) && <Icon name="lock" size={12} />}
                </button>
              );
            })}
          </div>
          <div className="style-menu__group">
            <button type="button" role="menuitemradio" aria-checked={!current} onClick={() => { if (current) void setVaults(tag, null); close(); }}>
              All vaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Moves a tag to the Trash, with an undo. Entries keep it, unseen, so restoring it from the Trash puts it back on
 * them; emptying the Trash takes it off for good.
 */
function TrashTag({ tag }: { tag: TagCard }) {
  const { index, repo } = useCards();
  const can = usePermissions();
  const { said } = useUndo();
  if (!can(tag).manage) return null;
  const trash = () => {
    const count = tagCount(index, tag.id);
    const action = repo.action();
    void repo.setDeleted(tag.id, true);
    said(`Moved ${tag.title} to Trash${count ? `, off ${plural(count, 'entry', 'entries')}` : ''}`, action);
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
  const { index, repo, sharedInto } = useCards();
  const can = usePermissions();
  const toast = useToast();
  const { said } = useUndo();
  const [editing, setEditing] = useState<string | null>(null);
  const count = tagCount(index, tag.id);

  const save = () => {
    if (editing === null) return;
    setEditing(null);
    const name = editing.trim().replace(/^#/, '');
    if (!name || name === tag.title) return;
    const other = (tagVaults(tag, sharedInto) ?? [undefined]).map((v) => tagNamedIn(index.tags, name, v, sharedInto)).find((t) => t && t.id !== tag.id);
    if (other) return toast(`There's a ${other.title} tag already.`);
    if (isGroupName(name, index.tagGroups.groups)) return toast(`${name} is a group's name.`);
    const action = repo.action();
    void repo.update(tag.id, { title: name });
    said(`Renamed ${tag.title} to ${name}`, action);
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
  const { said } = useUndo();
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
    said(`Removed the ${group.title} group. Its tags stay on entries.`, action);
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
