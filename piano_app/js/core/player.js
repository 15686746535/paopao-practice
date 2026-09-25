// PianoCore.Player —— 序列驱动的统一播放调度器
// 替代"按 cursor 步进推时间"的旧引擎：声音/琴/灯/节拍器都由事件时间轴驱动，
// 光标只作为视觉跟随（XmlPlayer 在 onEvent 里按时间戳推进 OSMD 光标）。
// 前瞻调度：音频用 AudioContext 时间精确排程，BLE 发送允许 30ms 抖动。
(function () {
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  const A = (G.PianoCore = G.PianoCore || {});

  class Player {
    /**
     * @param seq {events,totalTime,bpm}
     * @param h  { sound:{noteOn(midi,dur,when), noteOff(midi), click(when,accent)},
     *              piano:{noteOn(midi),noteOff(midi)}, lights:{on(midi),off(midi),clear()},
     *              onEvent(ev,idx), onBeat(beatIndex,accent), onEnd(finished), onLoop() }
     */
    constructor(seq, h = {}) {
      this.seq = seq;
      this.h = h;
      this.speed = 1;
      this.loop = false;
      this.metronome = false;
      this.bpm = seq.bpm || 100;
      this.playing = false;
      this.paused = false;
      this._timer = null;
      this._t0 = 0;
      this._pausedAt = 0;
      this._evIdx = 0;      // 下一个待触发事件
      this._offList = [];   // [{at, midi}] 音符关闭时间表
      this._beatIdx = 0;
      this._beats = [];     // 节拍器时间点（曲谱秒）
    }

    _posScore() { return ((performance.now() - this._t0) / 1000) * this.speed; }

    start(opts = {}) {
      if (this.playing) return;
      this.speed = opts.speed || this.speed || 1;
      this.loop = !!opts.loop;
      this.metronome = !!opts.metronome;
      this.playing = true;
      this.paused = false;
      if (!this._evIdx && !this._offList.length) {
        // 全新开始：构建节拍网格
        const beatSec = 60 / this.bpm;
        const n = Math.ceil(this.seq.totalTime / beatSec);
        this._beats = [];
        for (let i = 0; i < n; i++) this._beats.push(i * beatSec);
        this._beatIdx = 0;
      }
      this._t0 = performance.now() - (this._pausedAt || 0);
      this._timer = setInterval(() => this._tick(), 30);
      this._tick();
    }

    pause() {
      if (!this.playing || this.paused) return;
      this._pausedAt = performance.now() - this._t0;
      this.paused = true;
    }

    resume() {
      if (!this.playing || !this.paused) return;
      this.paused = false;
      this._t0 = performance.now() - this._pausedAt;
    }

    stop() {
      this.playing = false;
      this.paused = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this._evIdx = 0;
      this._offList = [];
      this._beatIdx = 0;
      this._pausedAt = 0;
      if (this.h.lights && this.h.lights.clear) this.h.lights.clear();
      if (this.h.onEnd) this.h.onEnd(false);
    }

    _tick() {
      if (!this.playing || this.paused) return;
      const pos = this._posScore();
      const look = 0.15 * this.speed; // 音频前瞻（真实秒 -> 曲谱秒）

      // ---- 事件触发（音频精确排程 + 琴/灯即时发送） ----
      while (this._evIdx < this.seq.events.length &&
             this.seq.events[this._evIdx].t <= pos + look) {
        const ev = this.seq.events[this._evIdx];
        const whenSec = Math.max(0, (ev.t - pos) / this.speed); // 距今真实秒
        const hasPiano = this.h.piano;
        const useSound = this.h.sound;
        for (const n of ev.notes) {
          const durReal = Math.max(0.08, ev.dur / this.speed);
          if (useSound && useSound.noteOn) {
            const ctx = G.AppSynth && AppSynth.ctx;
            const when = ctx ? ctx.currentTime + whenSec : undefined;
            useSound.noteOn(n.midi, durReal * 0.95, when);
          }
          if (hasPiano && hasPiano.noteOn) {
            // 即时发送（30ms 抖动可接受）；排到接近触发时刻再发以减小偏差
            if (whenSec < 0.04) hasPiano.noteOn(n.midi, n.vel || 100);
            else {
              setTimeout(() => {
                if (this.playing && !this.paused) hasPiano.noteOn(n.midi, n.vel || 100);
              }, whenSec * 1000);
            }
          }
          this._offList.push({ at: ev.t + ev.dur, midi: n.midi, piano: !!hasPiano });
        }
        if (this.h.lights && this.h.lights.on) {
          // 引导灯：提前 0.4s 亮起
          const lead = Math.max(0, (ev.t - 0.4 * this.speed - pos) / this.speed);
          const evIdx = this._evIdx;
          const show = () => {
            if (!this.playing || this.paused) return;
            for (const n of ev.notes) this.h.lights.on(n.midi);
          };
          if (lead < 0.04) show();
          else setTimeout(show, lead * 1000);
          for (const n of ev.notes) this._offList.push({ at: ev.t + ev.dur, midi: n.midi, light: true });
        }
        if (this.h.onEvent) this.h.onEvent(ev, this._evIdx);
        this._evIdx++;
      }

      // ---- 音符/灯关闭 ----
      while (this._offList.length && this._offList[0].at <= pos) {
        const o = this._offList.shift();
        if (o.light && this.h.lights && this.h.lights.off) this.h.lights.off(o.midi);
        else {
          if (this.h.sound && this.h.sound.noteOff) this.h.sound.noteOff(o.midi);
          if (o.piano && this.h.piano && this.h.piano.noteOff) this.h.piano.noteOff(o.midi);
        }
      }
      this._offList.sort((a, b) => a.at - b.at);

      // ---- 节拍器 ----
      if (this.metronome) {
        while (this._beatIdx < this._beats.length && this._beats[this._beatIdx] <= pos + look) {
          const b = this._beats[this._beatIdx];
          const delay = Math.max(0, (b - pos) / this.speed);
          const accent = this._beatIdx % 4 === 0;
          const ctx = G.AppSynth && AppSynth.ctx;
          const when = ctx ? ctx.currentTime + delay : undefined;
          const fire = () => { if (this.playing && !this.paused && this.h.sound && this.h.sound.click) this.h.sound.click(when, accent); };
          if (delay < 0.04) fire(); else setTimeout(fire, delay * 1000);
          if (this.h.onBeat) this.h.onBeat(this._beatIdx, accent);
          this._beatIdx++;
        }
      }

      // ---- 结束 / 循环 ----
      if (pos >= this.seq.totalTime + 0.3 * this.speed && !this._offList.length) {
        if (this.loop) {
          this._evIdx = 0;
          this._beatIdx = 0;
          this._offList = [];
          if (this.h.lights && this.h.lights.clear) this.h.lights.clear();
          if (this.h.onLoop) this.h.onLoop();
          this._t0 = performance.now();
        } else {
          const h = this.h;
          this.playing = false;
          clearInterval(this._timer);
          this._timer = null;
          this._evIdx = 0;
          this._beatIdx = 0;
          if (h.lights && h.lights.clear) h.lights.clear();
          if (h.onEnd) h.onEnd(true);
        }
      }
    }
  }

  A.Player = Player;
})();
