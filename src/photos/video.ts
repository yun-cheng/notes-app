import type { VideoFacts } from './types';

/** The still's long edge: plenty for a tile or a player before it plays. */
const POSTER_EDGE = 1280;
const WAIT_MS = 8000;

/** Whether a file picked, pasted or dropped is a video: by its type, or by its name when the browser gives none. */
export const isVideoFile = (f: File) => f.type.startsWith('video/') || (!f.type && /\.(mp4|m4v|mov|webm)$/i.test(f.name));

/** A video's type, from its name when the browser didn't say. */
export function videoType(f: File): string {
  if (f.type) return f.type;
  const ext = /\.(\w+)$/.exec(f.name)?.[1].toLowerCase();
  return ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : ext === 'm4v' ? 'video/x-m4v' : 'video/mp4';
}

function happens(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`No ${event}`)), WAIT_MS);
    const ok = () => done();
    const failed = () => done(new Error("This browser can't read that video"));
    const done = (err?: Error) => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', failed);
      if (err) reject(err);
      else resolve();
    };
    el.addEventListener(event, ok);
    el.addEventListener('error', failed);
  });
}

/**
 * What a video is, read on the device as it's added: its length, its size in pixels, and a still a little way in
 * (past a black first frame), as a JPEG, to show before it plays. Whatever this browser can't read is null: a video
 * in a format it can't play still attaches, shown without a still.
 */
export async function probeVideo(file: Blob): Promise<VideoFacts> {
  const facts: VideoFacts = { poster: null, width: null, height: null, duration: null };
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const loaded = happens(video, 'loadeddata');
    video.src = url;
    await loaded;
    if (Number.isFinite(video.duration) && video.duration > 0) facts.duration = Math.round(video.duration * 10) / 10;
    const { videoWidth: w, videoHeight: h } = video;
    if (!w || !h) return facts;
    facts.width = w;
    facts.height = h;
    const at = Math.min(1, (facts.duration ?? 0) / 10);
    if (at > 0) {
      const seeked = happens(video, 'seeked');
      video.currentTime = at;
      await seeked;
    }
    const scale = Math.min(1, POSTER_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    facts.poster = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  } catch {
    // What was learned stands.
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
  return facts;
}
