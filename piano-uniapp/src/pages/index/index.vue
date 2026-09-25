<template>
  <view class="page">
    <!-- 钢琴连接卡 -->
    <view class="card hero">
      <view class="hero-row">
        <view class="hero-info">
          <view class="hero-title">{{ bleOn ? "钢琴已连接" : "连接你的泡泡钢琴" }}</view>
          <view class="muted">{{ bleOn ? deviceName + " · 灯光引导已就绪" : "蓝牙打开后点击连接，跟灯练琴" }}</view>
        </view>
        <button class="btn btn-primary round" size="mini" @click="toggleBle">{{ bleOn ? "断开" : "连接" }}</button>
      </view>
      <view v-if="bleOn" class="hero-actions">
        <button class="btn ghost" size="mini" @click="testTone">🔔 试音</button>
        <button class="btn ghost" size="mini" @click="goPracticeLast">🎯 弹上一首</button>
      </view>
      <view v-if="logs.length" class="hero-log">
        <view v-for="(l, i) in logs" :key="i">{{ l }}</view>
      </view>
    </view>

    <!-- 最近练 -->
    <view class="section-h" v-if="lastRecord">
      <text class="section-t">继续练</text>
    </view>
    <view v-if="lastRecord" class="card resume" @click="openByName(lastRecord.score)">
      <view class="resume-note">🎵</view>
      <view class="resume-body">
        <view class="resume-name">{{ lastRecord.score }}</view>
        <view class="muted">上次 {{ lastRecord.score }}分 · {{ lastRecord.mode === "wait" ? "等待模式" : "跟弹评分" }}</view>
      </view>
      <view class="resume-go">▶</view>
    </view>

    <!-- 我的曲谱（前 6 首） -->
    <view class="section-h">
      <text class="section-t">我的曲谱</text>
      <text class="section-more" @click="goLibrary">全部 {{ scores.length }} 首 ›</text>
    </view>
    <view class="card list-card">
      <view v-if="!scores.length" class="muted pad">曲库还没有曲谱，去「曲库」添加吧</view>
      <view v-for="s in topScores" :key="s.id" class="item" @click="openScore(s)">
        <text class="item-name">{{ s.demo ? "🎵 " : "📄 " }}{{ s.name }}</text>
        <text class="item-go">›</text>
      </view>
    </view>

    <!-- 快捷 -->
    <view class="section-h"><text class="section-t">快捷入口</text></view>
    <view class="grid">
      <view class="grid-item" @click="goLibrary">
        <view class="grid-ico">📚</view><view class="grid-t">云曲库</view>
      </view>
      <view class="grid-item" @click="goTab('/pages/profile/profile')">
        <view class="grid-ico">📈</view><view class="grid-t">练习统计</view>
      </view>
      <view class="grid-item" @click="randomScore">
        <view class="grid-ico">🎲</view><view class="grid-t">随机来一首</view>
      </view>
      <view class="grid-item" @click="goHelp">
        <view class="grid-ico">❓</view><view class="grid-t">怎么用</view>
      </view>
    </view>

    <view class="foot muted">弹对琴键灯会熄灭并前进 · 弹错闪红灯</view>
  </view>
</template>

<script>
import { allScores } from "../../utils/store.js";
import { PianoBLE } from "../../utils/ble.js";

const PC = globalThis.PianoCore;

export default {
  data() {
    return {
      bleOn: PianoBLE.connected,
      deviceName: PianoBLE.device ? PianoBLE.device.name || "" : "",
      scores: [],
      lastRecord: null,
      logs: [],
    };
  },
  computed: {
    topScores() { return this.scores.slice(0, 6); },
  },
  onShow() {
    this.scores = allScores();
    const recs = PC && PC.Records ? PC.Records.all() : [];
    this.lastRecord = recs.length ? recs[0] : null;
    // 首页也要看到 BLE 日志（连接过程发生在首页）
    PianoBLE.onLog = (t) => {
      this.logs.push(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${t}`);
      if (this.logs.length > 40) this.logs.shift();
    };
    PianoBLE.onDisconnect = () => { this.bleOn = PianoBLE.connected; };
  },
  methods: {
    openScore(s) {
      uni.navigateTo({ url: "/pages/practice/practice?id=" + encodeURIComponent(encodeURIComponent(s.id)) });
    },
    openByName(name) {
      const s = this.scores.find((x) => x.name === name);
      if (s) this.openScore(s);
      else uni.showToast({ title: "该曲谱已被删除", icon: "none" });
    },
    randomScore() {
      if (!this.scores.length) return uni.showToast({ title: "曲库是空的", icon: "none" });
      this.openScore(this.scores[Math.floor(Math.random() * this.scores.length)]);
    },
    goLibrary() { this.goTab("/pages/library/library"); },
    goHelp() { uni.showToast({ title: "见「我的」页说明", icon: "none" }); },
    goTab(url) { uni.switchTab({ url }); },
    async toggleBle() {
      if (PianoBLE.connected) {
        PianoBLE.disconnect();
        this.bleOn = PianoBLE.connected;
        return;
      }
      try {
        const name = await PianoBLE.connect();
        this.bleOn = PianoBLE.connected;
        this.deviceName = name || "";
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
    goPracticeLast() {
      if (this.lastRecord) this.openByName(this.lastRecord.score);
      else if (this.scores.length) this.openScore(this.scores[0]);
    },
  },
};
</script>

<style>
.page { padding: 12px 0 30px; }
.hero { background: linear-gradient(135deg, #5b6cff, #7a8cff); border: none; color: #fff; }
.hero-row { display: flex; align-items: center; justify-content: space-between; }
.hero-title { font-size: 17px; font-weight: 700; }
.hero-info .muted { color: rgba(255, 255, 255, 0.75); margin-top: 4px; }
.hero-actions { display: flex; gap: 10px; margin-top: 14px; }
.hero-log {
  margin-top: 10px; max-height: 110px; overflow: hidden;
  background: rgba(0, 0, 0, 0.25); border-radius: 8px;
  padding: 6px 10px; font-size: 11px; font-family: monospace; color: #b8f0d0;
}
.btn.ghost { background: rgba(255, 255, 255, 0.16); border-color: transparent; color: #fff; }
.btn.round { border-radius: 30px; padding-left: 22px; padding-right: 22px; }
.section-h { display: flex; justify-content: space-between; align-items: center; margin: 18px 16px 8px; }
.section-t { font-size: 15px; font-weight: 700; }
.section-more { font-size: 13px; color: #5b6cff; }
.resume { display: flex; align-items: center; gap: 12px; }
.resume-note { font-size: 30px; }
.resume-body { flex: 1; }
.resume-name { font-size: 16px; font-weight: 600; }
.resume-go { color: #5b6cff; font-size: 18px; }
.list-card { padding: 4px 14px; }
.pad { padding: 10px 0; }
.item { display: flex; justify-content: space-between; align-items: center; padding: 13px 0; border-bottom: 1px solid #f0f1f6; font-size: 15px; }
.item:last-child { border-bottom: none; }
.item-go { color: #c0c4d2; }
.grid { display: flex; flex-wrap: wrap; padding: 0 8px; gap: 10px; }
.grid-item {
  width: calc(50% - 13px); background: #fff; border: 1px solid #e3e6ef;
  border-radius: 12px; padding: 16px 0; text-align: center;
}
.grid-ico { font-size: 26px; }
.grid-t { font-size: 13.5px; margin-top: 6px; color: #2b2f3a; }
.foot { text-align: center; margin-top: 22px; }
</style>
