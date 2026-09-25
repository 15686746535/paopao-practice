// 曲库清洗 v2：abcjs 权威解析 + 预编译音符序列随曲打包（小程序端零解析）
// 输出: piano-uniapp/src/library/*.json + piano_app/library/*.json + 曲库/README.md
global.window = global;
const fs = require("fs");
const path = require("path");
const ABCJS = require("D:/钢琴/piano_app/lib/abcjs-basic-min.js");
global.ABCJS = ABCJS;
require("D:/钢琴/piano_app/js/core/sequence.js");
const S = PianoCore.Sequence;

const ROOT = "D:/钢琴/曲库";
const OUT_UNI = "D:/钢琴/piano-uniapp/src/library";
const OUT_H5 = "D:/钢琴/piano_app/library";

const SRC_LABEL = {
  thesession: "thesession.org",
  mutopia: "mutopiaproject.org",
  chambers: "trillian.mit.edu / abcnotation.com",
};

function classify(rel, title, meta, srcDir) {
  const p = rel.toLowerCase();
  const t = (title || "").toLowerCase();
  if (srcDir === "mutopia") return "classical";
  if ((meta && meta.category === "kids") || /kids/.test(p)) return "kids";
  if (srcDir === "thesession") return "folk";
  if (srcDir === "chambers") return "folk";
  return "folk";
}
function cleanTitle(raw) {
  return (raw || "").replace(/\s+/g, " ").replace(/["[\]]/g, "").trim().slice(0, 40);
}
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp, out);
    else if (/\.(abc|txt)$/i.test(f)) out.push(fp);
  }
  return out;
}
function loadMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")); } catch (e) { return []; }
}

const packs = {
  kids: { cat: "kids", name: "儿歌童谣", source: SRC_LABEL.chambers, tunes: [] },
  classical: { cat: "classical", name: "古典名曲", source: SRC_LABEL.mutopia, tunes: [] },
  folk: { cat: "folk", name: "民谣传统", source: SRC_LABEL.thesession + " · " + SRC_LABEL.chambers, tunes: [] },
  etude: { cat: "etude", name: "基础练习", source: "自制", tunes: [] },
};
const CAP = { kids: 40, classical: 70, folk: 70, etude: 12 };

const stats = { scanned: 0, ok: 0, failParse: 0, tooShort: 0, tooLong: 0, dup: 0, capped: 0, byCat: { kids: 0, classical: 0, folk: 0, etude: 0 } };
const seenTitles = new Set();
const failSamples = [];

packs.etude.tunes.push(
  { id: "et-s1", name: "C大调音阶（上下行）", type: "abc", src: "自制", content: "X:1\nT:C大调音阶（上下行）\nM:4/4\nL:1/4\nQ:1/4=90\nK:C\nC D E F | G A B c | c B A G | F E D C |]\n" },
  { id: "et-s2", name: "C大调短琶音", type: "abc", src: "自制", content: "X:1\nT:C大调短琶音\nM:4/4\nL:1/4\nQ:1/4=90\nK:C\nC E G c | c G E C | C E G c | c G E C |]\n" },
  { id: "et-s3", name: "五指热身操", type: "abc", src: "自制", content: "X:1\nT:五指热身操\nM:4/4\nL:1/8\nQ:1/4=80\nK:C\nC D E F G F E D | C D E F G4 | G A B c d c B A | G A B c d4 | d c B A G A B A | G F E D C4 |]\n" }
);

