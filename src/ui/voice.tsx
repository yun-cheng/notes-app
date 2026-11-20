import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { clipLength, type FileInfo } from '../domain/content';
import { canChangeInTheOpen } from '../domain/access';
import { cueAt, cutPoints, joinTranscripts, PEAK_BARS, VOICE_RATE, wavBytes, type Transcript } from '../domain/voice';
import { decodeVoice } from '../photos/audio';
import type { PhotoService } from '../photos/service';
import { useCards } from '../state/CardsContext';
import { transcribePiece, type TranscribeResult } from '../sync/http';
import { writeClipboard } from './entryActions';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { useVideoAddress } from './video';
import { readySound, releaseSound, setVoiceVolume, toggleVoiceMute, useVoiceVolume } from './voiceSound';

/**
 * The voice messages on show, so they play as Telegram plays them: one at a time, and on from one that ends to the
 * next one down the same journal or entry, whatever is between them.
 */
const players = new Map<HTMLElement, { play: () => boolean; pause: () => void }>();

/** Plays the next voice message down from `root` that can play, if there is one. */
function playAfter(root: HTMLElement) {
  const scope = root.closest('.stream, .ProseMirror') ?? document.body;
  const after = [...players.keys()]
    .filter((r) => r !== root && scope.contains(r) && root.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  for (const r of after) if (players.get(r)?.play()) return;
}

/** The longest voice message recorded at once: a quarter of what a day's transcribing allows. */
export const MAX_RECORDING_SECONDS = 15 * 60;

type Job = { state: 'working' } | { state: 'done'; words: Transcript } | { state: 'failed'; message: string };

/**
 * Voice messages being transcribed, and how each went, this visit: kept apart from any one view of them, so a
 * transcript that comes back after its editor has closed (an entry sent from the journal box) still reaches the entry,
 * through the next view of it that can change it.
 */
const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
const setJob = (id: string, job: Job | null) => {
  if (job) jobs.set(id, job);
  else jobs.delete(id);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/**
 * Voice messages recorded on this device this visit, transcribed as soon as a view of them that can change them
 * shows, each with its sound as decoded when it was added (null if it couldn't be), so it isn't decoded again.
 */
export const recordedHere = new Map<string, Float32Array | null>();

const PROBLEM: Record<Exclude<TranscribeResult, { text: string }>['error'], string> = {
  encrypted: 'Voice in a private vault isn’t sent to the server, so it isn’t transcribed.',
  limit: 'That’s an hour of voice transcribed today, as much as a day has. Try again tomorrow.',
  not_set_up: 'This server can’t transcribe voice.',
  offline: 'Transcribing needs a connection. Try again once you’re online.',
  failed: 'Couldn’t transcribe it. Try again.',
};

/** Transcribes a voice message on the server, a piece of up to two minutes at a time, cut between words. */
async function transcribe(id: string, vaultId: string, photos: PhotoService, decoded: Float32Array | null = null): Promise<void> {
  if (jobs.get(id)?.state === 'working') return;
  setJob(id, { state: 'working' });
  try {
    const blob = decoded ? null : await photos.blob(id).catch(() => null);
    if (!decoded && !blob) return setJob(id, { state: 'failed', message: 'This recording isn’t here yet: it hasn’t been uploaded from its device.' });
    const samples = decoded ?? (await decodeVoice(blob!).catch(() => null));
    if (!samples) return setJob(id, { state: 'failed', message: 'This browser can’t read this recording to transcribe it.' });
    const bounds = [0, ...cutPoints(samples), samples.length];
    const pieces = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const got = await transcribePiece(vaultId, wavBytes(samples.subarray(bounds[i], bounds[i + 1])));
      if ('error' in got) return setJob(id, { state: 'failed', message: PROBLEM[got.error] });
      pieces.push({ offset: bounds[i] / VOICE_RATE, ...got });
    }
    setJob(id, { state: 'done', words: joinTranscripts(pieces) });
  } catch {
    setJob(id, { state: 'failed', message: PROBLEM.failed });
  }
}

/**
 * A voice message (any sound attached) playing where it is: a play button, its loudness drawn along its length to
 * seek in, the time, a speed to play it at, and the volume all voice messages play at (`voiceSound`), each evened out. One plays at a time, and one that ends runs on to the next one down (`playAfter`). Under it, its transcript, each stretch pressed to play from there and
 * the one being said marked; or, where `onTranscript` can save one, Transcribe, which a recording made here does by
 * itself. `vaultId` is the vault of the entry holding it.
 */
export function VoiceMessage({ file, vaultId, onTranscript }: { file: FileInfo; vaultId?: string; onTranscript?: (words: Transcript) => void }) {
  const { photos, vaults } = useCards();
  const toast = useToast();
  const { address, failed } = useVideoAddress(file.id);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState<number | null>(file.duration ?? null);
  const [speed, setSpeed] = useState(1);
  const [broken, setBroken] = useState(false);
  const job = useSyncExternalStore(subscribe, () => jobs.get(file.id));
  const vault = vaults.find((v) => v.id === vaultId);
  const can = !!onTranscript && canChangeInTheOpen(vault);
  const latest = useRef(onTranscript);
  latest.current = onTranscript;

  // One recorded here is transcribed at once; one transcribed while no view could save it is saved now.
  useEffect(() => {
    if (!can || !vaultId) return;
    if (recordedHere.has(file.id) && !file.transcript) {
      const decoded = recordedHere.get(file.id) ?? null;
      recordedHere.delete(file.id);
      void transcribe(file.id, vaultId, photos, decoded);
    }
  }, [can, vaultId, file.id]);
  useEffect(() => {
    // Read again, not `job`: with the entry open in the journal too, the first view to get here saves it, alone.
    const now = jobs.get(file.id);
    if (now?.state !== 'done' || !latest.current) return;
    setJob(file.id, null);
    latest.current(now.words);
  }, [job]);

  useEffect(() => {
    const el = audio.current;
    return () => void (el && releaseSound(el));
  }, [address]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const me = root.current;
    if (!me) return;
    players.set(me, {
      play: () => {
        const el = audio.current;
        if (!el || broken) return false;
        start(el);
        return true;
      },
      pause: () => audio.current?.pause(),
    });
    return () => void players.delete(me);
  });

  const total = length ?? file.duration ?? 0;
  /** Starts it, saying so only if this browser can't play it at all (not when it was only stopped or not allowed yet). */
  const start = (el: HTMLAudioElement) => (readySound(el), void el.play().catch((err: { name?: string }) => err?.name === 'NotSupportedError' && setBroken(true)));
  const play = (e?: MouseEvent) => {
    e?.stopPropagation();
    const el = audio.current;
    if (!el) return;
    if (el.paused) start(el);
    else el.pause();
  };
  const seek = (to: number, andPlay = false) => {
    const el = audio.current;
    if (!el || !total) return;
    el.currentTime = Math.max(0, Math.min(total, to));
    setTime(el.currentTime);
    if (andPlay && el.paused) start(el);
  };
  const seekAt = (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const box = e.currentTarget.getBoundingClientRect();
    // Not laid out (a hidden page): no place to point at.
    if (box.width) seek(((e.clientX - box.left) / box.width) * total);
  };
  const keys = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    seek(time + step);
  };
  const faster = (e: MouseEvent) => {
    e.stopPropagation();
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const bars = file.peaks?.length ? file.peaks : Array.from({ length: PEAK_BARS }, () => 30);
  const done = total ? time / total : 0;
  const cues = file.cues ?? [];
  const saying = playing || time > 0 ? cueAt(cues, time) : -1;
  const words = file.transcript ?? null;

  return (
    <div ref={root} className="voice" data-voice-id={file.id} onClick={(e) => e.stopPropagation()}>
      <div className="voice__player">
        <button type="button" className="voice__play" aria-label={playing ? 'Pause' : `Play ${file.name}`} title={playing ? 'Pause' : 'Play'} disabled={!address || broken} onClick={play}>
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <span
          className="voice__wave"
          role="slider"
          tabIndex={0}
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clipLength(time)} of ${clipLength(total)}`}
          onPointerDown={seekAt}
          onKeyDown={keys}
        >
          {bars.map((p, i) => (
            <span key={i} className={(i + 0.5) / bars.length <= done ? 'is-played' : undefined} style={{ height: `${Math.max(12, p)}%` }} />
          ))}
        </span>
        <span className="voice__time">{broken ? 'Can’t play here' : failed ? 'Not available offline' : playing || time ? clipLength(time) : total ? clipLength(total) : '—'}</span>
        <button type="button" className="voice__speed" title="Playback speed" aria-label={`Playback speed ${speed}×`} onClick={faster}>
          {speed}×
        </button>
        <VolumeButton />
        {address && (
          <audio
            ref={audio}
            src={address}
            // Its length is kept with it, so nothing is fetched (from Google Drive, for one from another device) until it plays.
            preload="none"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              el.playbackRate = speed;
              if (Number.isFinite(el.duration) && el.duration > 0) setLength(el.duration);
            }}
            onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setLength(e.currentTarget.duration)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => {
              setPlaying(true);
              for (const [r, p] of players) if (r !== root.current) p.pause();
            }}
            onPause={() => setPlaying(false)}
            onEnded={(e) => {
              setPlaying(false);
              setTime(0);
              // Back to the start, for one that ends short of the length it gives, which would play on from there.
              e.currentTarget.currentTime = 0;
              if (root.current) playAfter(root.current);
            }}
            onError={() => setBroken(true)}
          />
        )}
      </div>
      {words !== null ? (
        <div className="voice__transcript">
          <p lang={file.language ?? undefined}>
            {words === '' ? (
              <span className="voice__quiet">No words were heard.</span>
            ) : cues.length ? (
              cues.map((cue, i) => (
                <span key={i}>
                  <span className={`voice__cue${i === saying ? ' is-saying' : ''}`} role="button" tabIndex={-1} title={`Play from ${clipLength(cue.start)}`} onClick={() => seek(cue.start, true)}>
                    {cue.text}
                  </span>{' '}
                </span>
              ))
            ) : (
              words
            )}
          </p>
          <span className="voice__actions">
            {words && (
              <button type="button" onClick={() => void writeClipboard(words).then((ok) => toast(ok ? 'Copied the transcript.' : 'The transcript couldn’t be copied here.'))}>
                <Icon name="copy" size={14} /> Copy
              </button>
            )}
            {can && job?.state !== 'working' && (
              <button type="button" onClick={() => void transcribe(file.id, vaultId!, photos)}>
                <Icon name="repeat" size={14} /> Transcribe again
              </button>
            )}
            {job?.state === 'working' && <span className="voice__status">Transcribing…</span>}
            {job?.state === 'failed' && <span className="voice__status">{job.message}</span>}
          </span>
        </div>
      ) : job?.state === 'working' ? (
        <p className="voice__status">Transcribing…</p>
      ) : job?.state === 'failed' ? (
        <p className="voice__status">
          {job.message}{' '}
          {can && (
            <button type="button" className="voice__retry" onClick={() => void transcribe(file.id, vaultId!, photos)}>
              Try again
            </button>
          )}
        </p>
      ) : can ? (
        <button type="button" className="voice__transcribe" onClick={() => void transcribe(file.id, vaultId!, photos)}>
          <Icon name="notes" size={14} /> Transcribe
        </button>
      ) : null}
    </div>
  );
}

/** A recording just made: the sound, when it started, and how long it ran by the clock, in seconds. */
export interface Recording {
  blob: Blob;
  startedAt: number;
  seconds: number;
}

/**
 * The volume all voice messages play at, as Telegram's desktop app has it: pointed at, a slider standing over it; pressed,
 * muted or back. On a touch screen, which can't point, a press shows the slider instead.
 */
function VolumeButton() {
  const { volume, muted } = useVoiceVolume();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const touch = useRef(false);
  const silent = muted || volume === 0;
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current?.contains(e.target as Node) || setOpen(false);
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  const shown = silent ? 0 : Math.round(volume * 100);
  // Above it, unless the title bar (or the window's top) is too near: below then.
  const [below, setBelow] = useState(false);
  const aim = () => {
    const top = box.current?.getBoundingClientRect().top ?? 0;
    const bar = document.querySelector('.page__head')?.getBoundingClientRect().bottom ?? 0;
    setBelow(top - Math.max(0, bar) < 136);
  };
  return (
    <span
      ref={box}
      className={`voice__volume${open ? ' is-open' : ''}${below ? ' is-below' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerEnter={aim}
      onFocus={aim}
    >
      <button
        type="button"
        aria-label={silent ? 'Unmute voice messages' : 'Mute voice messages'}
        title={silent ? 'Unmute' : 'Mute'}
        onPointerDown={(e) => (touch.current = e.pointerType === 'touch')}
        onClick={(e) => {
          e.stopPropagation();
          if (touch.current) setOpen((o) => !o);
          else toggleVoiceMute();
          touch.current = false;
        }}
      >
        <Icon name={silent ? 'mute' : volume < 0.5 ? 'volumeLow' : 'volume'} size={16} />
      </button>
      <span className="voice__volume-pop">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={shown}
          aria-label="Voice message volume"
          aria-valuetext={`${shown}%`}
          onChange={(e) => setVoiceVolume(Number(e.target.value) / 100)}
        />
      </span>
    </span>
  );
}

