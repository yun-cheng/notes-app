import { linkUrls, photoIds } from '../domain/content';
import { CARD_COLORS, isCardColor, type CardColor, type DiaryCard, type NoteCard, type PreviewStyle, type TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { LINK_STYLES, PHOTO_STYLES, useDisplayPrefs } from './displayPrefs';
import { usePopover } from './usePopover';

type Entry = NoteCard | TodoCard | DiaryCard;

const COLOR_NAMES: Record<CardColor, string> = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', gray: 'Gray' };

/** The class that tints a bubble or a tag's chip, or nothing for none (or a color from a newer app this one doesn't know). */
export const colorClass = (card: { color?: CardColor | null }) => (isCardColor(card.color) ? ` tint tint--${card.color}` : '');

/** No color, or one of the tints, to pick from. */
export function ColorSwatches({ value, onPick }: { value: CardColor | null | undefined; onPick: (color: CardColor | null) => void }) {
  const color = isCardColor(value) ? value : null;
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      <button type="button" role="radio" className="swatch swatch--none" aria-checked={!color} aria-label="No color" title="No color" onClick={() => onPick(null)} />
      {CARD_COLORS.map((c) => (
        <button key={c} type="button" role="radio" className={`swatch tint--${c}`} aria-checked={color === c} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

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
      <div className="style-menu__group">
        <span className="style-menu__label">Color</span>
        <ColorSwatches value={card.color} onPick={(color) => void repo.update(card.id, { color })} />
      </div>
      {links && previewGroup('links', 'Link previews', LINK_STYLES)}
      {photos && previewGroup('photos', 'Photos', PHOTO_STYLES)}
    </>
  );
}

/**
 * The style menu's button: in a bubble's bottom row, shown on hover like the tag button, or (`inBar`) in an
 * entry's sheet, which is where phones get it.
 */
export function StyleMenu({ card, inBar = false }: { card: Entry; inBar?: boolean }) {
  const { open, root, toggle, fixedStyle } = usePopover();

  return (
    // Clicks in the menu stay out of the bubble's own click handling (picking).
    <div ref={root} className={`entry-style${open ? ' is-open' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={inBar ? `icon-btn${open ? ' is-active' : ''}` : 'bubble__add bubble__color'}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-label="Color and previews"
        title="Color and previews"
        onClick={toggle}
      >
        {/* A circle filled with the entry's color, or empty for none. */}
        <span className={`color-dot${isCardColor(card.color) ? ` tint--${card.color}` : ''}${inBar ? ' color-dot--bar' : ''}`} />
      </button>
      {open && (
        // Fixed beside the button, so a sheet that scrolls or a bubble's row can't clip it.
        <div className={`style-menu${open === 'up' ? ' style-menu--up' : ''}`} style={fixedStyle(232)} role="menu" aria-label="Color and previews">
          <StyleOptions card={card} />
        </div>
      )}
    </div>
  );
}
