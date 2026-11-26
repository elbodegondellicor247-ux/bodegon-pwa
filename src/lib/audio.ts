let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioCtx) return sharedAudioCtx;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  sharedAudioCtx = new AudioCtx();
  return sharedAudioCtx;
}

/**
 * Unlocks / resumes browser Web Audio on user interaction so alerts can play later
 * when Firestore onSnapshot delivers a new order or confirmation.
 */
export function unlockAudioContext(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    // Silent 1-frame buffer kick for Safari/iOS WebKit unlock
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.02);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loud persistent dual-tone siren pulse for /admin when Pending orders exist.
 */
export function playAdminUrgentAlarm(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;

    const pulses: { start: number; freq: number; dur: number }[] = [
      { start: 0, freq: 880, dur: 0.22 },
      { start: 0.24, freq: 1174.66, dur: 0.22 },
      { start: 0.5, freq: 880, dur: 0.22 },
      { start: 0.74, freq: 1174.66, dur: 0.28 },
    ];

    pulses.forEach(({ start, freq, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.linearRampToValueAtTime(0.24, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    });
  } catch {
    // Ignore audio context block before user gesture
  }
}

/**
 * Pleasant ascending confirmation chime for the customer when /admin confirms payment.
 */
export function playCustomerConfirmedChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];

    notes.forEach((freq, idx) => {
      const start = idx * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.linearRampToValueAtTime(0.14, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.3);
    });
  } catch {
    // Ignore audio context block before user gesture
  }
}
