<template>
  <view class="page">
    <!-- 统计卡 -->
    <view class="card stats">
      <view class="stat">
        <view class="stat-n">{{ stats.total }}</view>
        <view class="stat-t">累计练习</view>
      </view>
      <view class="stat">
        <view class="stat-n">{{ stats.best }}</view>
        <view class="stat-t">最高分</view>
      </view>
      <view class="stat">
        <view class="stat-n">{{ stats.avg }}</view>
        <view class="stat-t">平均分</view>
      </view>
      <view class="stat">
        <view class="stat-n">{{ stats.streak }}</view>
        <view class="stat-t">连续天数</view>
      </view>
    </view>

    <!-- 最近记录 -->
    <view class="section-h"><text class="section-t">最近练习</text><text v-if="records.length" class="section-more" @click="clearRecords">清空</text></view>
    <view class="card list-card">
      <view v-if="!records.length" class="muted pad">还没有练习记录，去练一首吧</view>
      <view v-for="(r, i) in records" :key="i" class="rec">
        <view class="rec-l">
          <view class="rec-name">{{ r.score }} <text class="muted">· {{ r.mode === "wait" ? "等待" : "跟弹" }}{{ r.handsLabel }}</text></view>
          <view class="muted">{{ r.hits }}/{{ r.total }} 组 · 错按 {{ r.wrong }}{{ r.avgLatency != null ? " · " + r.avgLatency + "ms" : "" }}</view>
        </view>
        <view class="rec-score" :class="{ good: r.score >= 90 }">{{ r.score }}</view>
      </view>
    </view>

    <!-- 练习偏好 -->
    <view class="section-h"><text class="section-t">练习偏好</text></view>
    <view class="card">
      <view class="set-row">
        <text class="set-l">默认模式</text>
        <picker :range="['等待模式', '跟弹评分']" :value="settings.mode === 'wait' ? 0 : 1" @change="setMode($event.detail.value)">
          <view class="picker">{{ settings.mode === "wait" ? "等待模式" : "跟弹评分" }}</view>
        </picker>
      </view>
      <view class="set-row">
        <text class="set-l">默认声部</text>
        <picker :range="['双手', '右手', '左手']" :value="['both','1','2'].indexOf(settings.hands)" @change="setHands($event.detail.value)">
          <view class="picker">{{ ['双手','右手','左手'][['both','1','2'].indexOf(settings.hands)] }}</view>
        </picker>
      </view>
      <view class="set-row col">
        <text class="set-l">默认速度 {{ settings.speedPct }}%</text>
        <slider class="slider" :value="settings.speedPct" :min="50" :max="150" :step="5" activeColor="#5b6cff" @change="setSpeed($event.detail.value)" />
      </view>
    </view>

    <!-- 关于 -->
    <view class="section-h"><text class="section-t">关于</text></view>
    <view class="card list-card">
      <view class="item" @click="goAgreement('user')"><text>用户协议</text><text class="item-go">›</text></view>
      <view class="item" @click="goAgreement('privacy')"><text>隐私政策</text><text class="item-go">›</text></view>
      <view class="item"><text>版本</text><text class="muted">1.0.0</text></view>
      <view class="item" @click="feedback"><text>联系客服</text><text class="item-go">›</text></view>
    </view>

    <view class="src muted">
      曲库数据来源：The Session（传统曲调）、Mutopia Project（公有领域乐谱）、
      John Chambers ABC 集合。曲目为传统/公有领域作品。
    </view>
  </view>
</template>

<script>
import { getSettings, setSetting } from "../../utils/settings.js";
import "../../core/records.js";

const PC = globalThis.PianoCore;

export default {
  data() {
    return { records: [], settings: getSettings() };
  },
  computed: {
    stats() {
      const rs = PC && PC.Records ? PC.Records.all() : [];
      const total = rs.length;
      const best = rs.reduce((m, r) => Math.max(m, r.score || 0), 0);
      const avg = total ? Math.round(rs.reduce((a, r) => a + (r.score || 0), 0) / total) : 0;
      // 连续打卡天数（按自然日）
      const days = new Set(rs.map((r) => new Date(r.ts).toDateString()));
      let streak = 0;
      const d = new Date();
      while (days.has(d.toDateString())) {
        streak++;
        d.setDate(d.getDate() - 1);
      }
      return { total, best, avg, streak };
    },
  },
  onShow() {
    this.records = (PC && PC.Records ? PC.Records.all() : []).slice(0, 12);
    this.settings = getSettings();
  },
  methods: {
    setMode(v) { this.settings = setSetting("mode", v === 0 ? "wait" : "follow"); },
    setHands(v) { this.settings = setSetting("hands", ["both", "1", "2"][v]); },
    setSpeed(v) { this.settings = setSetting("speedPct", v); },
    clearRecords() {
      uni.showModal({
        title: "清空练习记录",
        content: "确定删除全部练习记录吗？",
        success: (r) => {
          if (r.confirm) {
            uni.removeStorageSync("pp_records_v1");
            this.records = [];
          }
        },
      });
    },
    goAgreement(kind) {
      uni.navigateTo({ url: "/pages/agreement/agreement?kind=" + kind });
    },
    feedback() {
      uni.showToast({ title: "客服邮箱见用户协议页", icon: "none" });
    },
  },
};
</script>

<style>
.page { padding: 12px 0 30px; }
.stats { display: flex; }
.stat { flex: 1; text-align: center; }
.stat-n { font-size: 22px; font-weight: 800; color: #5b6cff; font-variant-numeric: tabular-nums; }
.stat-t { font-size: 12px; color: #7a8199; margin-top: 3px; }
.section-h { display: flex; justify-content: space-between; align-items: center; margin: 18px 16px 8px; }
.section-t { font-size: 15px; font-weight: 700; }
.section-more { font-size: 13px; color: #b6bccf; }
.list-card { padding: 4px 14px; }
.pad { padding: 10px 0; }
.rec { display: flex; justify-content: space-between; align-items: center; padding: 11px 0; border-bottom: 1px solid #f0f1f6; }
.rec:last-child { border-bottom: none; }
.rec-name { font-size: 14.5px; font-weight: 600; }
.rec-score { font-size: 18px; font-weight: 800; color: #7a8199; font-variant-numeric: tabular-nums; }
.rec-score.good { color: #19b273; }
.set-row { display: flex; justify-content: space-between; align-items: center; padding: 11px 0; }
.set-row.col { flex-direction: column; align-items: stretch; }
.set-l { font-size: 14.5px; }
.picker { padding: 6px 12px; border: 1px solid #e3e6ef; border-radius: 8px; font-size: 13.5px; background: #fff; }
.slider { margin: 8px 4px 0; }
.item { display: flex; justify-content: space-between; align-items: center; padding: 13px 0; border-bottom: 1px solid #f0f1f6; font-size: 15px; }
.item:last-child { border-bottom: none; }
.item-go { color: #c0c4d2; }
.src { margin: 6px 20px 0; line-height: 1.6; font-size: 11.5px; }
</style>
