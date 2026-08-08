import { get, writable } from 'svelte/store';

/** Notification sound on/off (per device). Defaults to on. */
export const soundEnabled = writable(localStorage.getItem('df-sound') !== 'false');
soundEnabled.subscribe((v) => localStorage.setItem('df-sound', String(v)));

/**
 * Which sound to play — stored server-side in the settings DB
 * (AppSettings.notificationSound) and initialized from /api/status at startup.
 */
export const notificationSound = writable<string>('knock');

export interface SoundOption {
  id: string;
  label: string;
}

export const soundOptions: SoundOption[] = [
  { id: 'knock', label: 'Knock (triple)' },
  { id: 'knock-double', label: 'Knock (double)' },
  { id: 'ding', label: 'Ding' },
  { id: 'chime', label: 'Chime' },
  { id: 'pop', label: 'Pop' },
];

let ctx: AudioContext | null = null;

/**
 * Play the user's selected notification sound. All sounds are synthesized
 * with the Web Audio API, so there are no audio assets to load.
 * Browsers block audio before the first user gesture; in that case this fails
 * silently and sounds start working after the user interacts with the page.
 */
export function playNotificationSound(soundId?: string, force = false): void {
  if (!force && localStorage.getItem('df-sound') === 'false') return;
  void playNow(soundId);
}

/**
 * Browsers auto-suspend a page's AudioContext when its tab is backgrounded,
 * to save power. That's separate from the autoplay gesture gate — once a
 * context has been unlocked by a real gesture, .resume() works from a
 * background tab too, but only if we actually AWAIT it. The previous
 * fire-and-forget `void ctx.resume()` scheduled notes against
 * ctx.currentTime while the clock was still frozen (suspended), so a
 * notification arriving in a backgrounded tab could be silently dropped —
 * exactly the reported symptom (Files updates fine over the WebSocket,
 * which isn't affected by audio suspension, but no sound plays).
 */
async function playNow(soundId?: string): Promise<void> {
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const t0 = ctx.currentTime + 0.02;
    switch (soundId ?? get(notificationSound)) {
      case 'knock-double':
        knock(ctx, t0, 240);
        knock(ctx, t0 + 0.17, 185);
        break;
      case 'ding':
        ding(ctx, t0);
        break;
      case 'chime':
        chime(ctx, t0);
        break;
      case 'pop':
        pop(ctx, t0);
        break;
      case 'knock':
      default:
        // Rising "knock-knock-knock": first high, next two even higher.
        knock(ctx, t0, 240);
        knock(ctx, t0 + 0.17, 330);
        knock(ctx, t0 + 0.34, 330);
        break;
    }
  } catch {
    /* no audio available */
  }
}

// ---------- instruments ----------

/**
 * One crisp "tok" — a short woody knuckle-rap rather than a bass thump.
 * Slack's knock reads as mid/high-frequency percussion with almost no
 * sub-bass, so the tonal body only dips to ~150 Hz (not deep bass) and the
 * noise burst is bandpassed to a woody click instead of low-passed to a thud.
 */
function knock(ctx: AudioContext, t: number, startFreq: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(startFreq, t);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.05);
  gain.gain.setValueAtTime(0.32, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);

  const dur = 0.035;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1500;
  filter.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(t);
  noise.stop(t + dur);
}

/** A single bell-like tone with a soft overtone, ringing out. */
function ding(ctx: AudioContext, t: number): void {
  tone(ctx, t, 880, 0.3, 0.7, 'sine');
  tone(ctx, t, 1760, 0.08, 0.4, 'sine');
}

/** Two ascending notes (C5 → G5). */
function chime(ctx: AudioContext, t: number): void {
  tone(ctx, t, 523.25, 0.25, 0.45, 'sine');
  tone(ctx, t + 0.18, 783.99, 0.25, 0.6, 'sine');
}

/** A short bubbly blip with a quick upward sweep. */
function pop(ctx: AudioContext, t: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(280, t);
  osc.frequency.exponentialRampToValueAtTime(720, t + 0.07);
  gain.gain.setValueAtTime(0.4, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.13);
}

function tone(
  ctx: AudioContext,
  t: number,
  freq: number,
  volume: number,
  duration: number,
  type: OscillatorType
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.01);
}
