<template>
  <view class="page">
    <!-- 分段器 -->
    <view class="seg">
      <view class="seg-item" :class="{ on: seg === 0 }" @click="seg = 0">我的曲谱</view>
      <view class="seg-item" :class="{ on: seg === 1 }" @click="seg = 1">云曲库</view>
      <view class="seg-item" :class="{ on: seg === 2 }" @click="seg = 2">在线搜谱</view>
    </view>

    <!-- ============ 我的曲谱 ============ -->
    <view v-show="seg === 0">
      <view class="imp card">
        <!-- #ifdef H5 -->
        <button class="btn btn-primary" @click="importFiles">📁 导入文件（ABC / MusicXML / MXL / MIDI）</button>
        <!-- #endif -->
        <!-- #ifndef H5 -->
        <button class="btn btn-primary" @click="importWx">📁 从聊天选择乐谱文件</button>
        <!-- #endif -->
        <view class="paste-wrap">
          <textarea class="paste" v-model="pasteAbc" placeholder="或粘贴 ABC 记谱（X:1 / T: / K: 开头…）" />
          <button class="btn" @click="importPaste">导入粘贴内容</button>
        </view>
      </view>

      <view class="card list-card">
        <view v-if="!scores.length" class="muted pad">还没有曲谱，从「云曲库」挑几首吧</view>
        <view v-for="s in scores" :key="s.id" class="item" :class="{ on: s.id === activeId }">
          <text class="item-name" @click="openScore(s)">{{ s.demo ? "🎵 " : "📄 " }}{{ s.name }}</text>
          <text class="del" @click="del(s.id)">删除</text>
        </view>
      </view>
    </view>

    <!-- ============ 云曲库 ============ -->
    <view v-show="seg === 1">
      <view class="chips">
        <view v-for="(p, i) in packs" :key="p.cat" class="chip" :class="{ on: packIdx === i }" @click="packIdx = i">
          {{ p.name }}<text class="chip-n">{{ p.loading ? "…" : (p.error ? "!" : p.tunes.length) }}</text>
        </view>
      </view>
      <view class="search card">
        <input class="search-in" v-model="kw" placeholder="🔍 搜索曲名" />
      </view>
      <view class="card list-card">
        <view v-if="curPack.loading" class="muted pad">云曲库加载中…</view>
        <view v-else-if="curPack.error" class="muted pad">云端曲库加载失败，请检查网络后重进本页</view>
        <view v-else-if="!filtered.length" class="muted pad">没有匹配的曲子</view>
        <view v-for="(t, i) in filtered" :key="t.id || i" class="item">
          <text class="item-name" @click="addCloud(t)">{{ t.name }}</text>
          <text class="add" @click="addCloud(t)">＋练这首</text>
        </view>
      </view>
      <view class="src muted">
        曲目来自公开曲库（The Session / Mutopia Project / John Chambers ABC 集合），
        传统曲调与公有领域作品，详见「我的-关于」。
      </view>
    </view>

    <!-- ============ 在线搜谱 ============ -->
    <view v-show="seg === 2">
      <view class="search card osearch">
        <input class="search-in" v-model="okw" placeholder="🔍 搜歌名（建议英文，如 summer / canon / jay）" confirm-type="search" @confirm="doSearch" />
        <button class="btn btn-primary" size="mini" :disabled="oLoading" @click="doSearch">搜索</button>
      </view>
      <view class="card list-card">
        <view v-if="oLoading && !oResults.length" class="muted pad">搜索中…</view>
        <view v-else-if="oError" class="muted pad">{{ oError }}</view>
        <view v-else-if="!oResults.length" class="muted pad">输入歌名搜在线 MIDI 曲库（约 2 万首流行/动漫/游戏改编）</view>
        <view v-for="r in oResults" :key="r.id" class="item">
          <text class="item-name">{{ r.name }}</text>
          <text class="add" @click="importOnline(r)">{{ oBusy === r.id ? "导入中…" : "＋导入" }}</text>
        </view>
        <view v-if="oResults.length && oPage + 1 < oPageTotal" class="more" @click="doSearch(oPage + 1)">
          {{ oLoading ? "加载中…" : "加载更多（共 " + oTotal + " 首）" }}
        </view>
      </view>
      <view class="src muted">
        曲目来自 bitmidi.com（用户上传 MIDI，转成跟弹谱后入库），仅供个人练习；
        下载与解析在本机完成，商业分发需另行授权。
      </view>
    </view>
  </view>
