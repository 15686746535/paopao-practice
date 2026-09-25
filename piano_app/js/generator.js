// 离线算法作曲：按风格/调性/拍号/难度生成 ABC 记谱
const Generator = (function () {
  // 各调性的音级拼写（pitch-class → 音名），K: 调号会自动处理升降号
  const KEYS = {
    C:  { tonicMidi: 60, pc: { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B" }, qpm: 96 },
    G:  { tonicMidi: 67, pc: { 7: "G", 9: "A", 11: "B", 0: "C", 2: "D", 4: "E", 6: "F" }, qpm: 100 },
    D:  { tonicMidi: 62, pc: { 2: "D", 4: "E", 6: "F", 7: "G", 9: "A", 11: "B", 1: "C" }, qpm: 104 },
    F:  { tonicMidi: 65, pc: { 5: "F", 7: "G", 9: "A", 10: "B", 0: "C", 2: "D", 4: "E" }, qpm: 92 },
    Am: { tonicMidi: 57, pc: { 9: "A", 11: "B", 0: "C", 2: "D", 4: "E", 5: "F", 7: "G" }, qpm: 88, minor: true },
    Em: { tonicMidi: 64, pc: { 4: "E", 6: "F", 7: "G", 9: "A", 11: "B", 0: "C", 2: "D" }, qpm: 92, minor: true },
  };
  // 半音阶（自然大调/自然小调音级内已包含）
  const SEMIS = [0, 2, 4, 5, 7, 9, 11]; // 大调音级
  const SEMIS_MINOR = [0, 2, 3, 5, 7, 8, 10]; // 小调音级

  const PROGS = {
    nursery: [0, 0, 3, 0, 4, 4, 0, 0],   // I I IV I  V V I I
    pop: [0, 4, 5, 3],                    // I V vi IV
    etude: [0, 3, 4, 0],                  // I IV V I
  };
  // 节奏模式池：按拍号和难度分组
  const RHYTHMS = {
    4: {
      1: [[1, 1, 1, 1], [1, 1, 2], [2, 2], [1, 1, 1, 1]],
      2: [[1, 1, 1, 1], [0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 1, 1], [2, 1, 1], [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 1, 2]],
      3: [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [0.5, 0.5, 1.5, 0.5, 1], [0.5, 0.5, 0.5, 0.5, 2], [1, 0.5, 0.5, 0.5, 0.5, 1], [1.5, 0.5, 2]],
    },
    3: {
      1: [[1, 1, 1], [2, 1], [1, 2], [1, 1, 1]],
      2: [[0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1], [2, 0.5, 0.5], [0.5, 0.5, 2], [1, 1, 1], [1, 2]],
      3: [[1.5, 0.5, 1], [0.5, 0.5, 1.5, 0.5], [1, 1.5, 0.5], [0.5, 0.5, 0.5, 0.5, 1], [1.5, 1.5], [2, 0.5, 0.5]],
    },
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function rhythmFor(diff, beatsPerBar, reuse) {
    const pool = RHYTHMS[beatsPerBar][diff];
    if (reuse && Math.abs(reuse.reduce((a, b) => a + b, 0) - beatsPerBar) < 0.01 && Math.random() < 0.5) return reuse.slice();
    return (pool && pool.length ? pick(pool) : [beatsPerBar]).slice();
  }

  // 音级索引(绝对) → MIDI。idx 以主音=0 起，每 7 个升一个八度
  function idxToMidi(key, minor, idx) {
    const semis = minor ? SEMIS_MINOR : SEMIS;
    const oct = Math.floor(idx / 7);
    const deg = ((idx % 7) + 7) % 7;
    return key.tonicMidi + semis[deg] + 12 * oct;
  }
  function midiToAbc(key, midi) {
    const letter = key.pc[((midi % 12) + 12) % 12];
    const oct = Math.floor(midi / 12) - 1; // 60 → 4
    if (oct === 4) return letter;
    if (oct === 5) return letter.toLowerCase();
    if (oct === 3) return letter + ",";
    if (oct === 6) return letter.toLowerCase() + "'";
    if (oct === 2) return letter + ",,";
    return letter.toLowerCase() + "''";
  }
  function durAbc(d) { // L:1/4 下，1=四分
    if (d === 1) return "";
    if (d === 2) return "2";
    if (d === 0.5) return "/2";
    if (d === 1.5) return "3/2";
    if (d === 3) return "3";
    return String(d);
  }

  function generate(opts) {
    const key = KEYS[opts.key] || KEYS.C;
    const minor = !!key.minor;
    const beatsPerBar = opts.time === "3/4" ? 3 : 4;
    const bars = opts.bars;
    const diff = opts.diff;
    const prog = PROGS[opts.style];

    // 每小节和弦：和弦根音的音级索引（含 3 度 5 度）
    const chordOf = (rootDeg) => [rootDeg, rootDeg + 2, rootDeg + 4];
    const LO = -3, HI = 10; // 音级索引范围（约两个半八度）

    let barsOut = [];
    let prevIdx = 7 + (minor ? 0 : 0); // 从主音高八度附近开始
    let reusedRhythm = null;

    for (let b = 0; b < bars; b++) {
      const rootDeg = prog[b % prog.length];
      const chord = chordOf(rootDeg);
      // 小节内的节奏：前 4 小节的节奏在后段复用，形成动机感
      if (b % 4 === 0) reusedRhythm = null;
      const rhythm = rhythmFor(diff, beatsPerBar, reusedRhythm || (b < 4 ? null : barsOut[b % 4] && barsOut[b % 4].rhythm));
      if (b % 4 === 0) reusedRhythm = rhythm;

      let t = 0, tokens = [];
      const isLastBar = b === bars - 1;

      for (let ri = 0; ri < rhythm.length; t += rhythm[ri], ri++) {
        const d = rhythm[ri];
        const strong = t === 0 || (beatsPerBar === 4 && t === 2);
        let idx;

        if (isLastBar && (t === 0 || ri === rhythm.length - 1)) {
          idx = 7; // 结束在主音
        } else if (strong || diff === 1) {
          // 强拍落在和弦音：选离 prevIdx 最近的和弦音
          const candidates = [];
          for (const c of chord) {
            for (let o = -7; o <= 14; o += 7) {
              const cand = c + o;
              if (cand >= LO && cand <= HI) candidates.push(cand);
            }
          }
          candidates.sort((a, b2) => Math.abs(a - prevIdx) - Math.abs(b2 - prevIdx));
          idx = candidates[Math.random() < 0.75 ? 0 : Math.min(1, candidates.length - 1)];
        } else {
          // 弱拍：级进为主
          const steps = pick([1, -1, 1, -1, 2, -2, 3, -3]);
          idx = Math.max(LO, Math.min(HI, prevIdx + steps));
        }
        idx = Math.max(LO, Math.min(HI, idx));
        prevIdx = idx;
        tokens.push(midiToAbc(key, idxToMidi(key, minor, idx)) + durAbc(d));
      }
      barsOut.push({ rhythm, tokens });
    }

    const lines = [];
    lines.push("X:1");
    lines.push("T:AI练习曲 " + new Date().toLocaleDateString("zh-CN"));
    lines.push("M:" + opts.time);
    lines.push("L:1/4");
    lines.push("Q:1/4=" + key.qpm);
    lines.push("K:" + (opts.key.endsWith("m") ? opts.key.slice(0, 1) + "m" : opts.key));

    let cur = [];
    for (const bar of barsOut) {
      cur.push(bar.tokens.join(" "));
      if (cur.length === 4) { lines.push(cur.join(" | ") + " |"); cur = []; }
    }
    if (cur.length) lines.push(cur.join(" | ") + (barsOut.length % 4 === 0 ? "|" : "]"));
    return lines.join("\n");
  }

  return { generate, KEYS };
})();
