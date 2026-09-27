<template>
  <view class="page">
    <view class="card">
      <view class="title">《{{ score ? score.name : "…" }}》</view>
      <view class="row">
        <button class="btn" size="mini" @click="toggleBle">{{ bleOn ? "⛔ 断开" : "🔗 连接钢琴" }}</button>
        <text class="badge" :class="bleOn ? 'on' : 'off'">{{ bleOn ? "已连接" : "未连接" }}</text>
        <button v-if="bleOn" class="btn" size="mini" @click="testTone">🔔 试音</button>
        <text v-if="bleOn" class="badge" :class="rxPackets ? 'on' : 'off'">琴→App {{ rxPackets }} 包</text>
      </view>
      <view v-if="logs.length" class="log">
        <view v-for="(l, i) in logs" :key="i">{{ l }}</view>
      </view>
    </view>

    <view class="card">
      <view class="row">
        <view class="ctl">
          <text class="lbl">模式</text>
          <picker :range="modeNames" :value="modeIdx" @change="modeIdx = $event.detail.value">
            <view class="picker">{{ modeNames[modeIdx] }}</view>
          </picker>
        </view>
        <view class="ctl">
          <text class="lbl">声部</text>
          <picker :range="handNames" :value="handIdx" @change="handIdx = $event.detail.value">
            <view class="picker">{{ handNames[handIdx] }}</view>
          </picker>
        </view>
      </view>
      <view class="row">
        <text class="lbl">速度 {{ speedPct }}%</text>
        <slider class="slider" :value="speedPct" :min="50" :max="150" :step="5" activeColor="#5b6cff" @change="speedPct = $event.detail.value" />
      </view>
      <button class="btn btn-primary" :disabled="!!practice" @click="start">🎯 开始跟弹练习</button>
    </view>

    <view v-if="practice" class="card status">
      <view class="state">{{ stateText }}</view>
      <view v-if="modeVal === 'wait' && nextNotes" class="next">▶ {{ nextNotes }}</view>
      <view class="count">{{ progress }} · ✔{{ stats.hits }} ◐{{ stats.partial }} ✘错按{{ stats.wrong }}</view>
      <view class="row">
        <button class="btn" size="mini" @click="skip">⏭ 跳过</button>
        <button class="btn btn-danger" size="mini" @click="end">⏹ 结束练习</button>
      </view>
    </view>

    <view v-if="result" class="overlay">
      <view class="modal">
        <view class="mtitle">练习结果</view>
        <view class="mscore">{{ result.score }}</view>
        <view class="mrow">{{ result.summary }}</view>
        <view v-if="result.wrongNotes" class="mwrong">常错键：{{ result.wrongNotes }}</view>
        <view class="row center">
          <button class="btn btn-primary" size="mini" @click="again">🔄 再练一次</button>
          <button class="btn" size="mini" @click="closeResult">关闭</button>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="muted">
        等待模式：琴键亮蓝灯弹哪里，弹对熄灭进下一组；弹错闪红灯。
        跟弹评分：跟着播放一起弹，练完给正确率与反应延迟。
        声部筛选后，另一只手自由伴奏不计错。
      </view>
    </view>
  </view>
</template>

<script>
import { PianoBLE } from "../../utils/ble.js";
import { allScores } from "../../utils/store.js";
import { getSettings } from "../../utils/settings.js";
// 核心引擎（IIFE 副作用引入，挂到 globalThis.PianoCore）
import "../../core/sequence.js";
import "../../core/practice.js";
import "../../core/records.js";
import "../../core/player.js";
// #ifdef H5
import { AppSynth } from "../../utils/synth.js";
import "../../core/mxl.js";
// #endif

const G = globalThis;
const PC = G.PianoCore;
const HANDS = ["双手", "右手", "左手"];
const HANDS_VAL = ["both", "1", "2"];
const MODES = ["等待模式（亮灯跟弹）", "跟弹评分（同步播放）"];
const MODES_VAL = ["wait", "follow"];

