/** Looked for in this order: most browsers name others too, and an Android phone says Linux. */
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPod/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'Chromebook'],
  [/Linux/, 'Linux'],
];
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

/**
 * What a device calls itself in the history its account sees: its browser and what it runs on, like
 * "Chrome on Mac". Plain ASCII, as it travels in a header.
 */
export function deviceName(userAgent: string, touchPoints = 0): string {
  const named = (names: [RegExp, string][]) => names.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = named(SYSTEMS);
  const browser = named(BROWSERS) ?? 'Browser';
  if (!system) return browser;
  // An iPad asks for desktop sites as a Mac would, but a Mac has no touch screen.
  return `${browser} on ${system === 'Mac' && touchPoints > 1 ? 'iPad' : system}`;
}
