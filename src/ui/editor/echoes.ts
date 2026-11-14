/**
 * The saves an editor has sent and not yet seen come back, oldest first. Saves land in order, so content matching
 * one of them is that save's echo, and the ones before it have landed too. Each echo is recognised once: the same
 * content later is a real change (an undo back to it, or another device's edit) and must be shown.
 */
export class Echoes {
  private waiting: string[] = [];

  sent(json: string) {
    this.waiting = [...this.waiting.slice(-19), json];
  }

  /** True if `json` is the echo of a save, which the editor already shows. */
  isEcho(json: string): boolean {
    const at = this.waiting.indexOf(json);
    if (at < 0) return false;
    this.waiting = this.waiting.slice(at + 1);
    return true;
  }
}
