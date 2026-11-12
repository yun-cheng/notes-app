import { Fragment, useEffect } from 'react';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The command key as the keyboard shows it: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl+';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      [`${MOD}K or /`, 'Commands and search'],
      ['?', 'These shortcuts'],
      [`${MOD}Z`, 'Undo, when the note at the bottom offers it'],
    ],
  },
  {
    title: 'Entries in the journal',
    keys: [
      [`${MOD}A`, 'Select all shown'],
      ['Click beside one', 'Select or unselect it'],
      [`Shift-click, ${MOD}-click`, 'Select a range, or one more'],
      ['Drag from empty space', 'Select with a box'],
      ['↑ ↓', 'Move between entries'],
      ['Shift ↑ ↓', 'Select while moving'],
      ['Space', 'Select or unselect the focused entry'],
      ['Enter', 'Open the focused entry'],
      [`${MOD}C`, 'Copy the selected entries'],
      [`${MOD}X`, 'Cut them'],
      [`${MOD}V`, 'Paste copied entries; anything else goes in the writing box'],
      ['Delete', 'Move the selected entries to the Trash'],
      ['Esc', 'Stop selecting'],
    ],
  },
  {
    title: 'Writing box',
    keys: [
      ['Enter', 'Save'],
      ['Shift Enter', 'New line, or the next checkbox'],
      ['[] or TODO', 'Start a todo'],
      ['#', 'Tag'],
      ['@', 'Due date, time (@3pm) or repeat (@weekly)'],
      ['/', 'Lists, headings, photos and more'],
    ],
  },
];

/** Every keyboard shortcut, opened with `?` or from the command box. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== '?') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    // Before other Escape handlers, so this closes only the list.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog shortcuts" role="dialog" aria-label="Keyboard shortcuts">
        <h2 className="shortcuts__title">Keyboard shortcuts</h2>
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl className="shortcuts__list">
              {group.keys.map(([keys, what]) => (
                <Fragment key={keys}>
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
        <div className="note-sheet__bar">
          <span className="note-sheet__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
