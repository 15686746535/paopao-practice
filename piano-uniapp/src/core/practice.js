// PianoCore.Practice —— 跟弹判定 / 等待模式 / 练习评分
// 纯状态机，不依赖 DOM。外部注入:
//   ble    : { lightOn(note,color), lightOff(note), lightsClear() }   可为 null
//   sound  : { playNote(midi, durSec) }                               可为 null
// 回调: onProgress(idx,total,current), onWrong(note), onAdvance(ev,idx), onComplete(stats), onState(stateText)
(function () {
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  const A = (G.PianoCore = G.PianoCore || {});

  // 蓝色=引导灯, 红色=错音提示（MLNE 协议颜色字节）
  const CLR_BLUE = 0x11;
  const CLR_RED = 0x01;

  class Practice {
    /**
     * @param seq   PianoCore.Sequence 输出 { events:[{t,dur,notes:[{midi,hand}]}], totalTime, bpm }
     * @param opts  { mode:'wait'|'follow', hands:'both'|'1'|'2', speed:1,
     *                  ble, sound, onProgress, onWrong, onAdvance, onComplete, onState }
     */
    constructor(seq, opts = {}) {
      this.mode = opts.mode === "follow" ? "follow" : "wait";
      this.hands = opts.hands || "both";
      this.speed = Math.min(2, Math.max(0.4, opts.speed || 1));
      this.ble = opts.ble && opts.ble.connected ? opts.ble : null;
      this.sound = opts.sound || null;
      this.onProgress = opts.onProgress || (() => {});
      this.onWrong = opts.onWrong || (() => {});
      this.onAdvance = opts.onAdvance || (() => {});
      this.onComplete = opts.onComplete || (() => {});
      this.onState = opts.onState || (() => {});

      // 声部过滤后的事件表（跳过所选声部没有音符的事件）
      const want = (h) => this.hands === "both" || String(h) === this.hands;
      this.events = [];
      for (const ev of seq.events) {
        const notes = ev.notes.filter((n) => want(n.hand));
        if (!notes.length) continue;
        this.events.push({
          t: ev.t,
          dur: ev.dur,
          notes, // [{midi, hand}]
          other: ev.notes.filter((n) => !want(n.hand)).map((n) => n.midi), // 声部过滤掉、弹了不算错的音
          hits: new Set(),
          state: "pending", // pending | open | hit | partial | missed
          lit: new Set(),
        });
      }
      this.total = this.events.length;
      this.idx = 0;
      this._triggeredCount = 0; // follow 模式已触发发声的事件数
      this.running = false;
      this.finished = false;
      this._timer = null;
      this._t0 = 0; // performance.now 起点
      this._pausedAt = 0;
      this._wrongFlash = {}; // note -> timeout
      this._stats = {
        total: this.total,
        hits: 0,
        partial: 0,
        missed: 0,
        wrong: 0,
        latencies: [],
        wrongNotes: {}, // midi -> count
        detail: [], // 每事件简报
      };
    }

    // ---------- 生命周期 ----------
    start() {
      if (this.finished || this.running) return;
      this.running = true;
      if (this.mode === "follow") {
        this._t0 = performance.now() - (this._pausedAt || 0);
        this._timer = setInterval(() => this._tick(), 30);
        this._tick(); // 立即触发 t=0 的事件，不等第一个 30ms
        this.onState("跟弹中：琴声起，跟着弹");
      } else {
        this.onState("等待模式：琴键亮哪个就弹哪个");
        this._openCurrent();
      }
      this._report();
    }

    stop() {
      this.running = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this._clearFlashes();
      if (this.ble) this.ble.lightsClear();
      if (!this.finished) this.finish(true);
    }

    pause() {
      if (!this.running || this.mode !== "follow") return;
      this._pausedAt = performance.now() - this._t0;
      this.running = false;
      clearInterval(this._timer);
      this._timer = null;
      this.onState("已暂停");
    }

    resume() {
      if (this.running || this.finished || this.mode !== "follow") return;
      this.start();
    }

    skip() {
      const fe = this.events[this.idx];
      if (!fe) return;
      const missed = fe.notes.filter((n) => !fe.hits.has(n.midi)).map((n) => n.midi);
      this._stats.missed += missed.length;
      this._bumpDetail(fe, fe.hits, missed);
      fe.state = fe.hits.size ? "partial" : "missed";
      this._advance(true);
    }

    // ---------- 钢琴输入 ----------
    /** @returns 'hit' | 'wrong' | 'ignored' */
    press(midi, vel = 100) {
      if (!this.running || this.finished) return "ignored";
      return this.mode === "wait" ? this._pressWait(midi) : this._pressFollow(midi);
    }

    release(midi) {
      // 等待/跟弹都不依赖抬起（初学按住不放不惩罚）
    }

    // ---------- 等待模式 ----------
    _openCurrent() {
      const fe = this.events[this.idx];
      if (!fe) return;
      fe.state = "open";
      if (this.ble) {
        for (const n of fe.notes) {
          this.ble.lightOn(n.midi, CLR_BLUE);
          fe.lit.add(n.midi);
        }
      }
      this.onProgress(this.idx, this.total, fe);
    }

    _pressWait(midi) {
      const fe = this.events[this.idx];
      if (!fe) return "ignored";
      const note = fe.notes.find((n) => n.midi === midi);
      if (note) {
        if (fe.hits.has(midi)) return "ignored"; // 和弦里同键重复按
        fe.hits.add(midi);
        if (this.ble && fe.lit.has(midi)) {
          this.ble.lightOff(midi);
          fe.lit.delete(midi);
        }
        this._statHit(fe);
        if (fe.hits.size >= fe.notes.length) this._advance(false);
        return "hit";
      }
      // 是被声部过滤掉的音（另一只手自由伴奏）→ 静默忽略
      if (fe.other && fe.other.indexOf(midi) >= 0) return "ignored";
      this._statWrong(midi);
      return "wrong";
    }

    _advance(skipped) {
      const fe = this.events[this.idx];
      if (fe && this.ble) for (const m of fe.lit) this.ble.lightOff(m);
      this.onAdvance(fe, this.idx);
      this.idx++;
      if (this.idx >= this.total) {
        this.finish(false);
        return;
      }
      if (this.mode === "wait") this._openCurrent();
      this._report();
    }

    // ---------- 跟弹模式 ----------
    _posScore() {
      // 当前播放位置（按曲谱自身时间轴的秒）
      return ((performance.now() - this._t0) / 1000) * this.speed;
    }

    _tick() {
      if (!this.running) return;
      const pos = this._posScore();
      const grace = this._grace();

      // 1) 触发发声 + 引导灯
      while (this.idx < this.total && this.events[this.idx].t <= pos) {
        const fe = this.events[this.idx];
        fe.state = fe.hits.size ? "partial" : "open";
        if (this.sound) {
          for (const n of fe.notes) this.sound.playNote(n.midi, Math.max(0.12, fe.dur * 0.95));
        }
        if (this.ble) {
          for (const n of fe.notes) {
            this.ble.lightOn(n.midi, CLR_BLUE);
            fe.lit.add(n.midi);
          }
        }
        this.onProgress(this.idx, this.total, fe);
        this.idx++;
        this._triggeredCount = this.idx;
      }

      // 2) 超窗未弹 → 记漏
      let allResolved = true;
      for (let i = 0; i < this._triggeredCount; i++) {
        const fe = this.events[i];
        if (fe.state === "hit" || fe.state === "partial" || fe.state === "missed") {
          if (fe.state !== "hit" && fe.state !== "missed") allResolved = false;
          continue;
        }
        if (pos > fe.t + grace + Math.min(fe.dur, 2)) {
          const missedNotes = fe.notes.filter((n) => !fe.hits.has(n.midi)).map((n) => n.midi);
          this._stats.missed += missedNotes.length;
          this._bumpDetail(fe, fe.hits, missedNotes);
          if (this.ble) for (const m of fe.lit) this.ble.lightOff(m);
          fe.state = fe.hits.size ? "partial" : "missed";
        }
        if (fe.state !== "hit" && fe.state !== "missed") allResolved = false;
      }
      if (this._triggeredCount < this.total) allResolved = false;
      if (this._triggeredCount >= this.total && allResolved) {
        this.finish(false);
        return;
      }
      this._report();
    }

    _pressFollow(midi) {
      const pos = this._posScore();
      const grace = this._grace();
      for (let i = 0; i < this._triggeredCount + 1 && i < this.total; i++) {
        const fe = this.events[i];
        if (fe.state === "hit" || fe.state === "missed") continue;
        if (fe.t - pos > grace) break; // 还没到窗口
        if (pos - fe.t > grace + Math.min(fe.dur, 2)) continue; // 已过窗
        const note = fe.notes.find((n) => n.midi === midi);
        if (note && !fe.hits.has(midi)) {
          fe.hits.add(midi);
          this._stats.latencies.push(Math.max(0, (pos - fe.t) * 1000 / this.speed));
          if (this.ble && fe.lit.has(midi)) {
            this.ble.lightOff(midi);
            fe.lit.delete(midi);
          }
          this._statHit(fe);
          return "hit";
        }
      }
      this._statWrong(midi);
      return "wrong";
    }

    _grace() {
      return 0.7 / this.speed; // 允许的按压时间窗（曲谱秒）
    }

    // ---------- 统计 ----------
    _statHit(fe) {
      if (fe.hits.size >= fe.notes.length) fe.state = "hit";
      else fe.state = "partial";
    }

    _bumpDetail(fe, hitSet, missedNotes) {
      if (this._stats.detail.length < 400) {
        this._stats.detail.push({
          t: Math.round(fe.t * 10) / 10,
          notes: fe.notes.map((n) => n.midi),
          hit: Array.from(hitSet || []),
          missed: missedNotes || [],
        });
      }
    }

    _statWrong(midi) {
      this._stats.wrong++;
      this._stats.wrongNotes[midi] = (this._stats.wrongNotes[midi] || 0) + 1;
      if (this.ble) {
        this.ble.lightOn(midi, CLR_RED);
        clearTimeout(this._wrongFlash[midi]);
        this._wrongFlash[midi] = setTimeout(() => {
          this.ble && this.ble.lightOff(midi);
        }, 260);
      }
      this.onWrong(midi);
    }

    _clearFlashes() {
      for (const k of Object.keys(this._wrongFlash)) clearTimeout(this._wrongFlash[k]);
      this._wrongFlash = {};
    }

    _report() {
      // 供 UI 轮询/回调
    }

    finish(aborted) {
      if (this.finished) return;
      this.finished = true;
      this.running = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this._clearFlashes();
      if (this.ble) this.ble.lightsClear();
      // 收尾：未解决的事件按剩余音记漏（partial 保持 partial）
      for (let i = 0; i < this.total; i++) {
        const fe = this.events[i];
        if (fe.state === "hit" || fe.state === "missed" || fe.state === "partial") continue;
        const missed = fe.notes.filter((n) => !fe.hits.has(n.midi)).map((n) => n.midi);
        this._stats.missed += missed.length;
        this._bumpDetail(fe, fe.hits, missed);
        fe.state = missed.length && fe.hits.size ? "partial" : "missed";
      }
      const hitEvents = this.events.filter((e) => e.state === "hit").length;
      const partialEvents = this.events.filter((e) => e.state === "partial").length;
      this._stats.hits = hitEvents;
      this._stats.partial = partialEvents;
      this._stats.score = Math.round(
        ((hitEvents + partialEvents * 0.5) / Math.max(1, this.total)) * 100
      );
      const lats = this._stats.latencies;
      this._stats.avgLatency = lats.length
        ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length)
        : null;
      this.onComplete(this._stats, aborted);
    }

    stats() { return this._stats; }
  }

  A.Practice = Practice;
})();