</template>

<script>
import { allScores, removeScore, addScore, saveAll } from "../../utils/store.js";
import { searchOnlineMidi, downloadMidi } from "../../utils/online.js";
import { pullScores, pushScores, mergeScores } from "../../utils/cloudsync.js";
import kids from "../../library/kids.json";
import etude from "../../library/etude.json";
import "../../core/sequence.js";
import "../../core/records.js";
// #ifdef H5
import "../../core/mxl.js";
// #endif

// 云端包：H5 同源取 /static/library/；小程序取自定义域名（需在小程序后台配置 downloadFile/request 合法域名）
// #ifdef H5
const REMOTE_BASE = "/static/library/";
// #endif
// #ifndef H5
const REMOTE_BASE = "https://pop.jinglingtuoke.cn/library/";
// #endif
const REMOTE_CATS = ["classical", "folk"];
const REMOTE_NAMES = { classical: "古典名曲", folk: "民谣传统" };

export default {
  data() {
    return {
      seg: 0,
      scores: [],
      activeId: null,
      pasteAbc: "",
      kw: "",
      packIdx: 0,
      packs: [kids, etude],
      okw: "",
      oResults: [],
      oPage: 0,
      oPageTotal: 1,
      oTotal: 0,
      oLoading: false,
      oError: "",
      oBusy: 0,
    };
  },
  computed: {
    curPack() {
      return this.packs[this.packIdx] || { tunes: [], loading: false, error: false };
    },
    filtered() {
      const p = this.packs[this.packIdx];
      if (!p) return [];
      const kw = (this.kw || "").trim().toLowerCase();
      return (p.tunes || []).filter((t) => !kw || t.name.toLowerCase().includes(kw));
    },
  },
  onLoad() {
    for (const cat of REMOTE_CATS) this.loadRemote(cat);
  },
  onShow() {
    this.scores = allScores();
    this.syncPull();
  },
  methods: {
    // 云同步：拉取（只补缺，不覆盖本地/不复活删除）+ 变更后整表推送
    syncPull() {
      pullScores().then((remote) => {
        if (!remote.length) return;
        const { additions } = mergeScores(this.scores, remote);
        if (additions.length) {
          saveAll(this.scores.concat(additions));
          this.scores = allScores();
          uni.showToast({ title: "云同步：新到 " + additions.length + " 首", icon: "none" });
        }
      });
    },
    queuePush() {
      if (this._pushTimer) clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => pushScores(allScores()), 1500);
    },
    loadRemote(cat) {
      const done = (pack) => {
        const idx = this.packs.findIndex((p) => p.cat === cat);
        if (idx >= 0) this.packs.splice(idx, 1, pack);
        else this.packs.push(pack);
      };
      const loadingPack = { cat, name: REMOTE_NAMES[cat], tunes: [], loading: true };
      done(loadingPack);
      const finish = (tunes, err) => {
        const cur = this.packs.find((p) => p.cat === cat);
        if (cur && cur !== loadingPack && cur.tunes && cur.tunes.length) return; // 已有数据不覆盖
        done({ cat, name: REMOTE_NAMES[cat], tunes: tunes || [], error: !!err });
      };
      // #ifdef H5
      fetch(REMOTE_BASE + cat + ".json")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((j) => finish(j.tunes))
        .catch(() => finish([], true));
      // #endif
      // #ifndef H5
      uni.request({
        url: REMOTE_BASE + cat + ".json",
        success: (res) => finish((res.data && res.data.tunes) || []),
        fail: () => finish([], true),
      });
      // #endif
    },
    openScore(s) {
      this.activeId = s.id;
      uni.navigateTo({ url: "/pages/practice/practice?id=" + encodeURIComponent(encodeURIComponent(s.id)) });
    },
    del(id) {
      removeScore(id);
      this.scores = allScores();
      this.queuePush();
    },
    guessName(text, fallback) {
      const m = text.match(/^T:\s*(.+)$/m);
      return m ? m[1].trim() : fallback;
    },
    importPaste() {
      const t = (this.pasteAbc || "").trim();
      if (!/^X:/.test(t)) {
        uni.showToast({ title: "不是 ABC 格式（需 X: 开头）", icon: "none" });
        return;
      }
      const item = addScore(this.guessName(t, "粘贴曲谱"), "abc", t);
      this.pasteAbc = "";
      this.scores = allScores();
      this.queuePush();
      uni.showToast({ title: "已导入：" + item.name, icon: "none" });
    },
    addCloud(t) {
      const exist = this.scores.find((s) => s.name === t.name);
      if (exist) return this.openScore(exist);
      const item = addScore(t.name, "abc", t.content, t.seq ? { seq: t.seq, src: t.src } : { src: t.src });
      this.scores = allScores();
      this.queuePush();
      uni.showToast({ title: "已加入：" + item.name, icon: "none" });
      this.openScore(item);
    },
    async doSearch(page) {
      if (typeof page !== "number") page = 0;
      const kw = (this.okw || "").trim();
      if (!kw) return uni.showToast({ title: "先输入歌名", icon: "none" });
      if (this.oLoading) return;
      this.oLoading = true;
      this.oError = "";
      try {
        const r = await searchOnlineMidi(kw, page);
        this.oResults = page === 0 ? r.list : this.oResults.concat(r.list);
        this.oPage = page;
        this.oPageTotal = r.pageTotal;
        this.oTotal = r.total;
        if (!r.list.length && page === 0) this.oError = "没有找到，换个关键词试试（建议英文/拼音）";
      } catch (e) {
        this.oError = "搜索失败: " + (e.message || e);
      }
      this.oLoading = false;
    },
    async importOnline(r) {
      if (this.oBusy) return;
      this.oBusy = r.id;
      try {
        const PC = globalThis.PianoCore;
        if (!PC || !PC.Sequence) throw new Error("解析引擎未就绪");
        const u8 = await downloadMidi(r.downloadUrl);
        const seq = PC.Sequence.midiToSequence(PC.Sequence.parseMidi(u8));
        if (!seq.events.length) throw new Error("该 MIDI 没有可练的音符");
        const name = r.name;
        addScore(name, "abc", PC.Sequence.toABC(seq, { title: name }), { src: "bitmidi " + r.url });
        this.scores = allScores();
        this.queuePush();
        uni.showToast({ title: "已导入：" + name, icon: "none" });
      } catch (e) {
        uni.showToast({ title: "导入失败: " + (e.message || e), icon: "none" });
      }
      this.oBusy = 0;
    },
    async importOne(f) {
      const base = f.name.replace(/\.[^.]+$/, "");
      const ext = (f.name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
      if (ext === "abc" || ext === "txt") {
        const text = await f.text();
        if (!/^\s*X:/m.test(text)) throw new Error("不是 ABC");
        return addScore(this.guessName(text, base), "abc", text);
      }
      if (ext === "xml" || ext === "musicxml" || ext === "mxl") {
        let xml = await f.text();
        if (ext === "mxl") xml = await globalThis.PianoCore.Mxl.mxlToXml(await f.arrayBuffer());
        if (!/<score-partwise|<score-timewise/.test(xml)) throw new Error("不是 MusicXML");
        const mv = xml.match(/<movement-title>([^<]+)<\/movement-title>/);
        const w = xml.match(/<work-title>([^<]+)<\/work-title>/);
        return addScore((mv && mv[1].trim()) || (w && w[1].trim()) || base, "xml", xml);
      }
      if (ext === "mid" || ext === "midi") {
        const buf = await f.arrayBuffer();
        const seq = globalThis.PianoCore.Sequence.midiToSequence(globalThis.PianoCore.Sequence.parseMidi(buf));
        if (!seq.events.length) throw new Error("MIDI 无音符");
        return addScore(base, "abc", globalThis.PianoCore.Sequence.toABC(seq, { title: base }));
      }
      throw new Error("格式 ." + ext + " 暂不支持");
    },
    // #ifdef H5
    importFiles() {
      const self = this;
      uni.chooseFile({
        count: 20,
        type: "file",
        extension: [".abc", ".txt", ".musicxml", ".xml", ".mxl", ".mid", ".midi"],
        success: async (res) => {
          let ok = 0, fail = 0;
          for (const tf of res.tempFiles || []) {
            try { await self.importOne(tf.file || tf); ok++; } catch (e) { fail++; }
          }
          self.scores = allScores();
          uni.showToast({ title: `成功 ${ok} 个${fail ? "，失败 " + fail + " 个" : ""}`, icon: "none" });
        },
      });
    },
    // #endif
    // #ifndef H5
    importWx() {
      const self = this;
      uni.chooseMessageFile({
        count: 20,
        extension: [".abc", ".txt", ".musicxml", ".xml", ".mxl", ".mid", ".midi"],
        success: async (res) => {
          const fs = uni.getFileSystemManager();
          let ok = 0, fail = 0;
          for (const f of res.tempFiles || []) {
            try {
              const ext = (f.name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
              const base = f.name.replace(/\.[^.]+$/, "");
              if (ext === "abc" || ext === "txt") {
                const text = fs.readFileSync(f.path, "utf8");
                if (!/^\s*X:/m.test(text)) throw new Error("bad");
                addScore(self.guessName(text, base), "abc", text);
                ok++;
              } else if (ext === "mid" || ext === "midi") {
                const buf = fs.readFileSync(f.path);
                const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                const seq = globalThis.PianoCore.Sequence.midiToSequence(globalThis.PianoCore.Sequence.parseMidi(ab));
                addScore(base, "abc", globalThis.PianoCore.Sequence.toABC(seq, { title: base }));
                ok++;
              } else fail++;
            } catch (e) { fail++; }
          }
          self.scores = allScores();
          self.queuePush();
          uni.showToast({ title: `成功 ${ok} 个${fail ? "，失败 " + fail + " 个" : ""}`, icon: "none" });
        },
      });
    },
    // #endif
  },
};
</script>

<style>
.page { padding: 12px 0 30px; }
.seg {
  display: flex; margin: 0 16px 12px; background: #e9ebf4;
  border-radius: 10px; padding: 3px;
}
.seg-item {
  flex: 1; text-align: center; padding: 9px 0; font-size: 14px;
  color: #7a8199; border-radius: 8px;
}
.seg-item.on { background: #fff; color: #5b6cff; font-weight: 700; }
.imp .btn { width: 100%; }
.paste-wrap { margin-top: 10px; }
.paste {
  width: 100%; height: 84px; border: 1px solid #e3e6ef; border-radius: 8px;
  padding: 8px; font-size: 12px; margin-bottom: 8px; box-sizing: border-box;
}
.list-card { padding: 4px 14px; }
.pad { padding: 10px 0; }
.item { display: flex; justify-content: space-between; align-items: center; padding: 13px 0; border-bottom: 1px solid #f0f1f6; font-size: 15px; }
.item:last-child { border-bottom: none; }
.del { color: #b6bccf; font-size: 13px; padding: 4px 6px; }
.add { color: #5b6cff; font-size: 13.5px; font-weight: 600; padding: 4px 6px; }
.chips { display: flex; gap: 8px; padding: 0 16px 10px; flex-wrap: wrap; }
.chip {
  background: #fff; border: 1px solid #e3e6ef; border-radius: 20px;
  padding: 7px 14px; font-size: 13.5px; color: #7a8199;
}
.chip.on { background: #5b6cff; border-color: #5b6cff; color: #fff; }
.chip-n { font-size: 11px; opacity: 0.75; margin-left: 4px; }
.search { padding: 8px 14px; }
.search-in { font-size: 14px; }
.osearch { display: flex; align-items: center; gap: 8px; }
.osearch .search-in { flex: 1; }
.more { text-align: center; padding: 12px 0; color: #5b6cff; font-size: 14px; font-weight: 600; }
.src { margin: 4px 20px 0; line-height: 1.6; }
</style>
