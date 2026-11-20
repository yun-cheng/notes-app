import { peaksOf, VOICE_RATE } from '../domain/voice';

/** Whether a file picked, pasted or dropped is a sound: by its type, or by its name when the browser gives none. */
export const isAudioFile = (f: File) => f.type.startsWith('audio/') || (!f.type && /\.(m4a|mp3|wav|ogg|oga|opus|aac|flac)$/i.test(f.name));

/**
 * A sound as the model hears it: one channel at 16 kHz, decoded and resampled by the browser, from whatever it
 * recorded or can play. Throws for one it can't read.
 */
export async function decodeVoice(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const sound = await new Offline(1, 1, VOICE_RATE).decodeAudioData(bytes);
  if (sound.numberOfChannels === 1) return sound.getChannelData(0);
  const mixed = new Float32Array(sound.length);
  for (let c = 0; c < sound.numberOfChannels; c++) {
    const channel = sound.getChannelData(c);
    for (let i = 0; i < mixed.length; i++) mixed[i] += channel[i] / sound.numberOfChannels;
  }
  return mixed;
}

/**
 * What a sound is, read as it's added: its length, how loud it is along it, and the sound as decoded, to transcribe
 * without decoding it again. Nothing known of one this browser can't read.
 */
export async function probeAudio(blob: Blob): Promise<{ duration: number | null; peaks: number[]; samples: Float32Array | null }> {
  try {
    const samples = await decodeVoice(blob);
    return { duration: samples.length ? Math.round((samples.length / VOICE_RATE) * 1000) / 1000 : null, peaks: peaksOf(samples), samples };
  } catch {
    return { duration: null, peaks: [], samples: null };
  }
}
