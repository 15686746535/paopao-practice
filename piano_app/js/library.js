// 曲谱库：localStorage 持久化 + 内置示例曲
const Library = {
  KEY: "pp_library_v1",

  DEMOS: [
    {
      name: "小星星",
      type: "abc",
      content: [
        "X:1", "T:小星星", "M:4/4", "L:1/4", "Q:1/4=100", "K:C",
        "C C G G | A A G2 | F F E E | D D C2 | G G F F | E E D2 |",
        "G G F F | E E D2 | C C G G | A A G2 | F F E E | D D C2 |]",
      ].join("\n"),
    },
    {
      name: "欢乐颂",
      type: "abc",
      content: [
        "X:1", "T:欢乐颂", "M:4/4", "L:1/4", "Q:1/4=108", "K:C",
        "E E F G | G F E D | C C D E | E D D2 | E E F G | G F E D |",
        "C C D E | D C C2 |",
      ].join("\n"),
    },
    {
      name: "两只老虎",
      type: "abc",
      content: [
        "X:1", "T:两只老虎", "M:4/4", "L:1/4", "Q:1/4=120", "K:C",
        "C D E C | C D E C | E F G2 | E F G2 |",
        "G/2A/2G/2F/2 E C | G/2A/2G/2F/2 E C | C G, C2 | C G, C2 |]",
      ].join("\n"),
    },
  ],

  // 扩展入门包（公有领域曲目 + 基础练习），首次运行自动补进曲库
  STARTER: [
    {
      name: "小蜜蜂",
      type: "abc",
      content: [
        "X:1", "T:小蜜蜂", "M:4/4", "L:1/4", "Q:1/4=110", "K:C",
        "G E E2 | F D D2 | C D E F | G G G2 |",
        "G E E2 | F D D2 | C E G G | E4 |]",
      ].join("\n"),
    },
    {
      name: "生日快乐",
      type: "abc",
      content: [
        "X:1", "T:生日快乐", "M:3/4", "L:1/4", "Q:1/4=100", "K:C",
        "G/2G/2 | A G C' | B2 G/2G/2 | A G D' | C2 G/2G/2 |",
        "G' E' C' | B A F'/2F'/2 | E' C' D' | C3 |]",
      ].join("\n"),
    },
    {
      name: "卡农·主题 (D大调)",
      type: "abc",
      content: [
        "X:1", "T:卡农·主题 (D大调)", "M:4/4", "L:1/4", "Q:1/4=90", "K:D",
        "F#2 E2 | D2 C#2 | B2 A2 | B2 C#2 |",
        "D2 C#2 | B2 A2 | G2 F#2 | G2 E2 |]",
      ].join("\n"),
    },
    {
      name: "C大调音阶（上下行）",
      type: "abc",
      content: [
        "X:1", "T:C大调音阶（上下行）", "M:4/4", "L:1/4", "Q:1/4=90", "K:C",
        "C D E F | G A B c | c B A G | F E D C |]",
      ].join("\n"),
    },
    {
      name: "C大调短琶音",
      type: "abc",
      content: [
        "X:1", "T:C大调短琶音", "M:4/4", "L:1/4", "Q:1/4=90", "K:C",
        "C E G c | c G E C | C E G c | c G E C |]",
      ].join("\n"),
    },
    {
      name: "五指热身操",
      type: "abc",
      content: [
        "X:1", "T:五指热身操", "M:4/4", "L:1/8", "Q:1/4=80", "K:C",
        "C D E F G F E D | C D E F G4 |",
        "G A B c d c B A | G A B c d4 |",
        "d c B A G A B A | G F E D C4 |]",
      ].join("\n"),
    },
  ],

  ensureStarter() {
    let flag = null;
    try { flag = localStorage.getItem("pp_starter_v2"); } catch (e) { /* ignore */ }
    if (flag) return;
    try { localStorage.setItem("pp_starter_v2", "1"); } catch (e) { /* ignore */ }
    const list = this.all();
    const have = new Set(list.map((x) => x.name));
    let added = 0;
    for (const s of this.STARTER) {
      if (!have.has(s.name)) {
        list.push({ id: "st" + s.name, ...s, demo: true });
        added++;
      }
    }
    if (added) this.save(list);
  },

  all() {
    let list = null;
    try { list = JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { /* ignore */ }
    if (!Array.isArray(list)) {
      list = this.DEMOS.map((d, i) => ({ id: "demo" + i, ...d, demo: true }));
      this.save(list);
    }
    return list;
  },

  save(list) {
    localStorage.setItem(this.KEY, JSON.stringify(list));
  },

  add(name, type, content) {
    const list = this.all();
    const item = { id: "u" + Date.now(), name, type, content };
    list.unshift(item);
    this.save(list);
    return item;
  },

  remove(id) {
    const list = this.all().filter((x) => x.id !== id);
    this.save(list);
  },
};
