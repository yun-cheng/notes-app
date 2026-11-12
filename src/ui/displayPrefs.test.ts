import { describe, expect, it } from 'vitest';
import { previewFor } from './displayPrefs';
import type { PreviewStyle } from '../domain/types';

describe('an entry’s preview style', () => {
  const device = { links: 'card', photos: 'thumbs' } as const;

  it('follows the device unless the entry has its own', () => {
    expect(previewFor(undefined, device)).toEqual(device);
    expect(previewFor({}, device)).toEqual(device);
    expect(previewFor({ links: 'off' }, device)).toEqual({ links: 'off', photos: 'thumbs' });
    expect(previewFor({ links: 'compact', photos: 'large' }, device)).toEqual({ links: 'compact', photos: 'large' });
  });

  it('ignores styles it doesn’t know, as a newer app might write', () => {
    expect(previewFor({ links: 'giant', photos: 7 } as unknown as PreviewStyle, device)).toEqual(device);
  });
});
