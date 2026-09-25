// 菊次郎的夏天《Summer》入库：bitmidi 量化 MIDI → 双声部 ABC → 官方 fromABC 预编译 → classical 包
// 用法: node add_summer.js
global.window = global;
const fs = require("fs");
const path = require("path");
const ABCJS = require("D:/钢琴/piano_app/lib/abcjs-basic-min.js");
global.ABCJS = ABCJS;
require("D:/钢琴/piano_app/js/core/sequence.js");
const S = PianoCore.Sequence;

const MID = "D:/钢琴/曲库/summer_raw.mid";
const ABC_OUT = "D:/钢琴/曲库/custom/summer_kikujiro.abc";

// ---------- 1. 解析 MIDI ----------
const midi = S.parseMidi(new Uint8Array(fs.readFileSync(MID)));
const DIV = midi.division; // 256
const UNIT = DIV / 4; // 十六分音符 = 64 tick
const BAR = DIV * 4; // 4/4 小节 = 1024 tick
const notes = [];
midi.tracks.forEach((tr) => {
  for (const n of tr.notes) notes.push({ on: n.on, off: n.off, midi: n.note, vel: n.vel });
});
notes.sort((a, b) => a.on - b.on || a.midi - b.midi);
console.log("notes:", notes.length, "division:", DIV);

// 量化到十六分网格（少数音带演奏偏移），再合并同音重音
const q = notes.map((n) => ({ ...n, on: Math.round(n.on / UNIT) * UNIT }));
const merged = [];
for (const n of q) {
  const p = merged[merged.length - 1];
  if (p && p.midi === n.midi && n.on - p.off <= UNIT) { p.off = Math.max(p.off, n.off); continue; }
  merged.push({ ...n });
}
const endTick = Math.max(...merged.map((n) => n.off));
const barCount = Math.ceil(endTick / BAR);
console.log("merged:", merged.length, "endTick:", endTick, "bars:", barCount);

// ---------- 2. 拼 ABC ----------
// K:D（F#/C#），其余音级带临时记号
const PC_TOK = { 0: "=C", 1: "^C", 2: "D", 3: "^D", 4: "E", 5: "=F", 6: "F", 7: "G", 8: "^G", 9: "A", 10: "^A", 11: "B" };
function abcToken(m) {
  const pc = m % 12, oct = Math.floor(m / 12) - 1;
  const base = PC_TOK[pc];
  if (oct >= 5) return base.toLowerCase() + "'".repeat(oct - 5);
  if (oct === 4) return base;
  return base + ",".repeat(4 - oct);
}
const unitsOf = (dur) => Math.max(1, Math.round(dur / UNIT));

function buildVoice(notes_, totalBars) {
  const byOn = new Map();
  for (const n of notes_) {
    const k = n.on;
    if (!byOn.has(k)) byOn.set(k, []);
    byOn.get(k).push(n);
  }
  const bars = [];
  for (let b = 0; b < totalBars; b++) {
    const barStart = b * BAR, barEnd = barStart + BAR;
    const onsets = [...byOn.keys()].filter((k) => k >= barStart && k < barEnd).sort((a, z) => a - z);
    const toks = [];
    let cursor = barStart;
    for (let i = 0; i < onsets.length; i++) {
      const on = onsets[i];
      const gap = Math.round((on - cursor) / UNIT);
      if (gap > 0) toks.push("z" + (gap > 1 ? gap : ""));
      const group = byOn.get(on);
      // 记谱截断：不越过本声部下一个音的起点，也不越过小节线
      const nextOn = i + 1 < onsets.length ? onsets[i + 1] : barEnd;
      const u = Math.min(
        Math.max(...group.map((g) => unitsOf(g.off - on))),
        Math.round((nextOn - on) / UNIT),
        Math.round((barEnd - on) / UNIT)
      );
      const tok = group
        .map((g) => abcToken(g.midi))
        .sort()
        .join("");
      toks.push(group.length > 1 ? "[" + tok + "]" + (u > 1 ? u : "") : tok + (u > 1 ? u : ""));
      cursor = on + u * UNIT;
    }
    const tail = Math.round((barEnd - cursor) / UNIT);
    if (tail > 0) toks.push("z" + (tail > 1 ? tail : ""));
    const total = toks.reduce((s, t) => s + (parseInt((t.match(/(\d+)$/) || [])[1], 10) || 1), 0);
    if (total !== 16) throw new Error(`bar ${b + 1} 时值和=${total} ≠ 16: ${toks.join(" ")}`);
    bars.push(toks.join(" "));
  }
  return bars;
}

