import { describe, expect, it } from 'vitest';
import { FILES_PATH, libraryFilter, libraryPath, PHOTOS_PATH } from './paths';

describe('libraryPath', () => {
  it("leaves out the type and a todo status, which the Photos, Links and Files pages don't take", () => {
    expect(libraryPath(PHOTOS_PATH, { type: 'todo', status: 'open', tagId: 't1' })).toBe('/photos?tag=t1');
    expect(libraryPath(FILES_PATH, { type: 'stack' })).toBe('/files');
    expect(libraryFilter({ type: 'note', status: 'done', vaultId: 'v1' })).toEqual(expect.objectContaining({ type: undefined, status: undefined, vaultId: 'v1' }));
  });

  it("keeps Photos' own switch", () => {
    expect(libraryPath(PHOTOS_PATH, { type: 'todo' }, new URLSearchParams('show=videos'))).toBe('/photos?show=videos');
  });
});