export default {
  data() {
    return {
      score: null,
      seq: null,
      bleOn: PianoBLE.connected,
      logs: [],
      modeIdx: 0,
      handIdx: 0,
      speedPct: 100,
      modeNames: MODES,
      handNames: HANDS,
      practice: null,
      stateText: "",
      nextNotes: "",
      progress: "",
      rxPackets: 0,
      stats: { hits: 0, partial: 0, wrong: 0 },
      result: null,
    };
  },
  computed: {
    modeVal() { return MODES_VAL[this.modeIdx]; },
  },
  onLoad(options) {
    let id = options.id || "";
    // uni router 会再编码一层，做双重解码兜底
    try { id = decodeURIComponent(id); } catch (e) { /* ignore */ }
    try { id = decodeURIComponent(id); } catch (e) { /* ignore */ }
    this.score = allScores().find((s) => s.id === id);
    // 应用「我的」页的默认偏好
    const pref = getSettings();
    this.modeIdx = pref.mode === "follow" ? 1 : 0;
    this.handIdx = ["both", "1", "2"].indexOf(pref.hands);
    if (this.handIdx < 0) this.handIdx = 0;
    this.speedPct = pref.speedPct || 100;
    this.buildSeq();
    PianoBLE.onLog = (t) => {
      this.logs.push(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${t}`);
      if (this.logs.length > 200) this.logs.shift();
      // RX 实时计数 + 首包提示：按键后此数不动 = 琴→App 通知未达
      this.rxPackets = PianoBLE.rxCount;
      if (PianoBLE.rxCount > 0 && !this._rxToasted) {
        this._rxToasted = true;
        uni.showToast({ title: "✓ 已收到琴端数据", icon: "none" });
      }
      this.$nextTick && this.$nextTick(() => this.scrollLog());
    };
    PianoBLE.onDisconnect = () => {
      if (this.practice) this.endPractice(true);
      this.bleOn = PianoBLE.connected;
    };
    // mock=1：调试 / 桌面演示模式，不碰真实蓝牙
    if (options.mock) {
      PianoBLE.mockConnect().then(() => { this.bleOn = PianoBLE.connected; });
    }
    PianoBLE.onPianoNote = (midi, vel, isOn) => {
      if (!this.practice) return;
      if (isOn) {
        this.practice.press(midi, vel);
        this.refreshUI();
      } else {
        this.practice.release(midi);
      }
    };
  },
  methods: {
    scrollLog() {
      // 日志框自动滚到最新一行（H5/APP WebView 环境下生效）
      try {
        const el = document.querySelector(".log");
        if (el) el.scrollTop = el.scrollHeight;
      } catch (e) { /* 非 H5 环境忽略 */ }
    },
    buildSeq() {
      if (!this.score) return;
      // 云曲库预编译序列：直接消费，零解析（曲谱原文仅用于 H5 渲染）
      if (this.score.seq && this.score.seq.events) {
        const s = this.score.seq;
        this.seq = {
          bpm: s.bpm,
          totalTime: s.totalTime,
          events: s.events.map((e) => ({
            t: e.t,
            dur: e.d,
            notes: e.n.map(([midi, hand]) => ({ midi, hand })),
          })),
        };
        return;
      }
      try {
        if (this.score.type === "xml") {
          this.seq = PC.Sequence.fromMusicXML(this.score.content);
        } else if (G.ABCJS && G.ABCJS.synth) {
          this.seq = PC.Sequence.fromABC(this.score.content);
        } else {
          this.seq = PC.Sequence.fromAbcLite(this.score.content);
        }
      } catch (e) {
        this.seq = null;
        uni.showToast({ title: "解析失败: " + e.message, icon: "none" });
      }
    },
    refreshUI() {
      const p = this.practice;
      if (!p) return;
      const cur = p.mode === "wait" ? p.events[p.idx] : p.events[Math.max(0, p._triggeredCount - 1)];
      this.nextNotes = p.mode === "wait" && cur ? cur.notes.map((n) => PC.Sequence.noteName(n.midi)).join(" ") : "";
      this.progress = `${Math.min(p.idx, p.total)}/${p.total}`;
      this.stats = { hits: p.stats().hits, partial: p.stats().partial, wrong: p.stats().wrong };
      this.stateText = p.mode === "wait" ? "亮哪个键弹哪个" : "跟着琴声一起弹";
    },
    start() {
      if (this.practice) return;
      if (!this.score) return uni.showToast({ title: "曲谱未加载", icon: "none" });
      if (!PianoBLE.connected) return uni.showToast({ title: "请先连接钢琴", icon: "none" });
      if (!this.seq) this.buildSeq();
      if (!this.seq || !this.seq.events.length) return uni.showToast({ title: "没有可练的音符", icon: "none" });
      const mode = MODES_VAL[this.modeIdx];
      const self = this;
      this.practice = new PC.Practice(this.seq, {
        mode,
        hands: HANDS_VAL[this.handIdx],
        speed: this.speedPct / 100,
        ble: PianoBLE,
        // #ifdef H5
        // 琴已连接时钢琴是唯一音源（noteOn 由引擎驱动），手机本地合成音仅在未连琴/模拟模式兜底
        sound: mode === "follow" && (!PianoBLE.connected || PianoBLE._mock) ? AppSynth : null,
        // #endif
        onState: (t) => { self.stateText = t; },
        onProgress: () => self.refreshUI(),
        onAdvance: () => self.refreshUI(),
        onWrong: () => self.refreshUI(),
        onComplete: (stats, aborted) => self.showResult(stats, aborted),
      });
      this.practice.start();
      this.refreshUI();
    },
    skip() {
      if (this.practice) { this.practice.skip(); this.refreshUI(); }
    },
    end() {
      if (this.practice) this.practice.stop();
    },
    endPractice(silent) {
      const p = this.practice;
      if (!p) return;
      if (silent) p.onComplete = () => {};
      p.stop();
      this.practice = null;
    },
    showResult(stats, aborted) {
      this.practice = null;
      const wn = Object.entries(stats.wrongNotes || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([m, c]) => `${PC.Sequence.noteName(+m)}×${c}`)
        .join(" ");
      const parts = [
        `完整命中 ${stats.hits}/${stats.total} 组`,
        stats.partial ? `部分 ${stats.partial} 组` : null,
        stats.missed ? `漏弹 ${stats.missed} 音` : null,
        stats.avgLatency != null ? `平均反应 ${stats.avgLatency}ms` : null,
      ].filter(Boolean);
      this.result = { score: stats.score, summary: parts.join("，"), wrongNotes: wn };
      if (!aborted) {
        PC.Records.add({
          ts: Date.now(),
          score: this.score.name,
          mode: MODES_VAL[this.modeIdx],
          handsLabel: HANDS[this.handIdx],
          score: stats.score,
          hits: stats.hits,
          total: stats.total,
          wrong: stats.wrong,
          avgLatency: stats.avgLatency,
        });
      }
    },
    closeResult() { this.result = null; },
    again() {
      this.result = null;
      setTimeout(() => this.start(), 100);
    },
    async toggleBle() {
      if (PianoBLE.connected) {
        PianoBLE.disconnect();
        this.bleOn = PianoBLE.connected;
        return;
      }
      try {
        const name = await PianoBLE.connect();
        this.bleOn = PianoBLE.connected;
        uni.showToast({ title: "已连接 " + name, icon: "none" });
      } catch (e) {
        uni.showToast({ title: "连接失败: " + e.message, icon: "none" });
      }
    },
    async testTone() {
      try {
        await PianoBLE.testTone();
        uni.showToast({ title: "已发测试音", icon: "none" });
      } catch (e) {
        uni.showToast({ title: "试音失败: " + e.message, icon: "none" });
      }
    },
  },
};
</script>

<style>
.page { padding-bottom: 40px; }
.title { font-size: 17px; font-weight: 700; margin-bottom: 10px; }
.row { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.row.center { justify-content: center; }
.lbl { font-size: 13px; color: #7a8199; }
.picker { padding: 6px 12px; border: 1px solid #e3e6ef; border-radius: 8px; font-size: 14px; background: #fff; }
.slider { flex: 1; margin: 0 8px; }
.badge { font-size: 12px; padding: 3px 10px; border-radius: 20px; }
.badge.off { background: #f0f1f5; color: #7a8199; }
.badge.on { background: #e2f7ee; color: #19b273; }
.log {
  margin-top: 8px; max-height: 180px; overflow-y: auto;
  background: #1d2130; color: #9fe8c1; border-radius: 8px;
  padding: 6px 10px; font-size: 11px; font-family: monospace;
  -webkit-overflow-scrolling: touch;
}
.status { background: #20244d; border-color: #3a3f7a; }
.status .state { color: #eef0ff; font-weight: 600; }
.status .next { color: #9fd0ff; font-size: 20px; font-weight: 700; font-family: monospace; margin: 6px 0; }
.status .count { color: #b9bfee; font-size: 13px; margin-bottom: 8px; }
.status .btn { background: rgba(255, 255, 255, 0.12); border-color: #4a5090; color: #eef0ff; }
.status .btn-danger { background: #e5484d; border-color: #e5484d; }
.overlay {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 100;
  background: rgba(20, 22, 40, 0.5); display: flex; align-items: center; justify-content: center;
}
.modal {
  width: 320px; background: #fff; border-radius: 16px; padding: 22px; text-align: center;
}
.mtitle { font-size: 14px; color: #7a8199; }
.mscore { font-size: 52px; font-weight: 800; color: #5b6cff; margin: 8px 0; }
.mrow { font-size: 13px; color: #2b2f3a; margin-bottom: 8px; }
.mwrong { font-size: 12.5px; color: #c0392b; margin-bottom: 10px; }
</style>
