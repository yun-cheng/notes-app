import { useSyncExternalStore } from 'react';
import { levelGain, loudness, nextLevel } from '../domain/voice';

/**
 * How voice messages sound as they play: each evened out (`levelGain`), all at one volume kept on this device. They
 * play through Web Audio, which can turn a quiet one up and whose volume phones obey too (a page can't set a sound's
 * own volume on an iPhone); where there's no Web Audio, they play as they are, at the volume the browser allows.
 */

const KEY = 'voice-volume';
type Volume = { volume: number; muted: boolean };

function read(): Volume {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Volume>;
    const volume = typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : 1;
    return { volume, muted: raw.muted === true };
  } catch {
    return { volume: 1, muted: false };
  }
}

let current = read();
const listeners = new Set<() => void>();

/** What a sound is multiplied by, the slider read as heard: half way is a quarter as loud, as a volume knob turns. */
const heard = ({ volume, muted }: Volume) => (muted ? 0 : volume * volume);

function publish(next: Volume) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
  if (context && master) master.gain.setTargetAtTime(heard(next), context.currentTime, 0.02);
  for (const el of plain) el.volume = heard(next);
  listeners.forEach((l) => l());
}

/** The volume voice messages play at, from 0 to 1, and whether they're muted. */
export function useVoiceVolume(): Volume {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
  );
}

/** Sets the volume, unmuting them. */
export const setVoiceVolume = (volume: number) => publish({ volume: Math.max(0, Math.min(1, volume)), muted: false });

/** Mutes them, or brings them back: at half volume, from none. */
export const toggleVoiceMute = () => publish(current.muted || current.volume === 0 ? { volume: current.volume || 0.5, muted: false } : { ...current, muted: true });

let context: AudioContext | null = null;
let master: GainNode | null = null;
/** Sounds playing with no Web Audio, their volume set on them. */
const plain = new Set<HTMLMediaElement>();
const wired = new WeakMap<HTMLMediaElement, Wiring>();
let playing = 0;

type Session = { audioSession?: { type: string } };
/** On an iPhone, played as media is, through the silent switch, not as a page's sound effects are. */
const session = (type: 'playback' | 'auto') => {
  const s = (navigator as Session).audioSession;
  if (s) s.type = type;
};

function start(): AudioContext | null {
  if (!context) {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    try {
      context = new Context();
      master = context.createGain();
      master.gain.value = heard(current);
      // Turned up, a loud moment would clip: held under full scale instead.
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 4;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      master.connect(limiter).connect(context.destination);
    } catch {
      context = null;
      return null;
    }
  }
  if (context.state !== 'running') void context.resume().catch(() => undefined);
  return context;
}

type Wiring = { connect: () => void; disconnect: () => void };

/**
 * Readies a voice message's sound to play, evened out and at the volume set: called as it's started, in the press
 * that starts it, which is when a browser lets sound begin.
 */
export function readySound(el: HTMLMediaElement): void {
  const ctx = start();
  if (!ctx || !master) return playPlain(el);
  session('playback');
  // A sound goes through Web Audio once and for good: let go of, it's only unplugged.
  const known = wired.get(el);
  if (known) return known.connect();
  let source: MediaElementAudioSourceNode;
  try {
    source = ctx.createMediaElementSource(el);
  } catch {
    return playPlain(el);
  }
  const out = master;
  const leveler = ctx.createGain();
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  source.connect(meter);
  source.connect(leveler);

  // Followed while it plays, kept between plays: how loud this one speaks.
  let level: number | null = null;
  const stretch = new Float32Array(meter.fftSize);
  let timer: ReturnType<typeof setInterval> | null = null;
  const listen = () => {
    meter.getFloatTimeDomainData(stretch);
    const next = nextLevel(level, loudness(stretch));
    if (next === level) return;
    level = next;
    leveler.gain.setTargetAtTime(levelGain(level), ctx.currentTime, 0.15);
  };
  const onPlay = () => {
    if (timer) return;
    playing++;
    timer = setInterval(listen, 50);
  };
  const onStop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    playing = Math.max(0, playing - 1);
    if (!playing) session('auto');
  };
  let plugged = false;
  const wiring: Wiring = {
    connect() {
      if (plugged) return;
      plugged = true;
      leveler.connect(out);
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onStop);
    },
    disconnect() {
      if (!plugged) return;
      plugged = false;
      onStop();
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onStop);
      leveler.disconnect();
    },
  };
  wired.set(el, wiring);
  wiring.connect();
}

function playPlain(el: HTMLMediaElement) {
  el.volume = heard(current);
  plain.add(el);
}

/** Lets go of a voice message's sound, as its player goes. */
export function releaseSound(el: HTMLMediaElement): void {
  wired.get(el)?.disconnect();
  plain.delete(el);
}
