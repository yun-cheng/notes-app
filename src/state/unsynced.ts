/**
 * The cards with changes this device hasn't sent to the server yet. Kept apart from the cards themselves, so a
 * sync that only sends changes redraws just the entries whose state changed, not every entry on screen.
 */
export class Unsynced {
  private ids: ReadonlySet<string> = new Set();
  private listeners = new Set<() => void>();

  set(ids: string[]) {
    if (ids.length === this.ids.size && ids.every((id) => this.ids.has(id))) return;
    this.ids = new Set(ids);
    this.listeners.forEach((l) => l());
  }

  getIds = () => this.ids;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
}