const rh = merged.filter((n) => n.midi >= 65);
const lh = merged.filter((n) => n.midi < 65);
console.log("RH:", rh.length, "LH:", lh.length);
const rhBars = buildVoice(rh, barCount);
const lhBars = buildVoice(lh, barCount);

const header = ["X:1", "T:菊次郎的夏天 Summer", "C:久石让 Joe Hisaishi", "M:4/4", "L:1/16", "Q:1/4=100", "K:D"];
function body(bars, isLast) {
  const lines = [];
  for (let i = 0; i < bars.length; i += 4) {
    const chunk = bars.slice(i, i + 4).map((b, j) => {
      const last = i + j === bars.length - 1;
      return b + (last ? (isLast ? " |]" : " |") : " |");
    });
    lines.push(chunk.join(""));
  }
  return lines;
}
const abc = header
  .concat(["V:1 name=\"Right\" clef=treble"], body(rhBars, false))
  .concat(["V:2 name=\"Left\" clef=bass"], body(lhBars, true))
  .join("\n") + "\n";

// ---------- 3. 官方管线验证 ----------
const seq = S.fromABC(abc);
console.log("fromABC: bpm=", seq.bpm, "totalTime=", seq.totalTime.toFixed(2) + "s", "events=", seq.events.length);
if (seq.bpm !== 100) throw new Error("bpm 不符");
if (seq.totalTime < 6 || seq.totalTime > 240) throw new Error("时长越界");
const handMidi = { 1: [], 2: [] };
for (const ev of seq.events) for (const n of ev.notes) handMidi[n.hand].push(n.midi);
console.log("hand1(右):", handMidi[1].length, "min", Math.min(...handMidi[1]), "max", Math.max(...handMidi[1]));
console.log("hand2(左):", handMidi[2].length, "min", Math.min(...handMidi[2]), "max", Math.max(...handMidi[2]));
if (Math.min(...handMidi[1]) < 65 || Math.max(...handMidi[2]) >= 65) throw new Error("左右手划分异常");
// 旋律前 10 音对拍 MIDI
const mel = [];
for (const ev of seq.events) for (const n of ev.notes) if (n.hand === 1) mel.push(n.midi);
const melMidi = rh.sort((a, b) => a.on - b.on || a.midi - b.midi).map((n) => n.midi);
const ok = mel.slice(0, 40).every((m, i) => m === melMidi[i]);
console.log("旋律前40音 roundtrip 一致:", ok, "melody notes:", mel.length, "vs", melMidi.length);
if (!ok) throw new Error("roundtrip 不一致");

// ---------- 4. 入库 classical（三处副本） ----------
const tune = {
  id: "cu-s1",
  name: "菊次郎的夏天 Summer",
  type: "abc",
  src: "自制编配（MIDI 转谱）",
  content: abc.trim(),
  seq: {
    bpm: seq.bpm,
    totalTime: Math.round(seq.totalTime * 1000) / 1000,
    events: seq.events.map((e) => ({
      t: Math.round(e.t * 1000) / 1000,
      d: Math.round(e.dur * 1000) / 1000,
      n: e.notes.map((n) => [n.midi, n.hand]),
    })),
  },
};
const targets = [
  "D:/钢琴/piano_app/library/classical.json",
  "D:/钢琴/piano_app/dist/library/classical.json",
  "D:/钢琴/piano-uniapp/src/static/library/classical.json",
];
for (const fp of targets) {
  const pack = JSON.parse(fs.readFileSync(fp, "utf8"));
  pack.tunes = pack.tunes.filter((t) => t.id !== tune.id);
  if (!pack.tunes.some((t) => t.name === tune.name)) pack.tunes.push(tune);
  pack.tunes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  fs.writeFileSync(fp, JSON.stringify(pack));
  console.log("写入", fp, "tunes:", pack.tunes.length);
}
fs.mkdirSync(path.dirname(ABC_OUT), { recursive: true });
fs.writeFileSync(ABC_OUT, abc);
console.log("ABC 存档:", ABC_OUT, (abc.length / 1024).toFixed(1) + "KB");
console.log("OK");
