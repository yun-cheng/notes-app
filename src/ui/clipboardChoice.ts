import { iconElement } from './Icon';

/** The styles a copy or paste could have gone in, with the one it went in marked. */
export interface ClipboardChoice {
  kind: 'copy' | 'paste';
  /** "Copied as rich text", "Pasted with formatting": the chip's tooltip and spoken name. */
  title: string;
  options: { label: string; current: boolean; run: () => void }[];
}

/** What a chip is shown by: an element, or a spot such as the end of words selected. */
export type ChipAnchor = Pick<Element, 'getBoundingClientRect' | 'isConnected'>;

/** How long a copy's chip stays when it isn't opened or pointed at, like the toast it replaced. */
export const COPY_CHIP_MS = 10_000;

/**
 * The chip itself: a clipboard and an arrow, which open to the styles, the one used ticked. Drawn as plain elements,
 * since it's shown in an editor's text as well as over the page. A press never takes the focus.
 */
export function choiceChip(choice: ClipboardChoice, open: boolean, toggle: () => void): HTMLElement {
  const name = choice.kind === 'copy' ? 'Copy' : 'Paste';
  const box = document.createElement('span');
  box.className = `clip-choice${open ? ' is-open' : ''}`;
  box.contentEditable = 'false';
  box.addEventListener('mousedown', (e) => e.preventDefault());

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'clip-choice__toggle';
  button.title = open ? `Close ${name.toLowerCase()} options` : `${choice.title} · change`;
  button.setAttribute('aria-label', `${name} options: ${choice.title[0].toLowerCase()}${choice.title.slice(1)}`);
  button.setAttribute('aria-expanded', String(open));
  button.append(iconElement(choice.kind === 'copy' ? 'copy' : 'paste', 15), iconElement(open ? 'left' : 'right', 12));
  button.addEventListener('click', toggle);
  box.append(button);

  if (open) {
    const menu = document.createElement('span');
    menu.className = 'clip-choice__menu';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', `${name} as`);
    for (const option of choice.options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = option.label;
      item.setAttribute('aria-pressed', String(option.current));
      if (option.current) item.prepend(iconElement('check', 13));
      item.addEventListener('click', option.current ? toggle : option.run);
      menu.append(item);
    }
    box.append(menu);
  }
  return box;
}

let shown: (() => void) | null = null;

/** Takes away the chip `showChoiceNear` put up, if there is one. */
export const closeChoiceNear = () => shown?.();

/**
 * The chip over the page by `anchor`, following it as the page scrolls. Beside an entry's bubble (`side: 'right'`)
 * it's level with the bubble's top, where its copy button is, so it covers none of the entry, or inside its corner
 * under that button where there's no room beside it; by a button it's under it and right-aligned with it, or above
 * it where there's no room below. It goes after a while unless it's opened or pointed at, on a press anywhere else,
 * on Escape, or once the anchor is gone. After words (`side: 'after'`) it's just under where they end, or over it.
 * One at a time.
 */
export function showChoiceNear(anchor: ChipAnchor, choice: ClipboardChoice, side: 'right' | 'after' | 'below' = 'below') {
  closeChoiceNear();
  let open = false;
  let hovered = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const host = document.createElement('div');
  host.className = 'clip-choice-float';

  const place = () => {
    if (!anchor.isConnected) return close();
    const r = anchor.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = host;
    const fits = (x: number, y: number) => {
      host.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
      host.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
    };
    if (side === 'after') fits(r.right - 6, r.bottom + 4 + h <= window.innerHeight - 8 ? r.bottom + 4 : r.top - h - 4);
    else if (side === 'right' && r.right + 8 + w <= window.innerWidth - 8) fits(r.right + 8, r.top);
    else if (side === 'right') fits(r.right - w - 6, r.top + 30);
    else fits(r.right - w, r.bottom + 6 + h <= window.innerHeight - 8 ? r.bottom + 6 : r.top - h - 6);
    host.style.visibility = r.bottom < 0 || r.top > window.innerHeight ? 'hidden' : '';
  };
  const wait = () => {
    if (timer) clearTimeout(timer);
    timer = open || hovered ? null : setTimeout(close, COPY_CHIP_MS);
  };
  const draw = () => {
    const chip = choiceChip(
      {
        ...choice,
        options: choice.options.map((o) => ({ ...o, run: () => (close(), o.run()) })),
      },
      open,
      () => {
        open = !open;
        draw();
        wait();
      },
    );
    host.replaceChildren(chip);
    place();
  };
  const outside = (e: Event) => !host.contains(e.target as Node) && close();
  const escape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const enter = () => ((hovered = true), wait());
  const leave = () => ((hovered = false), wait());

  function close() {
    if (timer) clearTimeout(timer);
    host.remove();
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    if (shown === close) shown = null;
  }

  host.addEventListener('pointerenter', enter);
  host.addEventListener('pointerleave', leave);
  document.body.append(host);
  draw();
  wait();
  window.addEventListener('scroll', place, { capture: true, passive: true });
  window.addEventListener('resize', place);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape, true);
  shown = close;
}

/** The bubble of the first of these entries on the screen, to show a copy's chip by. */
export function entryOnScreen(ids: string[]): Element | null {
  for (const id of ids) {
    for (const row of document.querySelectorAll(`[data-entry-id="${CSS.escape(id)}"]`)) {
      const el = row.querySelector('[role="article"]') ?? row;
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom > 0 && r.top < window.innerHeight) return el;
    }
  }
  return null;
}
