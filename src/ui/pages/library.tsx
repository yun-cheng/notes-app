import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { displayTitle, isAudio, type FileInfo } from '../../domain/content';
import { relativeDay } from '../../domain/dates';
import { FILE_KINDS, fileDays, fileKind, fileKindIn, linkDays, type DayItem, type ItemDay, type LinkInfo } from '../../domain/library';
import { entryMatcher, filterParams, isFiltered } from '../../domain/stream';
import type { Card } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { LinkCard } from '../Attachments';
import { Empty, Page } from '../components';
import { DriveLinkItems } from '../driveLink';
import { ContextMenu, Item, LinkItems, Shield, type Point } from '../EntryMenu';
import { FileChip, showsInTab, useFileActions } from '../files';
import { FilterBar, FilterSheetButton, useJournalFilter } from '../FilterPanel';
import { Icon } from '../Icon';
import { cardPath, FILES_PATH, libraryPath, sheetState } from '../paths';
import { useShowInJournal } from '../showInJournal';
import { ScrollRail } from '../ScrollRail';
import { useInView } from '../useInView';
import { holdsWords, usePageSearch } from '../PageSearch';
import { VoiceMessage } from '../voice';
import { keptPreviews, shownPreview } from '../useLinkPreview';
import type { LinkPreview } from '../../sync/protocol';

/**
 * What the journal's entries hold, by day, for the Photos, Links or Files page: the notes and todos the journal's
 * filter keeps, not archived and not templates, through `days`. With the filter, to say when it's what left none.
 */
export function useLibrary<T extends { id: string }>(days: (cards: readonly Card[]) => ItemDay<T>[]) {
  const { index, sharedInto } = useCards();
  const today = useToday();
  const filter = useJournalFilter();
  const key = filterParams(filter).toString();
  const found = useMemo(() => {
    const keep = entryMatcher(filter, today, sharedInto);
    return days(index.live.filter((c) => (c.type === 'note' || c.type === 'todo') && !c.archived && !c.template && keep(c)));
    // The filter by what it says, not which object it is.
  }, [index, key, today, sharedInto, days]);
  return { filter, days: found };
}

/** Opening an entry over the page, and going to it in the journal. */
export function useEntryActions() {
  const navigate = useNavigate();
  const location = useLocation();
  const showInJournal = useShowInJournal();
  return {
    open: (card: Card) => void navigate(cardPath(card), { state: sheetState(location, card) }),
    show: showInJournal,
  };
}

/** "3 links, in 2 entries". */
export function countLine(items: readonly { card: Card }[], one: string, many: string): string {
  const entries = new Set(items.map((i) => i.card.id)).size;
  return `${items.length === 1 ? `1 ${one}` : `${items.length} ${many}`}, in ${entries === 1 ? '1 entry' : `${entries} entries`}`;
}

/**
 * A right-click menu for something an entry holds (a photo, a link or a file): its entry and day named at the top,
 * then Open entry (over the page) and Show in journal, and after them what `children` offers for the thing itself;
 * `lead` goes before them instead, as a photo's Copy photo does.
 */
export function HeldMenu({ card, day, at, onOpen, onShow, onClose, label, lead, children }: { card: Card; day: string; at: Point; onOpen: () => void; onShow: () => void; onClose: () => void; label: string; lead?: ReactNode; children?: ReactNode }) {
  const today = useToday();
  const run = (work: () => void) => () => {
    onClose();
    work();
  };
  return createPortal(
    <Shield>
      <ContextMenu at={at} label={label} onClose={onClose}>
        <span className="context-menu__head">
          <span className="context-menu__head-title">{displayTitle(card) || 'Untitled'}</span>
          <span>{relativeDay(day, today)}</span>
        </span>
        {lead}
        <div className="style-menu__group">
          <Item icon="open" onClick={run(onOpen)}>
            Open entry
          </Item>
          <Item icon="notes" onClick={run(onShow)}>
            Show in journal
          </Item>
        </div>
        {children}
        <span className="context-menu__note">Shift-right-click for the browser's menu</span>
      </ContextMenu>
    </Shield>,
    document.body,
  );
}

/** A right-click, as a point for a menu; Shift keeps the browser's own. */
export const menuAt = (open: (at: Point) => void) => (e: MouseEvent) => {
  if (e.shiftKey) return;
  e.preventDefault();
  open({ x: e.clientX, y: e.clientY });
};

