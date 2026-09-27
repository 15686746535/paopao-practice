// PianoCore.Sequence —— 统一音符序列
// 三种来源归一到一种表示: { events: [{t, dur, notes:[{midi, vel, hand}]}], totalTime, bpm }
//   t / dur 单位为秒（按曲谱自身速度），hand: 1=右手 2=左手
// 依赖: ABC 路径需要 G.ABCJS；MusicXML 路径需要 DOMParser（仅浏览器）
(function () {
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  const A = (G.PianoCore = G.PianoCore || {});
  const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  function noteName(midi) {
    return PC_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  // ============ MIDI 字节流解析 (SMF type 0/1) ============
  function parseMidi(bytes) {
    // 兼容: ArrayBuffer / Uint8Array / 普通数组 / abcjs binary 输出的 [字节数组]
    if (Array.isArray(bytes) && bytes.length === 1 && (Array.isArray(bytes[0]) || bytes[0] instanceof Uint8Array)) {
      bytes = bytes[0];
    }
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    let p = 0;
    const rd32 = () => (u8[p++] << 24) | (u8[p++] << 16) | (u8[p++] << 8) | u8[p++];
    const rd16 = () => (u8[p++] << 8) | u8[p++];
    const str = (n) => String.fromCharCode.apply(null, u8.subarray(p, (p += n)));

    if (str(4) !== "MThd") throw new Error("不是 MIDI 文件（缺少 MThd）");
    const hlen = rd32();
    const format = rd16();
    const ntrk = rd16();
    let division = rd16();
    if (division & 0x8000) {
      // SMPTE 时基: 高字节 = 每秒帧数(负值), 低字节 = 每帧 tick
      const fps = 256 - (division >> 8);
      division = fps * (division & 0xff) || 480;
    }
    p = 8 + hlen;

    const tempos = [{ tick: 0, uspq: 500000 }];
    const tracks = [];

    for (let t = 0; t < ntrk; t++) {
      // 允许中间夹杂未知块
      let id = str(4);
      let len = rd32();
      while (id !== "MTrk" && p < u8.length) {
        p += len;
        if (p + 8 > u8.length) break;
        id = str(4);
        len = rd32();
      }
      if (id !== "MTrk") break;
      const end = p + len;
      let tick = 0;
      let running = 0;
      const track = { name: "", notes: [] };
      const open = {}; // ch+note -> [{tick, vel}]
      const varlen = () => {
        let v = 0, b;
        do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80);
        return v;
      };
      while (p < end) {
        tick += varlen();
        let st = u8[p];
        if (st & 0x80) p++; else st = running; // running status
        if (st < 0x80) break;
        if ((st & 0xf0) !== 0xf0) running = st;
        const hi = st & 0xf0;
        if (st === 0xff) {
          const type = u8[p++];
          const mlen = varlen();
          const d0 = u8[p];
          if (type === 0x51 && mlen >= 3) {
            tempos.push({ tick, uspq: (u8[p] << 16) | (u8[p + 1] << 8) | u8[p + 2] });
          } else if (type === 0x03 && d0 !== 0) {
            try { track.name = String.fromCharCode.apply(null, u8.subarray(p, p + mlen)).trim(); } catch (e) { /* ignore */ }
          } else if (type === 0x59 && mlen >= 2) {
            track.keySig = [u8[p], u8[p + 1]];
          }
          p += mlen;
        } else if (st === 0xf0 || st === 0xf7) {
          p += varlen();
        } else if (hi === 0x90 || hi === 0x80) {
          const note = u8[p++] & 0x7f;
          const vel = u8[p++] & 0x7f;
          const ch = st & 0x0f;
          const key = ch * 128 + note;
          if (hi === 0x90 && vel > 0) {
            (open[key] = open[key] || []).push({ tick, vel });
          } else {
            const o = (open[key] || []).shift();
            if (o) track.notes.push({ on: o.tick, off: Math.max(tick, o.tick + 1), note, vel: o.vel, ch });
          }
        } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
          p += 2;
        } else if (hi === 0xc0 || hi === 0xd0) {
          p += 1;
        } else {
          p = end; // 不认识的字节，放弃该轨剩余部分
        }
      }
      tracks.push(track);
      p = end;
    }
    tempos.sort((a, b) => a.tick - b.tick);
    return { division: division || 480, format, tempos, tracks };
  }

  // tick -> 秒（分段 tempo）
  function makeTickToSec(midi) {
    const div = midi.division;
    const tp = midi.tempos;
    const segs = [];
    let acc = 0;
    for (let i = 0; i < tp.length; i++) {
      if (i > 0) acc += ((tp[i].tick - tp[i - 1].tick) * tp[i - 1].uspq) / div / 1e6;
      segs.push({ tick: tp[i].tick, sec: acc, uspq: tp[i].uspq });
    }
    return (tick) => {
      let s = segs[0];
      for (let i = segs.length - 1; i >= 0; i--) if (tick >= segs[i].tick) { s = segs[i]; break; }
      return s.sec + ((tick - s.tick) * s.uspq) / div / 1e6;
    };
  }

  // 轨道 -> 声部(hand)：先按轨道名，再按顺序/音高
  function handForTrack(track, idx, hasMulti) {
    const n = (track.name || "").toLowerCase();
    if (/left|bass|lh|左手| accompaniment/.test(n)) return 2;
    if (/right|melody|rh|右手|lead/.test(n)) return 1;
    if (!hasMulti) return 1;
    return idx === 0 ? 1 : 2;
  }

  // 音符散点 -> 事件（同一瞬间(±30ms)按下的音合成一个"同时按下"事件）
  function groupToEvents(notes) {
    notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
    const events = [];
    for (const n of notes) {
      const last = events[events.length - 1];
      if (last && n.t - last.t <= 0.03) {
        last.notes.push({ midi: n.midi, vel: n.vel, hand: n.hand });
        if (n.t + n.dur > last.t + last.dur) last.dur = n.t + n.dur - last.t;
      } else {
        events.push({ t: n.t, dur: n.dur, notes: [{ midi: n.midi, vel: n.vel, hand: n.hand }] });
      }
    }
    for (const ev of events) ev.notes.sort((a, b) => a.midi - b.midi);
    return events;
  }

  function midiToSequence(midi) {
    const t2s = makeTickToSec(midi);
    const noteTracks = midi.tracks.filter((t) => t.notes.length);
    const hasMulti = noteTracks.length > 1;
    const flat = [];
    noteTracks.forEach((track, idx) => {
      const hand = handForTrack(track, idx, hasMulti);
      for (const n of track.notes) {
        if (n.ch === 9) continue; // GM 打击乐通道(鼓组)不是琴键，转钢琴谱时丢弃
        const t = t2s(n.on);
        flat.push({ t, dur: Math.max(0.05, t2s(n.off) - t), midi: n.note, vel: n.vel, hand });
      }
    });
    const events = groupToEvents(flat);
    const totalTime = flat.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    const bpm = Math.round(60 / (makeTickToSec(midi)(midi.division) || 0.5));
    return { events, totalTime, bpm };
  }

  // ============ ABC ============
  function fromABC(abcText) {
    const ABCJS = G.ABCJS;
    if (!ABCJS || !ABCJS.synth || !ABCJS.synth.getMidiFile) {
      throw new Error("缺少 abcjs 库，无法解析 ABC");
    }
    let bytes;
    try {
      bytes = ABCJS.synth.getMidiFile(abcText, { midiOutputType: "binary" });
    } catch (e) {
      throw new Error("ABC 解析失败: " + e.message);
    }
    // 兼容多种返回形态: string / Uint8Array / [字节数组]
    if (Array.isArray(bytes) && bytes.length === 1 && (Array.isArray(bytes[0]) || bytes[0] instanceof Uint8Array)) {
      bytes = bytes[0];
    }
    if (typeof bytes === "string") bytes = Uint8Array.from(bytes, (c) => c.charCodeAt(0));
    const midi = parseMidi(bytes);
    const seq = midiToSequence(midi);
    // ABC 经 getMidiFile: 轨0=旋律(含声明音轨), 轨1=和弦符号的实现伴奏
    const bpm = Math.round(60 / (makeTickToSec(midi)(midi.division) || 0.5));
    seq.bpm = bpm > 20 && bpm < 300 ? bpm : 100;
    // 轨道重标记：ABC 的和弦伴奏轨归为左手
    return seq;
  }

  // ============ MusicXML ============
  const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function fromMusicXML(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("MusicXML 解析失败（文件损坏?）");
    const parts = Array.from(doc.getElementsByTagName("part"));
    if (!parts.length) throw new Error("MusicXML 中没有 part");

    let bpm = 100;
    const sound = doc.querySelector("sound[tempo]");
    if (sound) bpm = parseFloat(sound.getAttribute("tempo")) || 100;
    const metro = doc.querySelector("metronome per-minute");
    if (metro) bpm = parseFloat(metro.textContent) || bpm;
    if (!(bpm > 20 && bpm < 300)) bpm = 100;
    const spb = 60 / bpm; // 一拍秒数

    const flat = [];
    for (const part of parts) {
      let divisions = 1;
      let cursor = 0; // 单位: divisions
      let lastOnset = null;
      for (const measure of part.getElementsByTagName("measure")) {
        for (const el of measure.children) {
          if (el.tagName === "attributes") {
            const d = el.querySelector("divisions");
            if (d) divisions = parseFloat(d.textContent) || divisions;
          } else if (el.tagName === "direction") {
            const t = el.querySelector("sound[tempo]");
            if (t) {
              const v = parseFloat(t.getAttribute("tempo"));
              if (v > 20 && v < 300) { bpm = v; }
            }
          } else if (el.tagName === "backup") {
            cursor -= parseFloat(el.querySelector("duration").textContent);
            lastOnset = null;
          } else if (el.tagName === "forward") {
            cursor += parseFloat(el.querySelector("duration").textContent);
          } else if (el.tagName === "note") {
            const durEl = el.querySelector("duration");
            const dur = durEl ? parseFloat(durEl.textContent) : 0;
            const isChord = !!el.querySelector("chord");
            const isGrace = !!el.querySelector("grace");
            const isRest = !!el.querySelector("rest");
            const voiceEl = el.querySelector("voice");
            const staffEl = el.querySelector("staff");
            const voice = voiceEl ? parseInt(voiceEl.textContent, 10) || 0 : 0;
            const staff = staffEl ? parseInt(staffEl.textContent, 10) || 0 : 0;

            if (!isChord) lastOnset = cursor;
            const onset = lastOnset == null ? cursor : lastOnset;

            if (!isRest) {
              const pitch = el.querySelector("pitch");
              if (pitch) {
                const step = pitch.querySelector("step").textContent.trim();
                const alterEl = pitch.querySelector("alter");
                const alter = alterEl ? parseFloat(alterEl.textContent) || 0 : 0;
                const octave = parseInt(pitch.querySelector("octave").textContent, 10);
                const midi = (octave + 1) * 12 + STEP_PC[step] + Math.round(alter);
                const t = (onset / divisions) * spb;
                const dSec = isGrace ? 0.06 : Math.max(0.05, (dur / divisions) * spb);
                let hand = 0;
                if (staff === 1) hand = 1;
                else if (staff === 2) hand = 2;
                else hand = voice % 2 === 1 ? 1 : 2;
                flat.push({ t, dur: dSec, midi, vel: 100, hand });
              }
            }
            if (!isChord && !isGrace) cursor += dur;
          }
        }
      }
    }
    if (!flat.length) throw new Error("MusicXML 中没有音符");
    const events = groupToEvents(flat);
    const totalTime = flat.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    return { events, totalTime, bpm };
  }

  // ============ 序列 -> ABC（MIDI 导入用） ============
  // ABC 八度约定: C = 中央C(midi 60), c = 高八度(72), C, = 低八度(48)
  const WHITE_PC = { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B" };

  function abcLetter(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    let letter;
    if (WHITE_PC[pc] !== undefined) letter = WHITE_PC[pc];
    else letter = "^" + WHITE_PC[pc - 1]; // 升号拼写（K:C 下足够用）
    if (oct >= 5) return letter.toLowerCase() + "'".repeat(oct - 5);
    if (oct === 4) return letter;
    return letter + ",".repeat(4 - oct); // oct 3 -> "C,", oct 2 -> "C,,"
  }

  function toABC(seq, opts = {}) {
    const grid = 0.25; // 十六分音符（拍为单位）
    const beatsPerBar = opts.beatsPerBar || 4;
    const bpm = Math.round(seq.bpm || 100);
    const items = [];
    for (const ev of seq.events) {
      const beat = ev.t / (60 / bpm);
      const durBeats = Math.max(grid, ev.dur / (60 / bpm));
      const units = Math.max(1, Math.round(durBeats / grid));
      const tokens = ev.notes.map((n) => {
        const L = abcLetter(n.midi);
        return units > 1 ? L + units : L;
      });
      items.push({ beat: Math.round(beat / grid) * grid, tokens });
    }
    // 合并同一网格上的项
    const merged = [];
    for (const it of items) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.beat - it.beat) < 1e-6) last.tokens.push(...it.tokens);
      else merged.push({ beat: it.beat, tokens: it.tokens.slice(0, 6) });
    }
    const lines = [];
    let bar = [];
    let barStart = 0;
    for (const it of merged) {
      while (it.beat >= barStart + beatsPerBar) {
        lines.push(bar.join(" ") || "z");
        bar = [];
        barStart += beatsPerBar;
      }
      const chord = it.tokens.length > 1 ? "[" + it.tokens.join("") + "]" : it.tokens[0];
      bar.push(chord);
    }
    if (bar.length) lines.push(bar.join(" "));
    const header = [
      "X:1",
      "T:" + (opts.title || "MIDI 导入"),
      "M:" + beatsPerBar + "/4",
      "L:1/16",
      "Q:1/4=" + bpm,
      "K:C",
    ];
    return header.concat(lines.map((l) => l + " |")).join("\n");
  }

  // ============ ABC 轻量解析器（无 abcjs 依赖，供小程序 / 无 DOM 环境用） ============
  const KEY_SF = {
    C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
    F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
    Am: 0, Em: 1, Bm: 2, "F#m": 3, "C#m": 4, "G#m": 5, "D#m": 6,
    Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6,
  };
  const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
  const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
  const LITE_LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function fromAbcLite(abcText) {
    const lines = String(abcText).split(/\r?\n/);
    let L = 0.5; // 单位音符时值（拍）：L:1/8 = 半拍
    let bpm = 100;
    let sf = 0; // 调号升降号数量
    let inHeader = true;
    let voice = 0;
    let localBeat = 0; // 全曲拍位游标（跨行累计）
    const notes = []; // {beat, durBeats, midi, voice}
    let tiePending = false; // 显式 '-' 连音线标记

    const applyKey = (letter) => {
      if (sf > 0 && SHARP_ORDER.slice(0, sf).indexOf(letter) >= 0) return 1;
      if (sf < 0 && FLAT_ORDER.slice(0, -sf).indexOf(letter) >= 0) return -1;
      return 0;
    };
    const parseKey = (val) => {
      const mk = val.match(/^\s*([A-G])([#b]?)(m?)/i);
      if (!mk) return;
      const tonic = mk[1].toUpperCase() + (mk[2] || "");
      const minor = (mk[3] || "").toLowerCase() === "m";
      const lookup = minor ? tonic + "m" : tonic;
      sf = KEY_SF[lookup] !== undefined ? KEY_SF[lookup] : KEY_SF[tonic] || 0;
    };
    const parseL = (val) => {
      const m = val.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) L = (parseInt(m[1], 10) / parseInt(m[2], 10)) * 4;
    };
    const parseQ = (val) => {
      const mq = val.match(/(\d+)\s*\/\s*(\d+)\s*=\s*(\d+(?:\.\d+)?)/);
      if (mq) { bpm = (parseFloat(mq[3]) * 4 * parseInt(mq[1], 10)) / parseInt(mq[2], 10); return; }
      const mn = val.match(/(\d+(?:\.\d+)?)/);
      if (mn) bpm = parseFloat(mn[1]);
    };

    for (let li = 0; li < lines.length; li++) {
      let line = lines[li];
      const pct = line.indexOf("%");
      if (pct >= 0) line = line.slice(0, pct);
      const trimmed = line.trim();
      if (!trimmed) continue;
      const fld = trimmed.match(/^([A-Za-z]):\s*(.*)$/);
      if (fld) {
        const tag = fld[1], val = fld[2];
        if (tag === "K") { parseKey(val); inHeader = false; continue; }
        if (tag === "L") { parseL(val); continue; }
        if (tag === "Q") { parseQ(val); continue; }
        if (tag === "V") { if (!inHeader) voice = Math.max(0, (parseInt(val, 10) || voice + 2) - 1); continue; }
        if (["w", "W", "N", "s", "P", "I", "%%"].indexOf(tag) >= 0) continue;
        continue; // 其余头部字段（X/T/C/M…）对序列无影响
      }

      // ---- 音乐行 ----
      let i = 0;
      let pendingMult = 1; // 切分 < > 作用于下一个音
      const readDuration = () => {
        let m = 1, d = 1, num = "";
        while (i < line.length && /\d/.test(line[i])) num += line[i++];
        if (num) m = parseInt(num, 10);
        if (line[i] === "/") {
          i++;
          let den = "";
          while (i < line.length && /\d/.test(line[i])) den += line[i++];
          d = den ? parseInt(den, 10) : 2;
        }
        return { m, d };
      };

      while (i < line.length) {
        const ch = line[i];
        if (ch === '"') { // 和弦符号/注解 → 跳过
          const j = line.indexOf('"', i + 1);
          i = j > 0 ? j + 1 : line.length;
          continue;
        }
        if (ch === "[") {
          const close = line.indexOf("]", i + 1);
          const inner = close > 0 ? line.slice(i + 1, close) : "";
          if (/^[A-Za-z]+:/.test(inner)) { i = close > 0 ? close + 1 : line.length; continue; } // 行内字段
          // 和弦：同 onset 多音，时值取 ] 之后的数字
          const baseBeat = localBeat;
          let k = 0;
          const chordNotes = [];
          while (k < inner.length) {
            const cch = inner[k];
            if (!/[A-Ga-g]/.test(cch)) { k++; continue; }
            const pre = inner.slice(Math.max(0, k - 2), k).match(/[\^_=]+$/);
            let acc = 0;
            if (pre) acc = pre[0].includes("^") ? 1 : pre[0].includes("_") ? -1 : 0;
            const lower = cch === cch.toLowerCase();
            const letter = cch.toUpperCase();
            k++;
            let octShift = 0;
            while (k < inner.length && (inner[k] === "," || inner[k] === "'")) {
              octShift += inner[k] === "," ? -1 : 1;
              k++;
            }
            const pc = LITE_LETTER_PC[letter] + (acc !== 0 ? acc : applyKey(letter));
            const midi = ((lower ? 5 : 4) + octShift + 1) * 12 + pc;
            chordNotes.push({ beat: baseBeat, durBeats: L, midi, voice });
          }
          i = close > 0 ? close + 1 : line.length;
          if (chordNotes.length) {
            const dm = readDuration();
            const dur = (L * dm.m) / dm.d;
            for (const cn of chordNotes) cn.durBeats = dur;
            notes.push(...chordNotes);
            localBeat += dur;
          }
          continue;
        }
        if (ch === "|") { i++; continue; }
        if (ch === "z" || ch === "Z") {
          i++;
          const { m, d } = readDuration();
          localBeat += (L * m) / d;
          tiePending = false;
          continue;
        }
        if (ch === ">") {
          if (notes.length) {
            const ln = notes[notes.length - 1];
            const orig = ln.durBeats;
            ln.durBeats *= 1.5;
            localBeat += ln.durBeats - orig; // 延长前音后补偿游标
            pendingMult = 0.5;
          }
          i++;
          continue;
        }
        if (ch === "<") {
          if (notes.length) {
            const ln = notes[notes.length - 1];
            const orig = ln.durBeats;
            ln.durBeats *= 0.5;
            localBeat -= orig - ln.durBeats; // 缩短前音后回退游标
            pendingMult = 1.5;
          }
          i++;
          continue;
        }
        if (ch === "-") { tiePending = true; i++; continue; }
        if (/[A-Ga-g]/.test(ch)) {
          let acc = 0;
          while (i < line.length && "^_=".indexOf(line[i]) >= 0) {
            acc = line[i] === "^" ? 1 : line[i] === "_" ? -1 : 0;
            i++;
          }
          const lower = ch === ch.toLowerCase();
          const letter = ch.toUpperCase();
          i++;
          let octShift = 0;
          while (i < line.length && (line[i] === "," || line[i] === "'")) {
            octShift += line[i] === "," ? -1 : 1;
            i++;
          }
          const { m, d } = readDuration();
          let durBeats = (L * m) / d;
          if (pendingMult !== 1) { durBeats *= pendingMult; pendingMult = 1; }
          const pc = LITE_LETTER_PC[letter] + (acc !== 0 ? acc : applyKey(letter));
          const midi = ((lower ? 5 : 4) + octShift + 1) * 12 + pc;
          // 连音线：仅当显式 '-' 且音高相邻衔接时并入前音
          if (tiePending && notes.length) {
            const lastNote = notes[notes.length - 1];
            if (lastNote.midi === midi && Math.abs(lastNote.beat + lastNote.durBeats - localBeat) < 1e-6) {
              lastNote.durBeats += durBeats;
              localBeat += durBeats;
              tiePending = false;
              continue;
            }
          }
          tiePending = false;
          notes.push({ beat: localBeat, durBeats, midi, voice });
          localBeat += durBeats;
          continue;
        }
        i++;
      }
    }

    if (!notes.length) throw new Error("ABC 轻解析：未找到音符");
    const spb = 60 / (bpm > 20 && bpm < 300 ? bpm : 100);
    const flat = notes.map((n) => ({
      t: n.beat * spb,
      dur: Math.max(0.05, n.durBeats * spb),
      midi: n.midi,
      vel: 100,
      hand: n.voice % 2 === 0 ? 1 : 2,
    }));
    const events = groupToEvents(flat);
    const totalTime = flat.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    return { events, totalTime, bpm: Math.round(bpm) };
  }

  A.Sequence = { parseMidi, midiToSequence, fromABC, fromAbcLite, fromMusicXML, toABC, noteName, groupToEvents };
})();
