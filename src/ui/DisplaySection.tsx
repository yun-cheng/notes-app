import { Section } from './components';
import type { RailSpacingChoice } from '../domain/rail';
import { LINK_STYLES, PHOTO_STYLES, RAIL_SPACINGS, setDisplayPrefs, useDisplayPrefs, type LinkStyle, type PhotoStyle } from './displayPrefs';

/** How link and photo previews look under journal entries, and how the rail spaces its years, on this device. */
export function DisplaySection() {
  const prefs = useDisplayPrefs();
  return (
    <Section title="Journal display">
      <p className="prose-note">How web links and photos show under entries on this device. Links in the text can always be clicked.</p>
      <Choice label="Link previews" options={LINK_STYLES} value={prefs.links} onPick={(links: LinkStyle) => setDisplayPrefs({ links })} />
      <Choice label="Photos" options={PHOTO_STYLES} value={prefs.photos} onPick={(photos: PhotoStyle) => setDisplayPrefs({ photos })} />
      <Choice label="Rail years" options={RAIL_SPACINGS} value={prefs.rail} onPick={(rail: RailSpacingChoice) => setDisplayPrefs({ rail })} />
      <p className="prose-note">
        The rail beside a long page gives each year room for its entries, or, nearer years larger, more room to the years nearest the one you're
        reading, less the further off. It changes once the pointer leaves the rail.
      </p>
    </Section>
  );
}

export function Choice<T extends string>({ label, options, value, onPick }: { label: string; options: Record<T, string>; value: T; onPick: (value: T) => void }) {
  return (
    <div className="field-row">
      <span className="field-row__label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {(Object.keys(options) as T[]).map((key) => (
          <button key={key} type="button" aria-pressed={value === key} onClick={() => onPick(key)}>
            {options[key]}
          </button>
        ))}
      </div>
    </div>
  );
}
