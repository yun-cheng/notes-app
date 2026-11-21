import type { ComponentProps } from 'react';
import { pinFoundWithin } from '../domain/pin';

/**
 * A box a vault PIN is typed into, its letters shown as dots. It's a plain text box whose own letters are drawn
 * invisible, with the dots drawn over them, rather than a password box or a text box masked with
 * `-webkit-text-security`. On a Mac, typing in either of those makes Chrome turn on Secure Input, and Chrome kept it
 * on after the box went away (unlocking takes it away). While it's on, mouse tools such as Logi Options and
 * Karabiner-Elements can't pass the scroll wheel on, so nothing scrolled in any app until Chrome was left and come
 * back to (seen on 2026-11-19; the "password popup" that stopped the sidebar scrolling on 2026-11-13 was most likely
 * this too). Password managers are asked to leave it alone as well: a vault PIN isn't a site password to save or fill.
 */
export function PinInput({ value, className, ...props }: Omit<ComponentProps<'input'>, 'value' | 'type'> & { value: string }) {
  return (
    <span className={`pin-box${className ? ` ${className}` : ''}`}>
      <input
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // Ask 1Password, LastPass and Bitwarden to leave it alone.
        data-1p-ignore
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        {...props}
        className="text-input pin-input"
        value={value}
      />
      <span className="pin-box__dots" aria-hidden="true">
        {'•'.repeat([...value].length)}
      </span>
    </span>
  );
}

/**
 * Under a PIN that will encrypt a vault: how soon it could be found by trying every PIN like it on a copy of the
 * server's data, where no limit on tries holds anyone back, when that's soon. It warns; any PIN may still be used.
 */
export function PinStrength({ pin }: { pin: string }) {
  const within = pinFoundWithin(pin);
  if (!within) return null;
  return (
    <p className="prose-note pin-strength" role="status">
      Anyone with a copy of the server’s data could find a PIN like this in {within}, by trying them all. A longer one, or a few words, keeps the vault safe for years.
    </p>
  );
}
