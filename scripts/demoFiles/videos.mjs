/**
 * Writes the demo's videos, which the dev server serves in place of Google Drive (vite.config.ts), with the still
 * each is shown with before it plays (`<name>-poster.jpg`, as a device makes one when a video is added): a slow pan
 * over the coast with the sound of the sea, landscape; one over the curry, square, on the publicly linked recipe; and
 * one over the lake, in the Trash. Each is made from the demo's own photo of it, so nothing is downloaded. Needs
 * ffmpeg; run `node scripts/demoFiles/videos.mjs` from the project folder. scripts/demoData.ts gives each its length
 * and size.
 */
import { execFileSync } from 'node:child_process';

const here = new URL('.', import.meta.url).pathname;
const photos = new URL('../demoPhotos/', import.meta.url).pathname;
const SECONDS = 6;
const FPS = 30;

/** A pan and slow zoom across `photo`, `w` by `h`, from the left (or the top) to the right (or the bottom). */
function video(name, photo, w, h, { sound = false } = {}) {
  const frames = SECONDS * FPS;
  const pan = `zoompan=z='1.12+0.1*on/${frames}':x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=${w}x${h}:fps=${FPS}`;
  const args = ['-y', '-loglevel', 'error', '-loop', '1', '-i', `${photos}${photo}.jpg`];
  if (sound) args.push('-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.12:duration=${SECONDS}`);
  args.push('-vf', `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},${pan},format=yuv420p`, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'slow', '-crf', '28');
  if (sound) args.push('-af', `afade=t=in:d=1,afade=t=out:st=${SECONDS - 1}:d=1`, '-c:a', 'aac', '-b:a', '48k', '-shortest');
  args.push('-movflags', '+faststart', `${here}${name}.mp4`);
  execFileSync('ffmpeg', args);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', `${here}${name}.mp4`, '-frames:v', '1', '-q:v', '5', `${here}${name}-poster.jpg`]);
}

video('waves', 'coast-sunset', 960, 540, { sound: true });
video('simmer', 'curry', 540, 540);
video('lake-pan', 'lake-retake', 960, 540);
