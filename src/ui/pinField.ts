/**
 * Props for a box a vault PIN is typed into. It's a text box with its letters masked (`.pin-input`), not a
 * password box: on a focused password box the browser's password manager and password-manager extensions open
 * their own popup, which in Chrome swallowed scrolling elsewhere on the page (the sidebar wouldn't scroll while
 * the PIN box of a locked vault had focus). A vault PIN isn't a site password to save or fill either.
 */
export const PIN_FIELD = {
  type: 'text',
  className: 'text-input pin-input',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  // Ask 1Password, LastPass and Bitwarden to leave it alone.
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;
