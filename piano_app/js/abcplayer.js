// ABC 曲谱渲染 + abcjs 合成器播放引擎
const AbcPlayer = {
  tune: null,
  controller: null,
  abc: "",
  // 外部回调（app.js 注入）
  onNoteEvent: null, // (midiPitches) => void
  onEnd: null,

  render(container, abc) {
    this.abc = abc;
    container.innerHTML = "";
    const visual = ABCJS.renderAbc(container, abc, { add_classes: true, responsive: "resize" });
    this.tune = visual && visual[0] ? visual[0] : null;
    if (!this.tune) throw new Error("ABC 解析失败");
    return this.tune;
  },

  async setupSynth(host) {
    if (!this.tune) return false;
    if (!ABCJS.synth || !ABCJS.synth.supportsAudio || !ABCJS.synth.supportsAudio()) return false;
    if (!this.controller) this.controller = new ABCJS.synth.SynthController();
    const self = this;
    const cursorControl = {
      onReady() {},
      onStart() {},
      onFinished() { if (self.onEnd) self.onEnd(); },
      onBeat() {},
      // abcjs 6.4 SynthController 的音符事件回调名是 onEvent（不是 eventCallback）
      onEvent(ev) {
        if (ev && ev.midiPitches && ev.midiPitches.length && self.onNoteEvent) {
          self.onNoteEvent(ev.midiPitches.map((p) => p.pitch));
        }
      },
    };
    this.controller.load(host, cursorControl, {
      displayPlayButton: true,
      displayRestartButton: true,
      displayLoopButton: true,
      displayProgressButton: true,
      // abcjs 6.4 的选项名是 displayWarp（无 Button 后缀）：创建调速输入框供 setWarp 更新（CSS 里隐藏）
      displayWarp: true,
    });
    await this.controller.setTune(this.tune, false);
    return true;
  },

  play() { try { this.controller && this.controller.play(); } catch (e) { /* ignore */ } },
  pause() { try { this.controller && this.controller.pause(); } catch (e) { /* ignore */ } },
  stop() { try { this.controller && this.controller.stop(); } catch (e) { /* ignore */ } },

  // 速度：优先用 setWarp（百分比变速），不支持则返回 false 由调用方重渲染
  setWarp(pct) {
    if (this.controller && typeof this.controller.setWarp === "function") {
      try { this.controller.setWarp(pct); return true; } catch (e) { /* ignore */ }
    }
    return false;
  },
};
