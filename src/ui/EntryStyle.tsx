import { linkUrls, photoIds } from '../domain/content';
import { CARD_COLORS, isCardColor, type CardColor, type DiaryCard, type NoteCard, type PreviewStyle, type TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { LINK_STYLES, PHOTO_STYLES, useDisplayPrefs } from './displayPrefs';
import { Icon } from './Icon';
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

/** The style menu's button beside a bubble, shown on hover like the open button. Phones get the same choices in the entry's sheet. */
export function StyleMenu({ card }: { card: Entry }) {
  const { open, root, toggle } = usePopover();

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
        onClick={toggle}
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