/** What a browser records in, best first: Opus in WebM (Chrome, Firefox, Edge), else AAC in MP4 (Safari). */
const RECORD_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
const LEVELS = 28;

/**
 * Recording a voice message from the microphone: `start` asks for it and starts, and `view` is the bar that shows
 * while recording, with the time, how loud it is now, Discard and Done. Only Discard throws it away: Done, stopping by
 * itself at `MAX_RECORDING_SECONDS`, or the microphone going (unplugged, or taken by the system) hands what was
 * recorded to `onRecorded`.
 */
export function useVoiceRecorder(onRecorded: (recording: Recording) => void) {
  const toast = useToast();
  const [shown, setShown] = useState<{ seconds: number; levels: number[] } | null>(null);
  const live = useRef<{ recorder: MediaRecorder; keep: boolean } | null>(null);
  // Asking for the microphone, so a second press meanwhile doesn't start a second recording.
  const asking = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(onRecorded);
  latest.current = onRecorded;

  /** Stops it, keeping what was recorded or not. The recorder's stop event does the rest, once its last piece is in. */
  const finish = (keep: boolean) => {
    const now = live.current;
    if (!now) return;
    now.keep = keep;
    if (now.recorder.state !== 'inactive') now.recorder.stop();
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      finish(false);
    };
  }, []);

  const start = async () => {
    if (live.current || asking.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('This browser can’t record sound.');
    let stream: MediaStream;
    asking.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const name = (err as { name?: string }).name;
      return toast(name === 'NotAllowedError' || name === 'SecurityError' ? 'Allow the microphone for this site to record a voice message.' : 'No microphone was found to record with.');
    } finally {
      asking.current = false;
    }
    // Gone while the browser asked: nothing to record into.
    if (!mounted.current) return stream.getTracks().forEach((t) => t.stop());
    const type = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    // How loud it is now, from the microphone itself.
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
    } catch {
      analyser = null;
    }
    const data = new Uint8Array(1024);
    let levels: number[] = Array.from({ length: LEVELS }, () => 0);
    const tick = setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      if (analyser) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        levels = [...levels.slice(1), Math.min(100, Math.round(Math.sqrt(sum / data.length) * 400))];
      }
      setShown({ seconds, levels });
      if (seconds >= MAX_RECORDING_SECONDS) {
        clearInterval(tick);
        finish(true);
      }
    }, 100);
    const stop = () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      void context?.close().catch(() => undefined);
      const was = live.current;
      live.current = null;
      setShown(null);
      if (!was?.keep || !chunks.length) return;
      latest.current({ blob: new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }), startedAt, seconds: (Date.now() - startedAt) / 1000 });
    };
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = stop;
    live.current = { recorder, keep: true };
    setShown({ seconds: 0, levels });
    recorder.start(1000);
  };

  const view = shown
    ? createPortal(
        <div className="voice-recorder" role="group" aria-label="Recording a voice message">
          <span className="voice-recorder__dot" aria-hidden="true" />
          <span className="voice-recorder__time" aria-live="off">
            {clipLength(Math.floor(shown.seconds))}
          </span>
          <span className="voice-recorder__levels" aria-hidden="true">
            {shown.levels.map((l, i) => (
              <span key={i} style={{ height: `${Math.max(8, l)}%` }} />
            ))}
          </span>
          <button type="button" className="icon-btn" aria-label="Discard the recording" title="Discard" onMouseDown={(e) => e.preventDefault()} onClick={() => finish(false)}>
            <Icon name="trash" size={18} />
          </button>
          <button type="button" className="voice-recorder__done" title="Stop and add it" onMouseDown={(e) => e.preventDefault()} onClick={() => finish(true)}>
            <Icon name="stop" size={16} /> Done
          </button>
        </div>,
        document.body,
      )
    : null;
  return { start: () => void start(), recording: !!shown, view };
}
