// 总装：标签页、曲谱库、导入、播放控制、BLE、AI 生成、跟弹练习
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { activeScore: null, engine: null, practice: null }; // engine: 'abc' | 'xml'

  // ---------- 通用 ----------
  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  }
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // ---------- 曲谱库 ----------
  function renderLibrary() {
    const ul = $("libraryList");
    ul.innerHTML = "";
    for (const item of Library.all()) {
      const li = document.createElement("li");
      if (state.activeScore && state.activeScore.id === item.id) li.classList.add("active");
      const span = document.createElement("span");
      span.textContent = (item.demo ? "🎵 " : "📄 ") + item.name;
      span.onclick = () => loadScore(item);
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "删";
      del.onclick = (e) => { e.stopPropagation(); Library.remove(item.id); if (state.activeScore && state.activeScore.id === item.id) state.activeScore = null; renderLibrary(); };
      li.appendChild(span);
      li.appendChild(del);
      ul.appendChild(li);
    }
  }

  // ---------- 练习记录 ----------
  function renderRecords() {
    const ul = $("recordList");
    const recs = PianoCore.Records.last(null, 12);
    ul.innerHTML = "";
    if (!recs.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "还没有练习记录";
      ul.appendChild(li);
      return;
    }
    for (const r of recs) {
      const li = document.createElement("li");
      const d = new Date(r.ts);
      li.textContent = `${r.score} · ${r.mode === "wait" ? "等待" : "跟弹"}${r.handsLabel} · ${r.score}分 · ${d.getMonth() + 1}/${d.getDate()}`;
      li.title = `${r.score}  ${r.mode === "wait" ? "等待模式" : "跟弹评分"} ${r.handsLabel}\n命中 ${r.hits}/${r.total}，错按 ${r.wrong} 次${r.avgLatency != null ? "，平均延迟 " + r.avgLatency + "ms" : ""}`;
      ul.appendChild(li);
    }
  }

  // ---------- 打开曲谱 ----------
  function stopAll() {
    stopPractice(true);
    AbcPlayer.stop();
    XmlPlayer.stop();
    XmlPlayer.paused = false;
  }

  async function loadScore(score) {
    stopAll();
    state.activeScore = score;
    $("scoreTitle").textContent = "《" + score.name + "》" + (score.type === "abc" ? " · ABC" : " · MusicXML");
    $("emptyHint").classList.add("hidden");
    $("transportBar").classList.remove("hidden");
    $("practiceBar").classList.remove("hidden");

    try {
      if (score.type === "xml") {
        $("abcWrap").classList.add("hidden");
        $("xmlWrap").classList.remove("hidden");
        state.engine = "xml";
        const bpm = await XmlPlayer.load(score.content, $("xmlPaper"));
        $("chkMetro").disabled = false;
        toast(`已加载，默认速度 ${Math.round(bpm)} BPM`);
      } else {
        $("xmlWrap").classList.add("hidden");
        $("abcWrap").classList.remove("hidden");
        state.engine = "abc";
        AbcPlayer.render($("abcPaper"), score.content);
        $("chkMetro").disabled = true;
        $("chkMetro").checked = false;
        const ok = await AbcPlayer.setupSynth($("abcAudio"));
        if (!ok) toast("当前环境不支持音频合成，仅可看谱", true);
      }
      renderLibrary();
    } catch (e) {
      toast("曲谱加载失败: " + e.message, true);
    }
  }

  // ---------- 导入（批量 + 多格式） ----------
  function xmlTitle(text) {
    try {
      const doc = new DOMParser().parseFromString(text, "application/xml");
      const m = doc.querySelector("movement-title");
      const w = doc.querySelector("work-title");
      const t = (m && m.textContent.trim()) || (w && w.textContent.trim());
      return t || null;
    } catch (e) { return null; }
  }

  async function importOne(f) {
    const base = f.name.replace(/\.[^.]+$/, "");
    const ext = (f.name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
    if (ext === "abc" || ext === "txt") {
      const text = await f.text();
      if (!/^\s*X:/m.test(text)) throw new Error("不是 ABC 格式");
      const name = (text.match(/^T:\s*(.+)$/m) || [, base])[1].trim();
      return Library.add(name, "abc", text);
    }
    if (ext === "xml" || ext === "musicxml") {
      const text = await f.text();
      if (!/<score-partwise|<score-timewise/.test(text)) throw new Error("不是 MusicXML");
      return Library.add(xmlTitle(text) || base, "xml", text);
    }
    if (ext === "mxl") {
      const xml = await PianoCore.Mxl.mxlToXml(await f.arrayBuffer());
      return Library.add(xmlTitle(xml) || base, "xml", xml);
    }
    if (ext === "mid" || ext === "midi") {
      const parsed = PianoCore.Sequence.parseMidi(await f.arrayBuffer());
      const seq = PianoCore.Sequence.midiToSequence(parsed);
      if (!seq.events.length) throw new Error("MIDI 中没有音符");
      const abc = PianoCore.Sequence.toABC(seq, { title: base });
      return Library.add(base, "abc", abc);
    }
    throw new Error("不支持的格式 ." + ext);
  }

  $("btnImportFile").onclick = () => $("fileInput").click();
  $("fileInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    let okCount = 0;
    const fails = [];
    let lastItem = null;
    toast(`正在导入 ${files.length} 个文件...`);
    for (const f of files) {
      try {
        const item = await importOne(f);
        okCount++;
        lastItem = item;
      } catch (err) {
        fails.push(`${f.name}（${err.message}）`);
      }
    }
    renderLibrary();
    if (okCount === 1 && !fails.length && lastItem) {
      loadScore(lastItem);
      toast("导入成功：" + lastItem.name);
    } else {
      toast(`导入完成：成功 ${okCount} 首` + (fails.length ? `，失败 ${fails.length} 个：${fails.slice(0, 2).join("；")}${fails.length > 2 ? "…" : ""}` : ""), fails.length > 0);
    }
  });

  // ---------- 播放控制 ----------
  $("btnPlay").onclick = () => {
    if (!state.activeScore) return toast("请先打开曲谱", true);
    if (state.engine === "abc") AbcPlayer.play();
    else XmlPlayer.play().catch((e) => toast("播放失败: " + e.message, true));
  };
  $("btnPause").onclick = () => {
    if (state.engine === "abc") AbcPlayer.pause();
    else if (XmlPlayer.playing) XmlPlayer.paused ? XmlPlayer.resume() : XmlPlayer.pause();
  };
  $("btnStop").onclick = () => {
    if (state.engine === "abc") AbcPlayer.stop();
    else { XmlPlayer.stop(); XmlPlayer.resetCursor(); }
  };

  $("speedRange").addEventListener("input", (e) => {
    const v = +e.target.value;
    $("speedVal").textContent = v + "%";
    XmlPlayer._speed = v / 100;
    if (state.engine === "abc") AbcPlayer.setWarp(v);
  });

  $("chkLoop").addEventListener("change", (e) => {
    XmlPlayer.loop = e.target.checked;
    if (state.engine === "abc" && AbcPlayer.controller && AbcPlayer.controller.toggleLoop) {
      try { AbcPlayer.controller.toggleLoop(); } catch (err) { /* ignore */ }
    }
  });
  $("chkMetro").addEventListener("change", (e) => { XmlPlayer.metronome = e.target.checked; });
  $("chkSendPiano").addEventListener("change", (e) => {
    XmlPlayer.sendPiano = e.target.checked;
    state.sendPianoAbc = e.target.checked;
  });
  $("chkLights").addEventListener("change", (e) => {
    XmlPlayer.lights = e.target.checked;
    state.lightsAbc = e.target.checked;
    if (!e.target.checked && PianoBLE.connected) PianoBLE.lightsClear();
  });

  // ABC 播放事件 → 发琴
  AbcPlayer.onNoteEvent = (pitches) => {
    if (!PianoBLE.connected) return;
    const usePiano = state.sendPianoAbc, useLights = state.lightsAbc;
    if (state._abcPrev) {
      for (const m of state._abcPrev) {
        if (usePiano) PianoBLE.noteOff(m);
        if (useLights) PianoBLE.lightOff(m);
      }
    }
    state._abcPrev = pitches;
    for (const m of pitches) {
      if (usePiano) PianoBLE.noteOn(m, 100);
      if (useLights) PianoBLE.lightOn(m);
    }
  };
  AbcPlayer.onEnd = () => {
    if (state._abcPrev && PianoBLE.connected) {
      for (const m of state._abcPrev) {
        if (state.sendPianoAbc) PianoBLE.noteOff(m);
        if (state.lightsAbc) PianoBLE.lightOff(m);
      }
    }
    state._abcPrev = null;
  };

  // ---------- 跟弹练习 ----------
  const HANDS_LABEL = { both: "双手", "1": "右手", "2": "左手" };

  function noteNames(ev) {
    if (!ev) return "";
    return ev.notes.map((n) => PianoCore.Sequence.noteName(n.midi)).join(" ");
  }

  function updatePrUI() {
    const p = state.practice;
    if (!p) return;
    const s = p.stats();
    const cur = p.events[Math.max(0, p.mode === "follow" ? p._triggeredCount - 1 : p.idx)];
    $("prNext").textContent = p.mode === "wait" ? "▶ " + noteNames(p.events[p.idx]) : "";
    $("prCount").textContent = `${Math.min(p.idx, p.total)}/${p.total} · ✔${s.hits} ◐${s.partial} ✘错按${s.wrong}`;
  }

  function practiceLockUI(lock) {
    ["btnPlay", "btnPause", "btnStop", "btnPractice", "practiceMode", "practiceHands", "speedRange"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = lock;
    });
  }

  function endPracticeUI() {
    state.practice = null;
    $("practiceStatus").classList.add("hidden");
    $("practiceBar").classList.remove("hidden");
    practiceLockUI(false);
  }

  function stopPractice(silent) {
    const p = state.practice;
    if (!p) return;
    if (silent) p.onComplete = () => {};
    p.stop();
  }

  function startPractice() {
    const score = state.activeScore;
    if (!score) return toast("请先打开曲谱", true);
    if (state.practice) return;
    if (!PianoBLE.connected) return toast("请先连接钢琴（练习判定靠琴回传的按键）", true);
    stopPractice(true);
    stopAll();

    let seq;
    try {
      seq = score.type === "xml"
        ? PianoCore.Sequence.fromMusicXML(score.content)
        : PianoCore.Sequence.fromABC(score.content);
    } catch (e) {
      return toast("无法解析该曲谱: " + e.message, true);
    }
    if (!seq.events.length) return toast("曲谱里没有可练习的音符", true);

    const mode = $("practiceMode").value;
    const hands = $("practiceHands").value;
    const speed = +$("speedRange").value / 100;

    state.practice = new PianoCore.Practice(seq, {
      mode,
      hands,
      speed,
      ble: PianoBLE,
      sound: mode === "follow" ? AppSynth : null,
      onWrong: () => updatePrUI(),
      onAdvance: () => updatePrUI(),
      onProgress: () => updatePrUI(),
      onState: (t) => { $("prState").textContent = t; },
      onComplete: (stats, aborted) => {
        endPracticeUI();
        showPrResult(score, mode, hands, stats, aborted);
      },
    });
    $("practiceBar").classList.add("hidden");
    $("practiceStatus").classList.remove("hidden");
    practiceLockUI(true);
    updatePrUI();
    state.practice.start();
    toast(mode === "wait" ? "等待模式开始：亮灯的键弹下去" : "跟弹评分开始：跟着琴声一起弹");
  }

  function showPrResult(score, mode, hands, stats, aborted) {
    $("prScoreName").textContent = `《${score.name}》${mode === "wait" ? "等待模式" : "跟弹评分"} · ${HANDS_LABEL[hands]}`;
    $("prScore").textContent = stats.score;
    const rows = [
      `完整命中 ${stats.hits} / ${stats.total} 组`,
      stats.partial ? `部分命中 ${stats.partial} 组` : null,
      stats.missed ? `漏弹 ${stats.missed} 个音` : null,
      stats.wrong ? `错按 ${stats.wrong} 次` : "没有错按 🎉",
      stats.avgLatency != null ? `平均反应 ${stats.avgLatency}ms` : null,
    ].filter(Boolean);
    $("prSummary").innerHTML = rows.map((r) => `<span>${r}</span>`).join("");
    const wn = Object.entries(stats.wrongNotes).sort((a, b) => b[1] - a[1]).slice(0, 6);
    $("prWrongNotes").textContent = wn.length
      ? "常错键：" + wn.map(([m, c]) => `${PianoCore.Sequence.noteName(+m)}×${c}`).join("  ")
      : "";
    $("prResult").classList.remove("hidden");

    if (!aborted) {
      PianoCore.Records.add({
        score: score.name,
        mode, hands,
        handsLabel: HANDS_LABEL[hands],
        score: stats.score,
        hits: stats.hits,
        total: stats.total,
        wrong: stats.wrong,
        avgLatency: stats.avgLatency,
      });
      renderRecords();
    }
  }

  $("btnPractice").onclick = startPractice;
  $("btnPrEnd").onclick = () => { if (state.practice) state.practice.stop(); };
  $("btnPrSkip").onclick = () => { if (state.practice) { state.practice.skip(); updatePrUI(); } };
  $("btnPrClose").onclick = () => $("prResult").classList.add("hidden");
  $("btnPrAgain").onclick = () => {
    $("prResult").classList.add("hidden");
    setTimeout(startPractice, 60);
  };

  // 琴键回传 → 判定
  PianoBLE.onPianoNote = (midi, vel, isOn) => {
    if (!state.practice) return;
    if (isOn) {
      const r = state.practice.press(midi, vel);
      if (r === "hit") updatePrUI();
    } else {
      state.practice.release(midi);
    }
  };

  // ---------- 云曲库 ----------
  let cloudCache = {};
  async function renderCloud() {
    const cat = $("cloudCat").value;
    const ul = $("cloudList");
    ul.innerHTML = "<li class='cloud-loading'>加载中…</li>";
    try {
      if (!cloudCache[cat]) {
        const res = await fetch(`library/${cat}.json`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        cloudCache[cat] = (await res.json()).tunes || [];
      }
      const tunes = cloudCache[cat];
      ul.innerHTML = "";
      if (!tunes.length) {
        ul.innerHTML = "<li class='cloud-loading'>该分类暂无曲目</li>";
        return;
      }
      for (const t of tunes) {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = t.name;
        span.onclick = () => {
          const exist = Library.all().find((x) => x.name === t.name);
          const item = exist || Library.add(t.name, "abc", t.content);
          loadScore(item);
          if (!exist) toast("已加入曲谱库：" + t.name);
        };
        li.appendChild(span);
        ul.appendChild(li);
      }
    } catch (e) {
      ul.innerHTML = "<li class='cloud-loading'>加载失败（离线?）</li>";
    }
  }
  $("cloudCat").addEventListener("change", renderCloud);

  // ---------- 钢琴连接 ----------
  function bleStatusUpdate() {
    const el = $("bleStatus");
    if (PianoBLE.connected) {
      el.textContent = "已连接 " + (PianoBLE.device && PianoBLE.device.name ? PianoBLE.device.name : "");
      el.className = "ble-status on";
      $("btnBle").textContent = "⛔ 断开钢琴";
      $("btnBleTest").hidden = false;
      $("btnBleLight").hidden = false;
    } else {
      el.textContent = "未连接";
      el.className = "ble-status off";
      $("btnBle").textContent = "🔗 连接钢琴";
      $("btnBleTest").hidden = true;
      $("btnBleLight").hidden = true;
    }
  }
  PianoBLE.onLog = (text) => {
    const log = $("bleLog");
    log.hidden = false;
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    log.textContent += `[${ts}] ${text}\n`;
    while (log.textContent.split("\n").length > 200) log.textContent = log.textContent.split("\n").slice(1).join("\n");
    log.scrollTop = log.scrollHeight;
  };
  PianoBLE.onDisconnect = () => {
    bleStatusUpdate();
    if (state.practice) { stopPractice(true); endPracticeUI(); toast("钢琴已断开，练习中止", true); }
  };

  $("btnBle").onclick = async () => {
    if (PianoBLE.connected) { PianoBLE.disconnect(); bleStatusUpdate(); return; }
    try {
      const name = await PianoBLE.connect();
      bleStatusUpdate();
      ["chkSendPiano", "chkLights"].forEach((id) => {
        const cb = $(id);
        if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
      });
      toast("钢琴已连接: " + name + "，已开启琴发声/跟灯");
    } catch (e) {
      if (e.name === "NotFoundError") toast("没有选择设备或未找到钢琴");
      else toast("连接失败: " + e.message, true);
    }
  };

  $("btnBleTest").onclick = async () => {
    try {
      const err = await PianoBLE.testTone();
      if (err) toast("试音失败: " + err, true);
      else toast("已发送测试音，琴应该响了一声并亮灯");
    } catch (e) {
      toast("试音失败: " + e.message, true);
    }
  };

  $("btnBleLight").onclick = async () => {
    try {
      $("bleLog").hidden = false;
      toast("开始灯协议探测（约 12 秒），盯着琴键看哪一步亮灯");
      const err = await PianoBLE.probeLights();
      if (err) toast("探测中有写入失败: " + err, true);
      else toast("探测完成：琴亮灯时日志里对应序号是多少？");
    } catch (e) {
      toast("试灯失败: " + e.message, true);
    }
  };

  // ---------- AI 写谱 ----------
  let aiAbc = null;

  function renderPreview(abc) {
    aiAbc = abc;
    const paper = $("aiPaper");
    paper.innerHTML = "";
    ABCJS.renderAbc(paper, abc, { add_classes: true, responsive: "resize" });
    $("btnAiUse").disabled = false;
    $("btnAiSave").disabled = false;
  }
  function aiStatus(msg, ok) {
    const el = $("aiStatus");
    el.hidden = false;
    el.textContent = msg;
    el.className = "ai-status" + (ok ? " ok" : "");
  }

  $("btnGenLocal").onclick = () => {
    try {
      const abc = Generator.generate({
        style: $("genStyle").value,
        key: $("genKey").value,
        time: $("genTime").value,
        bars: +$("genBars").value,
        diff: +$("genDiff").value,
      });
      switchTab("ai");
      renderPreview(abc);
      aiStatus("已生成（离线算法），可直接用作练习曲谱", true);
    } catch (e) {
      aiStatus("生成失败: " + e.message, false);
    }
  };

  $("btnGenAI").onclick = async (e) => {
    const cfg = {
      base: $("aiBase").value.trim(),
      model: $("aiModel").value.trim(),
      apiKey: $("aiKey").value.trim(),
      prompt: $("aiPrompt").value.trim(),
    };
    if (!cfg.apiKey) return aiStatus("请先填写 API Key（离线生成不需要）", false);
    localStorage.setItem("pp_ai", JSON.stringify({ base: cfg.base, model: cfg.model }));
    const btn = e.target;
    btn.disabled = true;
    aiStatus("正在请求大模型...", true);
    try {
      const abc = await AIGen.generate(cfg);
      switchTab("ai");
      renderPreview(abc);
      aiStatus("AI 生成完成", true);
    } catch (err) {
      aiStatus("AI 生成失败: " + err.message, false);
    } finally {
      btn.disabled = false;
    }
  };

  $("btnAiUse").onclick = () => {
    if (!aiAbc) return;
    const name = (aiAbc.match(/^T:(.+)$/m) || [, "AI 曲谱"])[1].trim();
    loadScore({ id: null, name, type: "abc", content: aiAbc });
    switchTab("practice");
  };
  $("btnAiSave").onclick = () => {
    if (!aiAbc) return;
    const name = (aiAbc.match(/^T:(.+)$/m) || [, "AI 曲谱"])[1].trim();
    Library.add(name, "abc", aiAbc);
    renderLibrary();
    toast("已保存到曲谱库");
  };

  // ---------- 初始化 ----------
  const savedAi = localStorage.getItem("pp_ai");
  if (savedAi) {
    try {
      const s = JSON.parse(savedAi);
      if (s.base) $("aiBase").value = s.base;
      if (s.model) $("aiModel").value = s.model;
    } catch (e) { /* ignore */ }
  }
  XmlPlayer._speed = 1;
  Library.ensureStarter();
  renderLibrary();
  renderRecords();
  renderCloud();
  const first = Library.all()[0];
  if (first) loadScore(first);

  // 自动化测试/调试钩子（不影响正常使用）—— 注入真实 BLE-MIDI 帧格式
  window.__ppState = state;
  window.__press = (midi, vel = 100) => PianoBLE._rx(new Uint8Array([0x80, 0x82, 0x90, midi & 0x7f, vel & 0x7f]));
})();
