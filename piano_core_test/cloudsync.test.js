// 云同步端到端测试：真实线上 API（popp.jinglingtuoke.cn/api/scores + Blob 存储）
// 模拟两台设备：A 推送 → B 用同一同步码拉回合并。用法：node cloudsync.test.js
const assert = require("assert");

const API = "https://popp.jinglingtuoke.cn/api/scores";
// 剥 ESM 后加载 cloudsync.js（其内部用 uni.* —— 打桩）
const fs = require("fs");
const path = require("path");
global.uni = {
  getStorageSync: () => "",
  setStorageSync: () => {},
};
const src = fs.readFileSync(path.join(__dirname, "..", "piano-uniapp", "src", "utils", "cloudsync.js"), "utf8")
  .replace(/^export\s+/gm, "");
const { pushScores, pullScores, mergeScores, getSyncKey } = new Function(src + "\nreturn { pushScores, pullScores, mergeScores, getSyncKey };")();

(async () => {
  const key = "paotest" + String(Date.now()).slice(-5);
  // 设备 A：三首曲谱推送
  const listA = [
    { id: "u1", ts: 100, name: "测试曲一", type: "abc", content: "X:1\nK:C" },
    { id: "u2", ts: 200, name: "测试曲二", type: "abc", content: "X:1\nK:C" },
    { id: "u3", ts: 300, name: "测试曲三", type: "abc", content: "X:1\nK:C" },
  ];
  assert.ok(await pushScoresTo(listA, key), "设备 A 推送成功");

  // 设备 B：拉取 → 合并进本地两首
  const remote = await pullWith(key);
  assert.equal(remote.length, 3, "设备 B 拉到 3 首");
  const localB = [{ id: "b1", ts: 50, name: "本地曲" }];
  const { additions, changed } = mergeScores(localB, remote);
  assert.equal(additions.length, 3, "合并新增 3 首");
  assert.ok(changed, "changed 标志");
  assert.equal(localB.length, 1, "本地原列表不被原地修改（由调用方 concat）");

  // 重复拉取：merge 幂等（已合并过的不重复加）
  const { additions: again } = mergeScores(localB.concat(additions), remote);
  assert.equal(again.length, 0, "二次合并幂等");

  // 中文完整性
  const cjk = [{ id: "u9", ts: 400, name: "中文名曲谱♪", type: "abc", content: "X:1" }];
  assert.ok(await pushScoresTo(cjk, key), "中文推送");
  const back = await pullWith(key);
  assert.equal(back.find((s) => s.id === "u9").name, "中文名曲谱♪", "中文名完好");

  // 错误路径：非法同步码
  const bad = await fetch(API + "?key=!!bad!!");
  assert.equal(bad.status, 400, "非法同步码 400");

  console.log("PASS: 云同步端到端（推送/拉取/合并/幂等/中文/错误路径）");

  async function pushScoresTo(list, k) {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, scores: list }) });
    const j = await res.json();
    return !!(j && j.ok);
  }
  async function pullWith(k) {
    const res = await fetch(API + "?key=" + encodeURIComponent(k));
    const j = await res.json();
    return j.scores || [];
  }
})().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
