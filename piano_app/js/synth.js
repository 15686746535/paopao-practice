// Web Audio 合成：练习用钢琴音色 + 节拍器
const AppSynth = {
  ctx: null,
  master: null,

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },

  // 简易钢琴音色：三角波 + 八度泛音 + 指数衰减包络
  playNote(midi, durationSec, when) {
    const ctx = this.ensure();
    const t = when || ctx.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(durationSec, 0.18));
    g.connect(this.master);

    const o1 = ctx.createOscillator();
    o1.type = "triangle";
    o1.frequency.value = freq;
    o1.connect(g);
    o1.start(t);
    o1.stop(t + Math.max(durationSec, 0.2) + 0.05);

    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    g2.connect(g);
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 2;
    o2.connect(g2);
    o2.start(t);
    o2.stop(t + Math.max(durationSec, 0.2) * 0.6 + 0.05);
  },

  click(when, accent) {
    const ctx = this.ensure();
    const t = when || ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = accent ? 1600 : 1050;
    g.gain.setValueAtTime(accent ? 0.22 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  },

  stopAll() {
    // 快速淡出，避免残留音
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try { this.master.gain.cancelScheduledValues(now); } catch (e) { /* ignore */ }
  },
};
