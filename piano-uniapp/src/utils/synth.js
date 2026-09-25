// Web Audio 简易钢琴音色（仅 H5 平台启用；小程序无 WebAudio，练琴靠琴本身发声）
let ctx = null;
let master = null;

export function ensure() {
  if (typeof window === "undefined" || !(window.AudioContext || window.webkitAudioContext)) return null;
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function playNote(midi, durationSec, when) {
  const c = ensure();
  if (!c) return;
  const t = when || c.currentTime;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(durationSec, 0.18));
  g.connect(master);
  const o1 = c.createOscillator();
  o1.type = "triangle";
  o1.frequency.value = freq;
  o1.connect(g);
  o1.start(t);
  o1.stop(t + Math.max(durationSec, 0.2) + 0.05);
  const g2 = c.createGain();
  g2.gain.value = 0.35;
  g2.connect(g);
  const o2 = c.createOscillator();
  o2.type = "sine";
  o2.frequency.value = freq * 2;
  o2.connect(g2);
  o2.start(t);
  o2.stop(t + Math.max(durationSec, 0.2) * 0.6 + 0.05);
}

export function click(when, accent) {
  const c = ensure();
  if (!c) return;
  const t = when || c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "square";
  o.frequency.value = accent ? 1600 : 1050;
  g.gain.setValueAtTime(accent ? 0.22 : 0.12, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.06);
}

export const AppSynth = { ensure, playNote, click };