for (const srcDir of ["thesession", "mutopia", "chambers"]) {
  const dir = path.join(ROOT, srcDir);
  if (!fs.existsSync(dir)) continue;
  const metaByFile = {};
  for (const m of loadMeta(dir)) metaByFile[path.basename(m.file || "")] = m;
  for (const fp of walk(dir, [])) {
    stats.scanned++;
    const rel = path.relative(ROOT, fp);
    const meta = metaByFile[path.basename(fp)] || {};
    let text;
    try { text = fs.readFileSync(fp, "utf8"); } catch (e) { continue; }
    // ABC 空行会终止曲子（下载文件常在头注释后带空行）→ 压掉所有空行
    text = text.replace(/\r\n?/g, "\n").replace(/\n\s*\n+/g, "\n");
    if (!/^X:/m.test(text) || !/^K:/m.test(text)) { stats.failParse++; if (failSamples.length < 6) failSamples.push([rel, "no header"]); continue; }
    const tm = text.match(/^T:\s*(.+)$/m);
    const title = cleanTitle(tm ? tm[1] : path.basename(fp).replace(/\.(abc|txt)$/i, ""));
    if (!title) { stats.failParse++; continue; }
    const normTitle = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
    if (seenTitles.has(normTitle)) { stats.dup++; continue; }

    // abcjs 权威解析 + 预编译
    let seq;
    try { seq = S.fromABC(text); } catch (e) { stats.failParse++; if (failSamples.length < 12) failSamples.push([rel, "abcjs: " + e.message.slice(0, 60)]); continue; }
    if (seq.events.length < 4) { stats.tooShort++; continue; }
    if (seq.totalTime < 6) { stats.tooShort++; continue; }
    if (seq.totalTime > 240) { stats.tooLong++; continue; }
    const cat = classify(rel, title, meta, srcDir);
    if (packs[cat].tunes.length >= CAP[cat]) { stats.capped++; continue; }
    seenTitles.add(normTitle);
    stats.ok++;
    stats.byCat[cat]++;
    packs[cat].tunes.push({
      id: srcDir.slice(0, 2) + stats.ok,
      name: title,
      type: "abc",
      src: SRC_LABEL[srcDir] || srcDir,
      content: text.trim(),
      // 预编译音符序列（秒）。小程序端直接用，无需解析 ABC。
      seq: {
        bpm: seq.bpm,
        totalTime: Math.round(seq.totalTime * 1000) / 1000,
        events: seq.events.map((e) => ({
          t: Math.round(e.t * 1000) / 1000,
          d: Math.round(e.dur * 1000) / 1000,
          n: e.notes.map((n) => [n.midi, n.hand]),
        })),
      },
    });
  }
}

let bytes = 0;
const STATIC_UNI = "D:/钢琴/piano-uniapp/src/static/library";
fs.mkdirSync(STATIC_UNI, { recursive: true });
for (const p of Object.values(packs)) {
  p.tunes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const j = JSON.stringify(p);
  bytes += j.length;
  // 内置包（小程序随包，控制体积）：kids + etude
  if (p.cat === "kids" || p.cat === "etude") fs.writeFileSync(path.join(OUT_UNI, p.cat + ".json"), j);
  // 云端包（H5 同源 / 小程序 CDN）：全量
  fs.writeFileSync(path.join(STATIC_UNI, p.cat + ".json"), j);
  fs.writeFileSync(path.join(OUT_H5, p.cat + ".json"), j);
}

const readme = `# 曲库资产（清洗于 ${new Date().toISOString().slice(0, 10)}）

扫描 ${stats.scanned} → 入库 ${stats.ok}（abcjs 权威解析，音符序列已预编译随曲打包）
淘汰：解析失败 ${stats.failParse}、过短 ${stats.tooShort}、过长 ${stats.tooLong}、重名 ${stats.dup}、超类别上限 ${stats.capped}
分布：${Object.values(packs).map((p) => p.name + " " + p.tunes.length).join("、")}，打包体积约 ${(bytes / 1024).toFixed(0)} KB

来源与授权：
- thesession.org — 传统曲调（旋律公有领域），站点内容 CC BY-SA
- mutopiaproject.org — Public Domain 93 首 / CC BY-SA 6 首（由官方 MIDI 转换为 ABC）
- trillian.mit.edu（John Chambers）与 abcnotation.com — 传统曲目合集

清洗规则：X:/K: 头齐全；abcjs 解析 ≥4 音符；时长 6–240s；跨源按曲名去重。
预编译序列含 [midi, hand]，练习引擎直接消费；曲谱原文保留用于 H5 渲染。
商业分发提示：传统/公有领域旋律可安全内置；现代编配版需逐曲核对。
`;
fs.writeFileSync(path.join(ROOT, "README.md"), readme);
console.log(JSON.stringify(stats));
console.log("pack bytes:", (bytes / 1024).toFixed(0) + "KB");
console.log("failSamples:", JSON.stringify(failSamples.slice(0, 10), null, 0));
