type FeedbackKind = "select" | "confirm" | "flush" | "turn" | "error";
let audioContext: AudioContext | undefined;

export function primeFeedback(muted: boolean): void {
  if (muted || audioContext || typeof AudioContext === "undefined") return;
  audioContext = new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
}

export function feedback(kind: FeedbackKind, muted: boolean): void {
  const vibration: Record<FeedbackKind, number | number[]> = {
    select: 8,
    confirm: 18,
    flush: [12, 20, 12],
    turn: 12,
    error: [20, 30, 20],
  };
  if (navigator.vibrate) navigator.vibrate(vibration[kind]);
  if (muted || !audioContext || audioContext.state !== "running") return;
  const frequencies: Record<FeedbackKind, [number, number]> = {
    select: [520, 680],
    confirm: [430, 760],
    flush: [260, 120],
    turn: [660, 880],
    error: [180, 130],
  };
  const duration = kind === "flush" ? 0.18 : 0.09;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const [from, to] = frequencies[kind];
  oscillator.type = kind === "error" ? "sawtooth" : "sine";
  oscillator.frequency.setValueAtTime(from, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(to, audioContext.currentTime + duration);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.055, audioContext.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration + 0.01);
}
