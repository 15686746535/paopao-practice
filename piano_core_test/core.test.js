// Node 冒烟测试：window shim + 核心模块 + 断言
global.window = global;
global.performance = { now: () => Date.now() };

require("D:/钢琴/piano_app/js/core/sequence.js");
require("D:/钢琴/piano_app/js/core/practice.js");

const ABCJS = require("D:/钢琴/piano_app/lib/abcjs-basic-min.js");
global.ABCJS = ABCJS;
const Seq = PianoCore.Sequence;
const Practice = PianoCore.Practice;

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓", msg); }
  else { failed++; console.log("  ✗ FAIL:", msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ---------- 1. ABC -> sequence ----------
console.log("\n[1] ABC 解析");
const abc = "X:1\nT:Test\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G4 |]\n";
const seq1 = Seq.fromABC(abc);
eq(seq1.events.length, 5, "ABC 5 个音符 -> 5 个事件");
eq(seq1.bpm, 120, "Q:1/4=120 识别为 120bpm");
eq(seq1.events[0].notes[0].midi, 60, "第一个音是 C4(60)");
eq(seq1.events[0].notes[0].hand, 1, "单轨旋律默认右手");
ok(Math.abs(seq1.events[0].dur - 0.5) < 0.01, "四分音符@120bpm = 0.5s");
ok(Math.abs(seq1.events[4].dur - 2.0) < 0.02, "全音符@120bpm = 2.0s");

// 和弦符号 -> 伴奏轨（hand=2）
const abc2 = "X:1\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\n\"C\"C2 \"G\"G2 |]\n";
const seq2 = Seq.fromABC(abc2);
const hands = new Set();
seq2.events.forEach((e) => e.notes.forEach((n) => hands.add(n.hand)));
ok(hands.has(2), "和弦符号展开为左手伴奏轨");
ok(hands.has(1), "旋律仍为右手");

// 多音同时 -> 一个事件（和弦）
const abc3 = "X:1\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n[CEG]2 |]\n";
const seq3 = Seq.fromABC(abc3);
eq(seq3.events.length, 1, "和弦 [CEG] 合并为 1 个事件");
eq(seq3.events[0].notes.length, 3, "和弦事件含 3 个音");

// ---------- 2. MIDI 字节解析 ----------
console.log("\n[2] MIDI 解析");
const midiBytes = ABCJS.synth.getMidiFile(abc, { midiOutputType: "binary" });
const parsed = Seq.parseMidi(midiBytes); // parseMidi 自带解包
eq(parsed.division, 480, "division=480");
ok(parsed.tracks.length >= 2, "至少 2 轨");
const seqM = Seq.midiToSequence(parsed);
eq(seqM.events.length, 5, "MIDI -> 5 事件");

// ---------- 3. 序列 -> ABC（MIDI 导入） ----------
console.log("\n[3] midi2abc");
const abcOut = Seq.toABC(seq1, { title: "Roundtrip" });
ok(/X:1/.test(abcOut) && /K:C/.test(abcOut), "生成的 ABC 有头");
ok(/C\b|c/.test(abcOut), "包含音符字母");
const seqRT = Seq.fromABC(abcOut);
eq(seqRT.events.length, 5, "ABC 往返后事件数不变");

// ---------- 4. Practice 等待模式 ----------
console.log("\n[4] Practice 等待模式");
const mkSeq = () => ({
  events: [
    { t: 0.0, dur: 0.5, notes: [{ midi: 60, hand: 1 }] },
    { t: 0.5, dur: 0.5, notes: [{ midi: 62, hand: 1 }] },
    { t: 1.0, dur: 0.5, notes: [{ midi: 64, hand: 1 }, { midi: 67, hand: 2 }] },
  ],
  totalTime: 1.5,
  bpm: 120,
});
const lights = [];
const fakeBle = {
  connected: true,
  lightOn: (n, c) => lights.push(["on", n, c]),
  lightOff: (n) => lights.push(["off", n]),
  lightsClear: () => lights.push(["clear"]),
};
let completed = null;
const pr = new Practice(mkSeq(), {
  mode: "wait",
  ble: fakeBle,
  onComplete: (s) => { completed = s; },
});
pr.start();
eq(pr.events.length, 3, "3 个事件");
ok(lights.some((l) => l[0] === "on" && l[1] === 60 && l[2] === 0x11), "等待模式先亮 C4 蓝灯");
eq(pr.press(62), "wrong", "按下一个音 = wrong");
eq(pr.press(60), "hit", "按 C4 = hit");
eq(pr.press(62), "hit", "按 D4 = hit");
eq(pr.press(64), "hit", "和弦音1 hit");
eq(pr.press(67), "hit", "和弦音2 hit（跨声部双手都要弹）");
eq(pr.idx, 3, "3 个事件全部完成");
ok(completed != null, "自动触发 onComplete");
eq(completed.score, 100 - 0, "全对得满分? wrong 已计");
console.log("   stats:", JSON.stringify({ score: completed.score, wrong: completed.wrong, hits: completed.hits, missed: completed.missed }));
eq(completed.wrong, 1, "错误按键计 1 次");
eq(completed.score, 100, "score=100（错误按键不扣事件命中）");

// 声部过滤: 只练右手 → 左手音 67 变成 "other"，弹了静默忽略
let completed2 = null;
const pr2 = new Practice(mkSeq(), { mode: "wait", hands: "1", onComplete: (s) => { completed2 = s; } });
pr2.start();
eq(pr2.events.length, 3, "右手过滤后仍 3 事件（第三个事件只剩 64）");
eq(pr2.events[2].notes.length, 1, "第三事件只剩 1 个音");
eq(pr2.press(60), "hit", "右手模式 C4 hit");
eq(pr2.press(62), "hit", "右手模式 D4 hit");
eq(pr2.press(67), "ignored", "被过滤声部的 67 静默忽略");
eq(pr2.press(64), "hit", "64 hit 后事件完成");
ok(completed2 != null, "右手模式自动完成");
eq(completed2.score, 100, "右手模式满分");

// other 音忽略: hands='1' 时 67 属于 other
const pr3 = new Practice(mkSeq(), { mode: "wait", hands: "1" });
pr3.start();
pr3.press(60);
pr3.press(62);
eq(pr3.press(67), "ignored", "被过滤声部的 67 静默忽略");
eq(pr3.press(64), "hit", "64 正常 hit");

// ---------- 5. Practice 跟弹模式 ----------
console.log("\n[5] Practice 跟弹模式");
let now = 100000;
global.performance.now = () => now;
const sounds = [];
const pr4 = new Practice(mkSeq(), {
  mode: "follow",
  speed: 1,
  ble: fakeBle,
  sound: { playNote: (m, d) => sounds.push([m, d]) },
  onComplete: (s) => { completed = s; },
});
pr4.start();
// t=0 事件立即触发
eq(sounds.length, 1, "启动即触发第 1 音");
now += 400; pr4._tick(); // 0.4s：仍在第1音窗口，第2音(0.5)未到
eq(pr4.press(60), "hit", "0.4s 内按 C4 = hit");
eq(pr4.press(70), "wrong", "乱按 = wrong");
now += 500; pr4._tick(); // pos=0.9：第2音(0.5)已触发
eq(sounds.length, 2, "第 2 音已触发");
eq(pr4.press(62), "hit", "按 D4 = hit");
now += 700; pr4._tick(); // pos=1.6：第3音(1.0)已触发，窗口到 2.2
eq(sounds.length, 4, "第 3 音(和弦,双音符)已触发 -> 累计4次发声");
eq(pr4.press(64), "hit", "和弦音 64 hit");
eq(pr4.press(67), "hit", "和弦音 67 hit");
pr4._tick(); // 触发完成检查
ok(completed != null, "全部命中后自动完成");
eq(completed.score, 100, "跟弹满分");
ok(completed.avgLatency != null, "记录了平均延迟");
ok(completed.wrong >= 1, "乱按计入错误");
pr4.stop();

// 跟弹模式漏音
const pr5 = new Practice(mkSeq(), { mode: "follow", onComplete: (s) => { completed = s; } });
pr5.start();
now += 100000; // 时间快进, 全部超窗
pr5._tick();
// 手动推进触发循环直到完成
for (let i = 0; i < 20 && !pr5.finished; i++) { now += 1000; pr5._tick(); }
ok(pr5.finished, "时间流逝后结束");
ok(completed.missed >= 3, "未弹的音记为漏");
console.log("   stats:", JSON.stringify({ score: completed.score, missed: completed.missed }));

// ---------- 6. noteName ----------
eq(Seq.noteName(60), "C4", "noteName(60)=C4");
eq(Seq.noteName(69), "A4", "noteName(69)=A4");
eq(Seq.noteName(21), "A0", "noteName(21)=A0");

console.log(`\n======== ${passed} passed, ${failed} failed ========`);
process.exit(failed ? 1 : 0);
