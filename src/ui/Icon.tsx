const PATHS = {
  today: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  upcoming: 'M4 7h16M4 12h10M4 17h6M16 15l3 3 3-3M19 11v7',
  calendar: 'M4 9h16M8 3v4M16 3v4M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  notes: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v5h5M9 13h6M9 17h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  open: 'M7 17 17 7M9 7h8v8',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  filter: 'M4 6h16M7 12h10M10 18h4',
  search: 'M20 20l-4.2-4.2M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  tag: 'M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9ZM8 8h.01',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  plus: 'M12 5v14M5 12h14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a1 1 0 0 1 1-1Z',
  pin: 'M9 4h6l-1 6 4 4H6l4-4-1-6ZM12 14v7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 16l5-5 4 4 3-3 6 6M15 9h.01',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  diary: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 3v18M12 8h4',
  todo: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 12l3 3 5-6',
  note: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v5h5',
  send: 'M12 19V5M6 11l6-6 6 6',
  more: 'M5 11.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6ZM12 11.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6ZM19 11.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Z',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