interface ListProps<T extends { id: string }> {
  title: string;
  days: ItemDay<T>[];
  filtered: boolean;
  /** One and many of what's listed: link, links. */
  noun: [string, string];
  /** What one is called besides its entry, for the search: a link's address, a file's name. */
  text: (item: DayItem<T>) => string;
  empty: string;
  emptyFiltered: string;
  /** What goes first in the filter row, like the Files page's kinds of file. */
  lead?: ReactNode;
  render: (item: DayItem<T>) => ReactNode;
  menu: (item: DayItem<T>, close: () => void) => ReactNode;
  menuLabel: string;
}

/**
 * A page listing what entries hold, newest first under the day each entry was written, each with its entry named
 * under it, pressed to open the entry. A right-click on one opens its menu (`HeldMenu`). The journal's filters
 * narrow it, as on the Photos page.
 */
function HeldList<T extends { id: string }>({ title, days: held, filtered, noun, text, empty, emptyFiltered, lead, render, menu, menuLabel }: ListProps<T>) {
  const today = useToday();
  const filter = useJournalFilter();
  const entry = useEntryActions();
  const [menuFor, setMenuFor] = useState<{ item: DayItem<T>; at: Point } | null>(null);
  // The title bar's search keeps those whose entry has its words, or that have them themselves (a link's address, a file's name).
  const search = usePageSearch({ placeholder: `Search ${noun[1]}` });
  const { words, found } = search;
  const days = useMemo(
    () => (found ? held.map((d) => ({ ...d, items: d.items.filter((i) => found.has(i.card.id) || holdsWords(text(i), words)) })).filter((d) => d.items.length) : held),
    [held, found, words, text],
  );
  const all = days.flatMap((d) => d.items);
  const keys = useMemo(() => days.flatMap((d) => d.items.map(() => d.day)), [days]);
  const list = useRef<HTMLDivElement>(null);
  // Each one's place among them all, for the rail.
  let place = 0;
  return (
    <Page
      viewOnly={false}
      title={title}
      actions={
        <>
          {search.button}
          <FilterSheetButton filter={filter} />
        </>
      }
      below={
        <>
          {search.field}
          <FilterBar filter={filter} lead={lead} />
        </>
      }
    >
      {!all.length ? (
        <Empty>{words ? `No ${noun[1]} here have “${words}” in them or their entries.` : filtered ? emptyFiltered : empty}</Empty>
      ) : (
        <div className="held" ref={list}>
          <p className="photos__count">{countLine(all, ...noun)}</p>
          {days.map(({ day, items }) => (
            <section key={day} className="held__day" aria-label={relativeDay(day, today)}>
              <h2 className="held__head">{relativeDay(day, today)}</h2>
              <ul className="held__items">
                {items.map((item) => (
                  <li key={`${item.card.id} ${item.id}`} className="held__item" data-rail-at={place++} onContextMenu={menuAt((at) => setMenuFor({ item, at }))}>
                    {render(item)}
                    <button type="button" className="held__entry" title="Open the entry" onClick={() => entry.open(item.card)}>
                      <span>{displayTitle(item.card) || 'Untitled'}</span>
                      <Icon name="right" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <ScrollRail keys={keys} name={(day) => relativeDay(day, today)} root={list} />
        </div>
      )}
      {menuFor && (
        <HeldMenu
          card={menuFor.item.card}
          day={menuFor.item.day}
          at={menuFor.at}
          label={menuLabel}
          onOpen={() => entry.open(menuFor.item.card)}
          onShow={() => entry.show(menuFor.item.card)}
          onClose={() => setMenuFor(null)}
        >
          {menu(menuFor.item, () => setMenuFor(null))}
        </HeldMenu>
      )}
    </Page>
  );
}

/**
 * Every web link in the journal's entries, as the cards under an entry show them but with each one's whole address,
 * and the page's title and picture when it can be previewed (not in an encrypted vault). A preview is asked for only as its link comes near the screen.
 */
export function LinksPage() {
  const { days, filter } = useLibrary<LinkInfo>(linkDays);
  const { repo, vaults } = useCards();
  // Its search finds a link by its page's title and description too, as this device has them: none is asked for to search.
  const previewed = useMemo(() => {
    const open = new Set(vaults.filter((v) => !v.encryption).map((v) => v.id));
    return new Set(days.flatMap((d) => d.items.filter((i) => open.has(i.card.vaultId)).map((i) => i.id)));
  }, [days, vaults]);
  // Read again only when the links change, not each time an entry does.
  const asked = [...previewed].sort().join('\n');
  const [kept, setKept] = useState<ReadonlyMap<string, LinkPreview>>(new Map());
  useEffect(() => {
    let live = true;
    void keptPreviews(repo, asked ? asked.split('\n') : []).then((got) => live && setKept(got));
    return () => {
      live = false;
    };
  }, [repo, asked]);
  const linkText = useCallback(
    (link: DayItem<LinkInfo>) => {
      const preview = previewed.has(link.id) ? (shownPreview(link.id) ?? kept.get(link.id)) : undefined;
      return [link.id, preview?.title, preview?.description, preview?.site].filter(Boolean).join(' ');
    },
    [previewed, kept],
  );
  return (
    <HeldList
      title="Links"
      days={days}
      filtered={isFiltered(filter)}
      noun={['link', 'links']}
      text={linkText}
      empty="No links yet. Paste or type a web address into an entry and it shows here."
      emptyFiltered="No links here match. Take a filter off above, or pick another."
      render={(item) => <LinkRow url={item.id} card={item.card} />}
      menuLabel="Link"
      menu={(item, close) => <LinkItems href={item.id} onClose={close} />}
    />
  );
}

const fileText = (file: DayItem<FileInfo>) => file.name;

function LinkRow({ url, card }: { url: string; card: Card }) {
  const { vaults } = useCards();
  const vault = vaults.find((v) => v.id === card.vaultId);
  const ref = useRef<HTMLSpanElement>(null);
  const near = useInView(ref, '600px 0px');
  return (
    <span ref={ref} className="held__thing">
      <LinkCard url={url} preview={near && !!vault && !vault.encryption} address />
    </span>
  );
}

/**
 * Every file attached to the journal's entries, as chips that open the file or download it, and a voice message (a
 * sound) as it plays in its entry, with its transcript. A file in two entries (a template's copy) shows once, with the newer.
 */
export function FilesPage() {
  const { days: every, filter } = useLibrary<FileInfo>(fileDays);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const kind = fileKindIn(params);
  // The switch names the kinds the filters leave, and the one picked even when they leave none of it.
  const kinds = useMemo(() => {
    const held = new Set(every.flatMap((d) => d.items.map(fileKind)));
    return FILE_KINDS.filter(([k]) => held.has(k) || k === kind);
  }, [every, kind]);
  const days = useMemo(() => (kind ? every.map((d) => ({ ...d, items: d.items.filter((f) => fileKind(f) === kind) })).filter((d) => d.items.length) : every), [every, kind]);
  const ofKind = FILE_KINDS.find(([k]) => k === kind)?.[1];
  return (
    <HeldList
      title="Files"
      days={days}
      filtered={isFiltered(filter) || !!kind}
      noun={['file', 'files']}
      text={fileText}
      empty="No files yet. Attach one to an entry with the paperclip, /file, or by dropping it in."
      emptyFiltered={ofKind ? `No ${ofKind === 'Audio' || ofKind === 'Video' ? `${ofKind.toLowerCase()} files` : ofKind.toLowerCase()} here. Pick All above, or take a filter off.` : 'No files here match. Take a filter off above, or pick another.'}
      lead={
        // Only worth a switch when there's more than one kind to tell apart.
        (kinds.length > 1 || kind) && (
          <span className="segmented filter-switch" role="group" aria-label="Kind of file">
            {[[undefined, 'All'] as const, ...kinds].map(([k, label]) => (
              <button key={label} type="button" aria-pressed={kind === k} onClick={() => void navigate(libraryPath(FILES_PATH, filter, undefined, k))}>
                {label}
              </button>
            ))}
          </span>
        )
      }
      render={(item) => (
        <span className="held__thing">
          {isAudio(item) ? <VoiceMessage file={item} vaultId={item.card.vaultId} /> : <FileChip file={item} vaultId={item.card.vaultId} />}
        </span>
      )}
      menuLabel="File"
      menu={(item, close) => <FileItems file={item} onClose={close} />}
    />
  );
}

/** A file right-clicked: open it (one the browser shows), download it, or share it by its Google Drive link. */
function FileItems({ file, onClose }: { file: FileInfo; onClose: () => void }) {
  const act = useFileActions();
  return (
    <>
      <div className="style-menu__group">
        {showsInTab(file.mime) && (
          <Item icon="open" onClick={() => (onClose(), void act(file))}>
            Open file
          </Item>
        )}
        <Item icon="download" onClick={() => (onClose(), void act(file, true))}>
          Download
        </Item>
      </div>
      <DriveLinkItems id={file.id} noun="file" onClose={onClose} />
    </>
  );
}
