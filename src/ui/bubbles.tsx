import { memo, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { count as plural } from '../domain/plural';
import { useLocation, useNavigate } from 'react-router';
import { linkTitle, resolveTags } from '../domain/cardIndex';
import { cardPages, checklistProgress, linkedCardIds, CODE_CLOSE, CODE_OPEN, displayTitle, HIDE_CLOSE, HIDE_OPEN, leadLine, previewParts, splitLinks, translationPage, pagesHaveTranslation, withNewPage, withoutLeadLine, type PreviewPart } from '../domain/content';
import { formatClock } from '../domain/dates';
import { type JSONNode, type NoteCard, type TodoCard } from '../domain/types';
import { useCards, useCardsSelect, useServices } from '../state/CardsContext';
import { setViewOnly, useInTrash, usePermissions } from './viewOnly';
import { ScrollJump } from './ScrollJump';
import { useCanComment } from './Comments';
import { ReactionsRow } from './Reactions';
import { TagChips } from './components';
import { useJournalFilter } from './FilterPanel';
import { Icon } from './Icon';
import { cardPath, sheetState } from './paths';
import { Attachments } from './Attachments';
import { colorClass } from './EntryStyle';
import { useSelectable, useSelection } from './selection';
import { writeClipboard } from './entryActions';
import { BubbleCopy } from './BubbleTools';
import { useEntryMenu } from './EntryMenu';
import { DueLabel, DueMenu, useTickTodo, WaitingMark } from './TodoDue';
import { SyncMark } from './SyncStatus';
import { languageLabel } from './codeLanguages';
import { HighlightedCode } from './highlight';
import { useToast } from './Toast';
import { useUndo } from './useUndo';
import { useCardDrag, type DragParts } from './pages/board';
import { isStack, moveInStack, stackEntries, stacksOf } from '../domain/stacks';
import { openStacks } from './useStacking';
import { googleTranslateUrl, languageName, openOutside, showTranslation, translateEntry, translatesOnDevice, useTranslation } from './translate';
import { UseTemplate } from './EntrySheet';

/** The circle beside an entry that picks it: shown on hover, and always while picking. */
export function PickCircle({ id }: { id: string }) {
  const selection = useSelection()!;
  const on = selection.has(id);
  return (
    <button
      type="button"
      className={`pick${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={on ? 'Unselect' : 'Select'}
      title="Select (Shift-click for a range)"
      onClick={(e) => selection.toggle(id, e.shiftKey)}
    >
      {on && <Icon name="check" size={14} />}
    </button>
  );
}

/**
 * An entry in the stream. Drawn again only when the entry itself changes, or what it shows of others (its tags'
 * names, the titles it links to, its vault, its comments): each reads those with `useCardsSelect`, not the cards
 * context, as one tick would otherwise redraw every bubble on screen.
 */
export const EntryBubble = memo(function EntryBubble({ card, at }: { card: NoteCard | TodoCard; at: number }) {
  if (card.type === 'todo') return <TodoBubble todo={card} at={at} />;
  if (isStack(card)) return <StackEntry stack={card} at={at} />;
  return <NoteBubble note={card} at={at} />;
});

function BubbleMeta({ card, at, fold, pager, lead }: { card: NoteCard | TodoCard; at: number; fold: Fold; pager: Pager; lead?: ReactNode }) {
  const may = usePermissions();
  const editable = may(card).edit;
  // An entry's tags and a todo's dates share a row over the rest: the tags on the left, the dates on the right. The
  // first of either is added from the entry's menu, so nothing waits on hover for them.
  const tagged = useCardsSelect((v) => resolveTags(v.index, card.tags).length > 0);
  const dated = card.type === 'todo' && !!(card.due || card.start);
  const waiting = card.type === 'todo' && card.waiting && card.status === 'open';
  return (
    <>
      {(tagged || dated) && (
        <span className="bubble__tags">
          <TagChips tagIds={card.tags} />
          {dated && (
            <span className="bubble__dates">
              {waiting && <WaitingMark />}
              {editable ? <DueMenu card={card} look="label" /> : <DueLabel todo={card} className="bubble__due" />}
            </span>
          )}
        </span>
      )}
      {/* On the left, its reactions; on the right, More or Less, then the vault and the time it was written. */}
      <span className="bubble__meta">
        {card.viewOnly && <ViewOnlyMark />}
        <ReactionsRow card={card} />
        <CommentButton card={card} />
        <span className="bubble__end">
          {lead}
          {card.template && <UseTemplate card={card} />}
          <CardBadges card={card} />
          {pager.count > 1 && (
            <span className="bubble__page" title={`Page ${pager.at + 1} of ${pager.count}`}>
              {pager.at + 1}/{pager.count}
            </span>
          )}
          {(fold.long || fold.folded) && (
            <button type="button" className="bubble__fold" aria-expanded={!fold.folded} onClick={fold.toggle}>
              <Icon name={fold.folded ? 'down' : 'up'} size={14} />
              {fold.folded ? 'More' : 'Less'}
            </button>
          )}
          {!dated && waiting && <WaitingMark />}
          <VaultLabel card={card} />
          <SyncMark id={card.id} />
          <time dateTime={new Date(at).toISOString()}>{formatClock(at)}</time>
        </span>
      </span>
    </>
  );
}

/**
 * What an entry holds, at a glance, as on a Trello card: how much of its checklists is ticked (marked when all of
 * it is), and how many of its comments are still open.
 */
function CardBadges({ card }: { card: NoteCard | TodoCard }) {
  const openComments = useOpenComments(card);
  const checks = useMemo(() => checklistProgress(card.content), [card.content]);
  const comments = useCardsSelect((v) => v.commentCounts.get(card.id) ?? 0);
  if (!checks && !comments) return null;
  const all = !!checks && checks.done === checks.total;
  return (
    <>
      {checks && (
        <span className={`bubble__badge${all ? ' is-complete' : ''}`} title={`${checks.done} of ${checks.total} checklist items done`}>
          <Icon name="checklist" size={13} />
          {checks.done}/{checks.total}
        </span>
      )}
      {comments > 0 &&
        (openComments ? (
          <button type="button" className="bubble__badge bubble__badge--button" title={`${comments === 1 ? '1 open comment' : `${comments} open comments`}: show`} onClick={openComments}>
            <Icon name="comment" size={13} />
            {comments}
          </button>
        ) : (
          <span className="bubble__badge" title={comments === 1 ? '1 open comment' : `${comments} open comments`}>
            <Icon name="comment" size={13} />
            {comments}
          </span>
        ))}
    </>
  );
}

/**
 * Opens an entry's sheet at its comments, with the box focused; null in the Trash, where a press picks it instead.
 * The press stays out of the bubble's own (opening, picking).
 */
function useOpenComments(card: NoteCard | TodoCard) {
  const navigate = useNavigate();
  const location = useLocation();
  const trashed = useInTrash();
  if (trashed) return null;
  return (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    void navigate(cardPath(card), { state: sheetState(location, card, { comments: true }) });
  };
}

/**
 * A button to comment, beside the one to react, faint until pointed at, on an entry others can see and comment on
 * that has no open comments yet (one that has some shows their count, which opens them too).
 */
function CommentButton({ card }: { card: NoteCard | TodoCard }) {
  const comments = useCardsSelect((v) => v.commentCounts.get(card.id) ?? 0);
  const writable = useCanComment(card);
  const open = useOpenComments(card);
  if (!writable || !open || comments > 0) return null;
  return (
    <button type="button" className="bubble__add bubble__comment" aria-label="Comment" title="Comment" onClick={open}>
      <Icon name="comment" size={12} />
    </button>
  );
}

/**
 * The vaults an entry is in: its own, where it's kept, then any it's also in, which share it with their members.
 * Only a label: they're changed from the entry's menu (Vaults…), and the journal is filtered to one from the
 * sidebar. Left out with only one vault, and when the journal already shows its one vault. An entry shared with
 * this account alone, from someone else's vault, says so.
 */
function VaultLabel({ card }: { card: NoteCard | TodoCard }) {
  const vaults = useCardsSelect((v) => v.vaults);
  const sharedHere = useCardsSelect((v) => v.shared.has(card.id));
  const into = useCardsSelect((v) => v.sharedInto.get(card.id)?.join('\n') ?? '');
  const filter = useJournalFilter();
  const home = vaults.find((v) => v.id === card.vaultId);
  const also = vaults.filter((v) => v.id !== card.vaultId && into.split('\n').includes(v.id));
  const inVaults = home ? [home, ...also] : also;
  if (!inVaults.length) {
    return sharedHere ? (
      <span className="bubble__vault" title="Shared with you from someone else's vault">
        <Icon name="share" size={11} />
        Shared with you
      </span>
    ) : null;
  }
  if (vaults.length < 2) return null;
  if (filter.vaultId && inVaults.length < 2) return null;
  return (
    // The label's gap spaces the names, so each but the last carries its comma.
    <span className="bubble__vault" title={`In ${inVaults.map((v) => v.name).join(', ')}`}>
      {inVaults.map((v, i) => (
        <span key={v.id} className="bubble__vault-name">
          {v.lock === 'pin' && <Icon name="lock" size={11} />}
          {v.name}
          {i < inVaults.length - 1 && ','}
        </span>
      ))}
    </span>
  );
}

/**
 * Marks an entry set to view only in its bubble's bottom row. Only a mark: it's turned off from the entry's menu or
 * its sheet's bar (until 2026-11-18 a press on it did that too).
 */
function ViewOnlyMark() {
  return (
    <span className="bubble__view-only" title="View only" aria-label="View only">
      <Icon name="eye" size={12} />
    </span>
  );
}

/** In the writing box's place while view only is on: says so, with a way back to writing. */
export function ViewOnlyBar({ to }: { to: 'top' | 'bottom' }) {
  return (
    <div className="composer composer--view-only">
      <Icon name="eye" size={18} />
      <p>View only. Entries can be read and copied, not changed.</p>
      <button type="button" className="btn btn--quiet" onClick={() => setViewOnly(false)}>
        Turn off
      </button>
      <ScrollJump to={to} />
    </div>
  );
}

const FOLDED_LINES = 6;

/** Entries folded in the stream, kept while the app is open so a filter change doesn't unfold them. */
const foldedEntries = new Set<string>();

interface Fold {
  folded: boolean;
  /** Long enough to be worth folding. */
  long: boolean;
  toggle: () => void;
}

/**
 * A bubble's text, shown in full: lines of text, with inline code, and code blocks as code, indent kept, each with a
 * copy button. A long one can be folded to its first few lines, and unfolded again, with the toggle in the bubble's
 * bottom row (`BubbleMeta`), without opening the entry.
 */
function useFold(id: string, parts: PreviewPart[]) {
  // What the bubble shows, as one string, so its length is measured again only when it changes.
  const shown = parts.map((p) => (p.kind === 'text' ? p.lines.join('\n') : `\u0000${p.language ?? ''}\u0000${p.text}`)).join('\u0001');
  const ref = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(() => foldedEntries.has(id));
  const [long, setLong] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || folded) return;
    const check = () => {
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
      setLong(el.scrollHeight > lineHeight * FOLDED_LINES + 1);
    };
    check();
    const watch = new ResizeObserver(check);
    watch.observe(el);
    return () => watch.disconnect();
  }, [shown, folded]);

  const fold: Fold = {
    folded,
    long,
    toggle: () => {
      if (folded) foldedEntries.delete(id);
      else foldedEntries.add(id);
      setFolded(!folded);
    },
  };
  const view = parts.length ? (
    <div ref={ref} className={`bubble__text${folded ? ' is-folded' : ''}`}>
      {parts.map((part, i) =>
        part.kind === 'text' ? (
          <span key={i} className="bubble__lines">
            {indentRuns(part.lines).map((run, j) =>
              run.marker !== undefined ? (
                <span key={j} className="bubble__item" style={run.depth ? { paddingLeft: `${run.depth}em` } : undefined}>
                  <span className="bubble__marker">{run.marker}</span>
                  <span>
                    <LinkedText text={run.text} />
                  </span>
                </span>
              ) : run.depth ? (
                <span key={j} className="bubble__item" style={{ paddingLeft: `${run.depth}em` }}>
                  <span>
                    <LinkedText text={run.text} />
                  </span>
                </span>
              ) : (
                <LinkedText key={j} text={run.text} />
              ),
            )}
          </span>
        ) : (
          <CodeSnippet key={i} code={part.text} language={part.language} />
        ),
      )}
    </div>
  ) : null;
  return { fold, view };
}

/** A list item's marker at the start of a preview line, as `previewParts` writes it. */
const LIST_MARKER = /^(• |\d+\. |☐ |☑ )/;

/**
 * A bubble's lines in runs, for laying out lists: each list item, with its marker apart so a long item wraps under
 * its own text rather than under the marker; and how far a line is indented, which `previewParts` writes as two
 * spaces a level for a nested list, and which the bubble shows as an em of room a level (its text collapses the
 * spaces a line starts with). Other lines stay together in one run.
 */
function indentRuns(lines: string[]): { depth: number; marker?: string; text: string }[] {
  const runs: { depth: number; marker?: string; text: string }[] = [];
  for (const line of lines) {
    const depth = Math.floor((line.length - line.trimStart().length) / 2);
    const rest = line.trimStart();
    const marker = LIST_MARKER.exec(rest)?.[0];
    const last = runs[runs.length - 1];
    if (marker) runs.push({ depth, marker, text: rest.slice(marker.length) });
    else if (!depth && last && !last.depth && last.marker === undefined) last.text += `\n${line}`;
    else runs.push({ depth, text: depth ? rest : line });
  }
  return runs;
}

/**
 * A code block in a bubble: as typed, in a code font and its language's colors, scrolling sideways when wide, with a
 * button that copies it.
 */
function CodeSnippet({ code, language }: { code: string; language: string | null }) {
  const toast = useToast();
  const copy = async () => toast((await writeClipboard(code)) ? 'Copied the code' : "Couldn't copy here. Select the code instead.");
  const label = languageLabel(language);
  return (
    <div className="bubble__snippet">
      <pre>
        <HighlightedCode code={code} language={language} />
      </pre>
      {label && <span className="bubble__snippet-lang">{label}</span>}
      <button type="button" className="bubble__snippet-copy" aria-label="Copy code" title="Copy code" onClick={() => void copy()}>
        <Icon name="copy" size={13} />
      </button>
    </div>
  );
}

/**
 * Text with its web addresses as links that open in a new tab, inline code (between `CODE_OPEN` and `CODE_CLOSE`) as
 * code, and hidden text (between `HIDE_OPEN` and `HIDE_CLOSE`) blurred until pressed. Clicking a link doesn't open
 * or pick the entry.
 */
function LinkedText({ text }: { text: string }) {
  if (!text.includes(HIDE_OPEN)) return <ShownText text={text} />;
  // Split on hidden text: the odd pieces are hidden.
  const pieces = text.split(new RegExp(`${HIDE_OPEN}([^${HIDE_CLOSE}]*)${HIDE_CLOSE}`));
  return <>{pieces.map((piece, n) => (n % 2 ? <HiddenText key={n} text={piece} /> : <ShownText key={n} text={piece} />))}</>;
}

/**
 * Hidden words, blurred: a press shows them, and another hides them again, without opening or picking the entry.
 * Shown again each time the app opens.
 */
function HiddenText({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  const toggle = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
    setShown(!shown);
  };
  return (
    <span
      className={`hidden-text${shown ? ' is-shown' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={shown}
      aria-label={shown ? undefined : 'Hidden text. Press to show'}
      title={shown ? 'Press to hide' : 'Press to show'}
      onClick={toggle}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(e)}
    >
      <ShownText text={text} />
    </span>
  );
}

function ShownText({ text }: { text: string }) {
  // Split on inline code: the odd pieces are code.
  const pieces = text.split(new RegExp(`${CODE_OPEN}([^${CODE_CLOSE}]*)${CODE_CLOSE}`));
  return (
    <>
      {pieces.map((piece, n) =>
        n % 2 ? (
          <code key={n} className="bubble__code">
            {piece}
          </code>
        ) : (
          splitLinks(piece).map((part, i) =>
            part.href ? (
              <a key={`${n}-${i}`} className="bubble__link" href={part.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                {part.text}
              </a>
            ) : (
              part.text
            ),
          )
        ),
      )}
    </>
  );
}

/**
 * The page each entry in the stream shows, 1 for its second: kept while the app is open, so a filter change doesn't
 * take it back to the first.
 */
const shownPage = new Map<string, number>();

interface Pager {
  /** The pages after the first that have something on them; none on most entries. */
  pages: JSONNode[];
  /** How many pages it has, the first among them. */
  count: number;
  /** The page showing: 0 for the first. */
  at: number;
  /** The way the last step went, so the page shown slides in from that side; none until it's stepped. */
  went: '' | 'next' | 'prev';
  /** How many steps so far, so each plays its slide. */
  steps: number;
  /** To the next page (1) or the previous (-1), round from the last to the first and the other way. */
  step: (way: 1 | -1) => void;
}

/**
 * An entry with more than one page shows one at a time in its bubble: ‹ and › down its sides step through them,
 * round and round (`PageEdges`), and its bottom row says which it's on (1/3).
 */
function usePager(card: NoteCard | TodoCard): Pager {
  const pages = useMemo(() => cardPages(card), [card]);
  const [kept, setAt] = useState(() => shownPage.get(card.id) ?? 0);
  const [moved, setMoved] = useState<{ went: Pager['went']; steps: number }>({ went: '', steps: 0 });
  // A page taken out since leaves it on the first.
  const at = kept <= pages.length ? kept : 0;
  const count = pages.length + 1;
  return {
    pages,
    count,
    at,
    ...moved,
    step: (way) => {
      if (count < 2) return;
      const to = (at + way + count) % count;
      if (to) shownPage.set(card.id, to);
      else shownPage.delete(card.id);
      setMoved({ went: way > 0 ? 'next' : 'prev', steps: moved.steps + 1 });
      setAt(to);
    },
  };
}

/**
 * A bubble's classes for its pages: room at its sides for the arrows, and a slide for the page it just stepped to,
 * in from the right for the next and from the left for the previous. Each way has two names, taken in turn, so
 * every step plays.
 */
const pagerClass = (pager: Pager) => (pager.count > 1 ? ' has-pages' : '') + (pager.went ? ` page-in-${pager.went}${pager.steps % 2 ? '' : '-2'}` : '');

/** The previous and next page, each the full height of a bubble's side, going round past the last or the first. */
function PageEdges({ pager }: { pager: Pager }) {
  if (pager.count < 2) return null;
  return (
    <>
      <button type="button" className="page-edge page-edge--prev" aria-label="Previous page" title="Previous page" onClick={() => pager.step(-1)}>
        <Icon name="left" size={14} />
      </button>
      <button type="button" className="page-edge page-edge--next" aria-label="Next page" title="Next page" onClick={() => pager.step(1)}>
        <Icon name="right" size={14} />
      </button>
    </>
  );
}

/** Opens an entry in a sheet over this page: to edit, with its text focused, or (a tap on a phone) just to read. */
/** Opens an entry in its sheet. In the Trash, where nothing is changed, a press picks it instead, to restore. */
function useOpen(card: NoteCard | TodoCard) {
  const navigate = useNavigate();
  const location = useLocation();
  const trashed = useInTrash();
  const selection = useSelection();
  if (trashed) return () => selection?.toggle(card.id);
  return (edit = false) => void navigate(cardPath(card), { state: sheetState(location, card, edit ? { edit } : {}) });
}

/** What every bubble does: its text, folded when long; opening it; its menu; and picking it. */
/** Runs of text put back with their translations; code stays as it was. `pieces[0]` is the title's. */
function translatedParts(parts: PreviewPart[], pieces: string[]): PreviewPart[] {
  let next = 1;
  return parts.map((p) => (p.kind === 'text' ? { kind: 'text', lines: (pieces[next++] ?? p.lines.join('\n')).split('\n') } : p));
}

/**
 * What every bubble does: its text, folded when long; opening it; its menu; picking it; and translating what it
 * shows (`title` and the side it's on), into the bubble, with Show original to go back.
 */
/** With `titleFromText`, the first line of its text is shown as its name (`title`), so it's left out of the text. */
function useBubble(card: NoteCard | TodoCard, title: string, titleFromText = false) {
  const { keyring, repo, latest } = useServices();
  const may = usePermissions();
  const { said } = useUndo();
  const toast = useToast();
  const pager = usePager(card);
  const doc = pager.at ? pager.pages[pager.at - 1] : card.content;
  const titleOf = (id: string, label: string) => linkTitle(latest().index, id, label);
  // The document's previews are worked out again only when it changes or a card it links to is renamed, not on
  // every redraw: what its links show is the one thing the index changes, and the bubble is drawn again for it.
  const linked = useMemo(() => linkedCardIds(doc), [doc]);
  const linkTitles = useCardsSelect((v) => linked.map((id) => linkTitle(v.index, id, '')).join('\u0000'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const masked = useMemo(() => previewParts(doc, titleOf, { hidden: 'mask' }), [doc, linkTitles]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marked = useMemo(() => previewParts(doc, titleOf, { markCode: true, hidden: 'mark' }), [doc, linkTitles]);
  // What a translation covers: hidden words go as •••, and code isn't sent.
  // Only the first page's text gives the name.
  const named = (parts: PreviewPart[]) => (titleFromText && !pager.at ? withoutLeadLine(parts) : parts);
  const plain = named(masked);
  const pieces = [title, ...plain.flatMap((p) => (p.kind === 'text' ? [p.lines.join('\n')] : []))];
  const translation = useTranslation(card.id);
  // Kept while the app is open, for these words: shown, or put aside with Show original until shown again.
  const kept = translation && translation !== 'working' && translation.source === pieces.join('\n') ? translation : null;
  const done = kept?.shown ? kept : null;
  const text = useFold(card.id, done ? translatedParts(plain, done.pieces) : named(marked));
  const open = useOpen(card);
  const withGoogle = () => openOutside(googleTranslateUrl(pieces.filter((p) => p.trim()).join('\n\n')));
  // The server may translate it, and this device keep the translation, unless it's in an encrypted vault, whose
  // words never go there and are kept here only encrypted.
  const server = !keyring.isEncrypted(card.vaultId);
  const translate = async () => {
    if (kept) return showTranslation(card.id, !kept.shown);
    if (!translatesOnDevice() && !server) return withGoogle();
    const result = await translateEntry(card.id, pieces, { server, keep: server });
    if (result.kind === 'same') toast(`It's in ${languageName(result.language)} already`);
    else if (result.kind === 'limit') toast("That's all the translating for today. More tomorrow.", { action: { label: 'Translate with Google', run: withGoogle } });
    else if (result.kind !== 'done')
      toast(server ? "It couldn't be translated just now." : "This browser couldn't translate it on the device.", { action: { label: 'Translate with Google', run: withGoogle } });
  };
  // The first page's translation can go on a new page of its own after the others.
  const toPage = !!done && !pager.at && may(card).edit && !pagesHaveTranslation(pager.pages, done.pieces);
  const saveAsPage = (pieces: string[]) => {
    const action = repo.action();
    void repo.update(card.id, withNewPage(card, translationPage(pieces)));
    said(`Saved as page ${pager.count + 1}`, action);
  };
  const menu = useEntryMenu(card, {
    open,
    translate: () => void translate(),
    translated: !!done,
    keptIn: kept && !done ? languageName(kept.to) : undefined,
    translatesHere: server || translatesOnDevice(),
  });
  const translated =
    translation === 'working' ? (
      <span className="bubble__translated">Translating…</span>
    ) : done ? (
      <span className="bubble__translated">
        <Icon name="translate" size={12} />
        From {languageName(done.from)}
        <button type="button" onClick={(e) => (e.stopPropagation(), showTranslation(card.id, false))}>
          Show original
        </button>
        {toPage && (
          <button type="button" title="Put this translation on a new page of its own" onClick={(e) => (e.stopPropagation(), saveAsPage(done.pieces))}>
            Save as a page
          </button>
        )}
      </span>
    ) : kept ? (
      <span className="bubble__translated">
        <Icon name="translate" size={12} />
        <button type="button" onClick={(e) => (e.stopPropagation(), showTranslation(card.id, true))}>
          Show in {languageName(kept.to)}
        </button>
      </span>
    ) : null;
  const selectable = useSelectable(card.id, open, menu.onContextMenu);
  // ← and → on the focused bubble step through its pages.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const way = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (way && e.target === e.currentTarget && pager.count > 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      pager.step(way);
      return;
    }
    selectable.handlers.onKeyDown(e);
  };
  return { text, pager, menu, title: done ? done.pieces[0] : title, translated, selected: selectable.selected, handlers: { ...selectable.handlers, onKeyDown } };
}

function NoteBubble({ note, at }: { note: NoteCard; at: number }) {
  const { text, pager, menu, title, translated, selected, handlers } = useBubble(note, note.title.trim());
  return (
    <div className={`bubble${colorClass(note)}${pagerClass(pager)}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
      {translated}
      {title && (
        <strong className="bubble__title">
          <LinkedText text={title} />
        </strong>
      )}
      {text.view}
      <BubbleMeta card={note} at={at} fold={text.fold} pager={pager} />
      <PageEdges pager={pager} />
      <BubbleCopy card={note} />
      {menu.view}
    </div>
  );
}

type Entry = NoteCard | TodoCard;

/** A stack's list is one column to drag its entries up and down in. */
const STACK_PARTS: DragParts = { column: '.stack__cards', card: '.stack__card', grip: '.stack__grip', cards: '.stack__cards', fit: ':scope > .bubble' };

/** How many of its entries a closed stack names. */
const PEEK = 3;

/**
 * A stack in the stream: its name and text, the first few of its entries, and a button that opens it to show them
 * all, in its order, under it. Its cards fan out behind it.
 */
function StackEntry({ stack, at }: { stack: NoteCard; at: number }) {
  const { index } = useCards();
  // A stack in the Trash has let its entries go back to the stream; shown there, it lists what restoring it takes back in.
  const of = stack.deleted ? new Map((stack.stack ?? []).filter((id) => !stacksOf(index).has(id)).map((id) => [id, stack.id])) : stacksOf(index);
  const members = stackEntries(stack, index.byId, of);
  // With no title of its own, it's called by the first line of its text, and "Stack" only when it has none.
  const own = stack.title.trim();
  const lead = own ? '' : leadLine(previewParts(stack.content, (id, label) => linkTitle(index, id, label), { hidden: 'mask' }));
  const { text, pager, menu, title, translated, selected, handlers } = useBubble(stack, own || lead || 'Stack', !!lead);
  const [expanded, setExpanded] = useState(() => openStacks.has(stack.id));
  const toggle = () => {
    if (expanded) openStacks.delete(stack.id);
    else openStacks.add(stack.id);
    setExpanded(!expanded);
  };
  const count = `${plural(members.length, 'card')}`;
  return (
    <>
      <div className={`bubble bubble--stack${colorClass(stack)}${pagerClass(pager)}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
        {translated}
        <span className="stack__head">
          <Icon name="stack" size={15} />
          <strong className="bubble__title">
            <LinkedText text={title} />
          </strong>
        </span>
        {text.view}
        {!expanded && members.length > 0 && (
          <ul className="stack__peek">
            {members.slice(0, PEEK).map((m) => (
              <li key={m.id}>
                {m.type === 'todo' ? (m.status === 'done' ? '☑ ' : '☐ ') : ''}
                {displayTitle(m)}
              </li>
            ))}
            {members.length > PEEK && <li className="stack__more">and {members.length - PEEK} more</li>}
          </ul>
        )}
        <BubbleMeta
          card={stack}
          at={at}
          fold={text.fold}
          pager={pager}
          lead={
            <button type="button" className="bubble__fold" aria-expanded={expanded} title={expanded ? 'Close the stack' : 'Open the stack'} onClick={toggle}>
              <Icon name={expanded ? 'up' : 'down'} size={14} />
              {count}
            </button>
          }
        />
        <PageEdges pager={pager} />
        <BubbleCopy card={stack} />
        {menu.view}
      </div>
      {expanded && <StackCards stack={stack} members={members} />}
    </>
  );
}

/**
 * An open stack's entries, in its order, each as in the stream, with its photos and link previews under it. They're dragged up and down to change the order (a
 * mouse from anywhere on one, a finger from its grip), or moved with the arrow keys on the grip. While one is
 * dragged it moves among the others to where it would land, faded, and stays there when dropped: the new order shows
 * at once, before it's saved. Each change can be undone; taking one out is in its menu.
 */
function StackCards({ stack, members }: { stack: NoteCard; members: Entry[] }) {
  const { repo } = useServices();
  const may = usePermissions();
  const can = may(stack).edit;
  // The order just dropped, shown until it's saved: while the stack's saved list is one from before it (`stale`).
  const [dropped, setDropped] = useState<{ order: string[]; stale: string[] } | null>(null);
  const saved = (stack.stack ?? []).join('\n');
  const pending = dropped && dropped.stale.includes(saved) ? dropped.order : null;
  const list = pending ?? stack.stack ?? [];
  let base = members;
  if (pending) {
    const place = new Map(pending.map((id, i) => [id, i]));
    base = [...members].sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0));
  }
  const shown = base.map((m) => m.id);

  const move = (id: string, index: number) => {
    const next = moveInStack(list, shown, id, index);
    if (next.join('\n') === list.join('\n')) return;
    setDropped({ order: next, stale: [...(pending && dropped ? dropped.stale : []), saved, list.join('\n')] });
    void repo.update(stack.id, { stack: next });
  };
  const drag = useCardDrag((id, to) => move(id, to.index), STACK_PARTS);
  const moveByKey = (e: ReactKeyboardEvent, id: string, at: number) => {
    const to = e.key === 'ArrowUp' ? at - 1 : e.key === 'ArrowDown' ? at + 1 : null;
    if (to === null || to < 0 || to >= members.length) return;
    e.preventDefault();
    move(id, to);
    // The card moves to another place: its grip keeps the focus there.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-stack-entry="${CSS.escape(id)}"] .stack__grip`)?.focus());
  };

  // While dragging, the dragged one shows where it would land.
  let order = base;
  const moving = drag.dragging;
  if (moving?.to) {
    const card = base.find((c) => c.id === moving.id);
    const others = base.filter((c) => c.id !== moving.id);
    if (card) order = [...others.slice(0, moving.to.index), card, ...others.slice(moving.to.index)];
  }

  return (
    <div ref={drag.board} className={`stack__cards${moving ? ' is-dragging' : ''}`} data-column={stack.id} aria-label={`In ${stack.title.trim() || 'the stack'}`}>
      {order.map((card, at) => (
        <div
          key={card.id}
          className={`stack__card${moving?.id === card.id ? ' is-moving' : ''}`}
          data-stack-entry={card.id}
          onPointerDown={can ? (e) => drag.start(e, card.id) : undefined}
        >
          {can && (
            <button
              type="button"
              className="board__grip stack__grip"
              aria-label={`Move "${displayTitle(card)}"`}
              title="Drag to move, or use the arrow keys"
              onKeyDown={(e) => moveByKey(e, card.id, at)}
              onClick={(e) => e.preventDefault()}
            >
              <Icon name="grip" size={14} />
            </button>
          )}
          <EntryBubble card={card} at={card.createdAt} />
          <Attachments card={card} />
        </div>
      ))}
      {members.length === 0 && <p className="stack__empty">Nothing in this stack yet. Pick it with entries, then Stack, to put them in.</p>}
    </div>
  );
}

function TodoBubble({ todo, at }: { todo: TodoCard; at: number }) {
  const may = usePermissions();
  const tick = useTickTodo();
  const { text, pager, menu, title, translated, selected, handlers } = useBubble(todo, displayTitle(todo));
  const done = todo.status === 'done';
  const waiting = !done && !!todo.waiting;
  return (
    <div
      className={`bubble bubble--todo${colorClass(todo)}${pagerClass(pager)}${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`}
      role="article"
      aria-current={selected || undefined}
      {...handlers}
    >
      <label className={`check${waiting ? ' check--waiting' : ''}`}>
        <input
          type="checkbox"
          checked={done}
          disabled={!may(todo).edit}
          aria-label={`Mark "${displayTitle(todo)}" ${done ? 'not done' : 'done'}`}
          onChange={() => tick(todo)}
        />
      </label>
      <div className="bubble__body">
        {translated}
        <span className="bubble__title">
          <LinkedText text={title} />
        </span>
        {text.view}
        <BubbleMeta card={todo} at={at} fold={text.fold} pager={pager} />
      </div>
      <PageEdges pager={pager} />
      <BubbleCopy card={todo} />
      {menu.view}
    </div>
  );
}
