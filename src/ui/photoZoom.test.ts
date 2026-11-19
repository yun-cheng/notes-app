import { describe, expect, it } from 'vitest';
import { clampZoom, FIT, MAX_ZOOM, zoomAt } from './photoZoom';

describe('zoomAt', () => {
  it('keeps the point under the pointer where it is', () => {
    // A photo whose middle is at (500, 400), zoomed 2x around (600, 450).
    const z = zoomAt(FIT, 2, 600, 450, 500, 400);
    // That point was 100, 50 from the middle; at 2x it would be 200, 100 away, so the photo moves back by 100, 50.
    expect(z).toEqual({ scale: 2, x: -100, y: -50 });
    // Zooming again around the same point keeps it there too: the middle is now at (400, 350).
    const again = zoomAt(z, 4, 600, 450, 400, 350);
    expect(again).toEqual({ scale: 4, x: -300, y: -150 });
  });

  it('zooms around the middle without moving', () => {
    expect(zoomAt(FIT, 3, 500, 400, 500, 400)).toEqual({ scale: 3, x: 0, y: 0 });
  });
});

describe('clampZoom', () => {
  it('keeps the photo within its own reach', () => {
    // A 400x300 photo at 2x may move 200 and 150 each way.
    expect(clampZoom({ scale: 2, x: -900, y: 900 }, 400, 300)).toEqual({ scale: 2, x: -200, y: 150 });
  });

  it('goes back to fitted at 1x or below, and stops at the most', () => {
    expect(clampZoom({ scale: 0.5, x: 40, y: 40 }, 400, 300)).toEqual(FIT);
    expect(clampZoom({ scale: 50, x: 0, y: 0 }, 400, 300).scale).toBe(MAX_ZOOM);
  });
});
