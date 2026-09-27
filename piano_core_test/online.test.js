// 在线搜谱全链路无头测试：真实 bitmidi 搜索 → 下载 MIDI → PianoCore 解析 → ABC 生成
// 用法：node online.test.js（需联网）
const fs = require("fs");
const path = require("path");
const assert = require("assert");

// 加载 PianoCore（IIFE 挂 globalThis，Node 直跑）
require(path.join(__dirname, "..", "piano-uniapp", "src", "core", "sequence.js"));
const PC = globalThis.PianoCore;

// online.js 是 ESM，剥 export 后取函数
const src = fs.readFileSync(path.join(__dirname, "..", "piano-uniapp", "src", "utils", "online.js"), "utf8")
  .replace(/^export\s+/gm, "");
const { searchOnlineMidi, downloadMidi } = new Function(src + "\nreturn { searchOnlineMidi, downloadMidi };")();

(async () => {
  // 1) 搜索
  const r = await searchOnlineMidi("summer", 0);
  assert.ok(r.list.length > 0, "搜索有结果");
  assert.ok(r.pageTotal >= 1, "分页字段");
  assert.ok(r.list.every((x) => x.name && x.downloadUrl && /^\/uploads\/\d+\.mid$/.test(x.downloadUrl)), "结果字段完整");
  console.log(`搜索 "summer": ${r.total} 首 / ${r.pageTotal} 页，首页 ${r.list.length} 条`);

  // 2) 下载 + 解析 + 转 ABC（取搜索结果第一首）
  const target = r.list[0];
  const u8 = await downloadMidi(target.downloadUrl);
  assert.equal(u8[0] === 0x4d && u8[1] === 0x54 && u8[2] === 0x68 && u8[3] === 0x64, true, "MThd 魔数");
  const midi = PC.Sequence.parseMidi(u8);
  const seq = PC.Sequence.midiToSequence(midi);
  assert.ok(seq.events.length > 0, "解析出音符事件");
  // 3) 鼓轨已滤：任何事件里不允许出现 GM 打击乐特征（解析层已丢弃 ch9，这里验证事件数与总时长合理）
  assert.ok(seq.totalTime > 3 && seq.totalTime < 3600, "时长合理: " + seq.totalTime.toFixed(1) + "s");
  const abc = PC.Sequence.toABC(seq, { title: target.name });
  assert.ok(/^X:/.test(abc) && /K:/.test(abc), "ABC 头完整");
  // 4) 回环：生成的 ABC 经轻量解析器可再解析（练习页消费路径）
  const re = PC.Sequence.fromAbcLite(abc);
  assert.ok(re.events.length > 0, "生成的 ABC 可被练习页解析（回环）");
  console.log(`导入 "${target.name}": ${seq.events.length} 事件 / ${seq.totalTime.toFixed(1)}s / bpm ${seq.bpm} / ABC ${abc.length} 字符，回环解析 ${re.events.length} 事件`);

  // 5) 中文关键词行为（预期无结果但不报错）
  const cjk = await searchOnlineMidi("周杰伦", 0);
  console.log(`搜索 "周杰伦": ${cjk.total} 首（中文覆盖有限，属预期）`);
  console.log("PASS: 在线搜谱全链路（搜索/下载/解析/转ABC/回环）通过");
})().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
