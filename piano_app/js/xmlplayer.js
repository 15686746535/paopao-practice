// MusicXML 渲染（OSMD）+ 序列驱动播放（PianoCore.Player）
// 音频/琴/灯/节拍器全部由音符序列时间轴驱动；OSMD 光标只做视觉跟随。
const XmlPlayer = {
  osmd: null,
  playing: false,
  paused: false,
  bpm: 100,
  _xmlText: null,
  _seq: null,
  _player: null,
  // 播放选项（app.js 注入）
  loop: true,
  metronome: false,
  sendPiano: false,
  lights: false,
  onEnd: null,

  async load(xmlText, container) {
    if (!this.osmd || this.osmd.container.id !== container.id) {
      container.innerHTML = "";
      this.osmd = new OpenSheetMusicDisplay(container, { autoResize: true, drawTitle: true });
    }
    await this.osmd.load(xmlText);
    this.osmd.render();
    try { this.osmd.cursor.show(); this.osmd.cursor.reset(); } catch (e) { /* ignore */ }

    this._xmlText = xmlText;
    this._seq = null; // 播放时构建（避免加载卡顿），也可以在这里预热
    try { this._seq = PianoCore.Sequence.fromMusicXML(xmlText); } catch (e) { this._seq = null; }

    let bpm = 100;
    if (this._seq && this._seq.bpm) bpm = this._seq.bpm;
    else {
      try {
        const sheet = this.osmd.Sheet;
        bpm = (sheet && (sheet.DefaultStartTempoInBpm || sheet.tempoInBpm || sheet.userStartTempoInBpm)) || 100;
      } catch (e) { /* ignore */ }
    }
    this.bpm = bpm > 20 && bpm < 300 ? Math.round(bpm) : 100;
    return this.bpm;
  },

  resetCursor() {
    try { this.osmd.cursor.reset(); } catch (e) { /* ignore */ }
    this._clearLights();
  },

  stop() {
    if (this._player) this._player.stop();
    this._player = null;
    this.playing = false;
    this.paused = false;
    this._clearLights();
    if (this.onEnd) this.onEnd();
  },

  pause() { if (this._player) this._player.pause(); this.paused = true; },
  resume() { if (this._player) this._player.resume(); this.paused = false; },

  async play() {
    if (this.playing && !this.paused) return;
    if (this.playing && this.paused) { this.resume(); return; }
    if (!this._seq) {
      if (!this._xmlText) throw new Error("尚未加载曲谱");
      this._seq = PianoCore.Sequence.fromMusicXML(this._xmlText);
    }

    const self = this;
    AppSynth.ensure();

    // 光标视觉跟随：把 OSMD 光标推进到事件对应的时间戳
    const cursorTo = (tSec) => {
      try {
        const cur = this.osmd.cursor;
        if (!cur || !cur.iterator || cur.iterator.endReached) return;
        const target = (tSec * this.bpm) / 240; // 秒 -> 全音符单位
        const curVal = () => {
          const f = cur.iterator.currentTimeTimestamp;
          return f && (f.RealValue !== undefined ? f.RealValue : f.realValue);
        };
        let guard = 0;
        while (!cur.iterator.endReached && curVal() !== undefined &&
               curVal() < target - 1e-6 && guard++ < 5000) {
          cur.next();
        }
        // 滚动跟随
        const now = performance.now();
        if (now - (self._lastScroll || 0) > 200 && cur.cursorElement) {
          self._lastScroll = now;
          const el = cur.cursorElement;
          const wrap = this.osmd.container.parentElement;
          if (el && wrap) {
            const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
            if (r.top < w.top + 40 || r.bottom > w.bottom - 40) el.scrollIntoView({ block: "center", behavior: "auto" });
          }
        }
      } catch (e) { /* 光标异常不影响发声 */ }
    };

    const usePianoNow = () => this.sendPiano && PianoBLE.connected;

    this._player = new PianoCore.Player(this._seq, {
      sound: {
        noteOn: (midi, dur, when) => { if (!usePianoNow()) AppSynth.playNote(midi, dur, when); },
        noteOff: () => {},
        click: (when, accent) => AppSynth.click(when, accent),
      },
      piano: {
        noteOn: (midi, vel) => { if (usePianoNow()) PianoBLE.noteOn(midi, vel || 100).catch(() => {}); },
        noteOff: (midi) => { if (PianoBLE.connected) PianoBLE.noteOff(midi).catch(() => {}); },
      },
      lights: {
        on: (midi) => { if (this.lights && PianoBLE.connected) PianoBLE.lightOn(midi).catch(() => {}); },
        off: (midi) => { if (PianoBLE.connected) PianoBLE.lightOff(midi).catch(() => {}); },
        clear: () => this._clearLights(),
      },
      onEvent: (ev) => cursorTo(ev.t),
      onLoop: () => {
        try { this.osmd.cursor.reset(); } catch (e) { /* ignore */ }
      },
      onEnd: () => {
        this.playing = false;
        this._player = null;
        this._clearLights();
        if (this.onEnd) this.onEnd();
      },
    });

    this._player.speed = this.speedOf();
    this._player.loop = this.loop;
    this._player.metronome = this.metronome;
    this.playing = true;
    this.paused = false;
    this._player.start({ speed: this.speedOf(), loop: this.loop, metronome: this.metronome });
  },

  speedOf() {
    return this._speed || 1;
  },

  _clearLights() {
    if (!PianoBLE.connected) return;
    PianoBLE.lightsClear().catch(() => {});
  },
};
