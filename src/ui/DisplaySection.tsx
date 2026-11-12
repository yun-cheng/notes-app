import { Section } from './components';
import { LINK_STYLES, PHOTO_STYLES, setDisplayPrefs, useDisplayPrefs, type LinkStyle, type PhotoStyle } from './displayPrefs';

/** How link and photo previews look under journal entries, on this device. */
export function DisplaySection() {
  const prefs = useDisplayPrefs();
  return (
    <Section title="Journal display">
      <p className="prose-note">How web links and photos show under entries on this device. Links in the text can always be clicked.</p>
      <Choice label="Link previews" options={LINK_STYLES} value={prefs.links} onPick={(links: LinkStyle) => setDisplayPrefs({ links })} />
      <Choice label="Photos" options={PHOTO_STYLES} value={prefs.photos} onPick={(photos: PhotoStyle) => setDisplayPrefs({ photos })} />
    </Section>
  );
}

function Choice<T extends string>({ label, options, value, onPick }: { label: string; options: Record<T, string>; value: T; onPick: (value: T) => void }) {
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
