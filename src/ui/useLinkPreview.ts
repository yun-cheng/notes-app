import { useEffect, useState } from 'react';
import { fetchLinkPreview } from '../sync/http';
import type { LinkPreview } from '../sync/protocol';
import { useCards } from '../state/CardsContext';

const KEEP_MS = 7 * 86_400_000;
const RETRY_MS = 60 * 60_000;

interface Stored {
  preview: LinkPreview;
  at: number;
}

/** Previews already read this session, and the ones being read, so a link shown twice is asked for once. */
const memory = new Map<string, LinkPreview>();
const pending = new Map<string, Promise<LinkPreview | null>>();

/**
 * A link's preview, kept on this device for a week. With `allowed` false (a link in an encrypted vault) nothing
 * is asked of the server, so the address never leaves the device.
 */
export function useLinkPreview(url: string, allowed: boolean): LinkPreview | null {
  const { repo } = useCards();
  const [preview, setPreview] = useState<LinkPreview | null>(() => (allowed ? (memory.get(url) ?? null) : null));

  useEffect(() => {
    if (!allowed) return;
    if (memory.has(url)) return setPreview(memory.get(url)!);
    let live = true;
    const key = `link-preview:${url}`;
    let job = pending.get(url);
    if (!job) {
      job = (async () => {
        const stored = (await repo.getMeta(key)) as Stored | undefined;
        const age = stored ? Date.now() - stored.at : Infinity;
        // A page that said nothing is asked again sooner, in case it was only down.
        const fresh = stored && age < (stored.preview.title ? KEEP_MS : RETRY_MS);
        if (fresh) return stored.preview;
        try {
          const got = await fetchLinkPreview(url);
          await repo.setMeta(key, { preview: got, at: Date.now() } satisfies Stored);
          return got;
        } catch {
          return stored?.preview ?? null;
        }
      })().finally(() => pending.delete(url));
      pending.set(url, job);
    }
    void job.then((got) => {
      if (got) memory.set(url, got);
      if (live) setPreview(got);
    });
    return () => {
      live = false;
    };
  }, [repo, url, allowed]);

  return preview;
}
