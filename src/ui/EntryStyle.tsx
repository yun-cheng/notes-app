import { useEffect, useRef, useState } from 'react';
import { linkUrls, photoIds } from '../domain/content';
import { CARD_COLORS, isCardColor, type CardColor, type DiaryCard, type NoteCard, type PreviewStyle, type TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { LINK_STYLES, PHOTO_STYLES, useDisplayPrefs } from './displayPrefs';
import { Icon } from './Icon';

type Entry = NoteCard | TodoCard | DiaryCard;

const COLOR_NAMES: Record<CardColor, string> = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', gray: 'Gray' };

/** The class that tints a bubble, or nothing for none (or a color from a newer app this one doesn't know). */
export const colorClass = (card: Entry) => (isCardColor(card.color) ? ` tint tint--${card.color}` : '');

/**
 * One entry's look: its color, and, when it has them, how its link and photo previews show. Previews not set
 * here follow the device's setting.
 */
export function StyleOptions({ card }: { card: Entry }) {
  const { repo } = useCards();
  const device = useDisplayPrefs();
  const own = card.preview ?? {};
  const links = linkUrls(card.content).length > 0;
  const photos = photoIds(card.content).length > 0;
  const color = isCardColor(card.color) ? card.color : null;

  const setPreview = (kind: keyof PreviewStyle, value?: string) => {
    const next: PreviewStyle = { ...own };
    if (value) Object.assign(next, { [kind]: value });
    else delete next[kind];
    void repo.update(card.id, { preview: next });
  };

  const previewGroup = (kind: keyof PreviewStyle, label: string, styles: Record<string, string>) => (
    <div role="radiogroup" aria-label={label} className="style-menu__group">
      <span className="style-menu__label">{label}</span>
      <button type="button" role="radio" aria-checked={!own[kind]} onClick={() => setPreview(kind)}>
        Device setting <span className="style-menu__hint">{styles[device[kind]]}</span>
      </button>
      {Object.entries(styles).map(([key, name]) => (
        <button key={key} type="button" role="radio" aria-checked={own[kind] === key} onClick={() => setPreview(kind, key)}>
          {name}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div role="radiogroup" aria-label="Color" className="style-menu__group">
        <span className="style-menu__label">Color</span>
        <div className="swatches">
          <button type="button" role="radio" className="swatch swatch--none" aria-checked={!color} aria-label="No color" title="No color" onClick={() => void repo.update(card.id, { color: null })} />
          {CARD_COLORS.map((c) => (
            <button key={c} type="button" role="radio" className={`swatch tint--${c}`} aria-checked={color === c} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]} onClick={() => void repo.update(card.id, { color: c })} />
          ))}
        </div>
      </div>
      {links && previewGroup('links', 'Link previews', LINK_STYLES)}
      {photos && previewGroup('photos', 'Photos', PHOTO_STYLES)}
    </>
  );
}

/** The style menu's button beside a bubble, shown on hover like the open button. Phones get the same choices in the entry's sheet. */
export function StyleMenu({ card }: { card: Entry }) {
  const [open, setOpen] = useState<'down' | 'up' | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Before the page's own Escape (stop picking, close a sheet), so this closes only the menu.
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(null);
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    // Clicks in the menu stay out of the bubble's own click handling (picking).
    <div ref={root} className={`entry-style${open ? ' is-open' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="entry-style__btn"
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-label="Style"
        title="Color and previews"
        // In the lower part of the screen, up, clear of the writing box.
        onClick={(e) => setOpen(open ? null : e.currentTarget.getBoundingClientRect().bottom > window.innerHeight * 0.55 ? 'up' : 'down')}
      >
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div className={`style-menu${open === 'up' ? ' style-menu--up' : ''}`} role="menu" aria-label="Color and previews">
          <StyleOptions card={card} />
        </div>
      )}
    </div>
  );
}
