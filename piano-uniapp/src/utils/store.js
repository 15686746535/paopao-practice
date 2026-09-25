// 曲谱库（uni 存储）+ 内置入门曲库（公有领域曲目 / 自制练习）
const KEY = "pp_library_v1";
const STARTER_FLAG = "pp_starter_v1";

const abc = (lines) => lines.join("\n");

export const BUILTINS = [
  {
    id: "st小星星", demo: true, type: "abc", name: "小星星",
    content: abc(["X:1", "T:小星星", "M:4/4", "L:1/4", "Q:1/4=100", "K:C",
      "C C G G | A A G2 | F F E E | D D C2 | G G F F | E E D2 |",
      "G G F F | E E D2 | C C G G | A A G2 | F F E E | D D C2 |]"]),
  },
  {
    id: "st欢乐颂", demo: true, type: "abc", name: "欢乐颂",
    content: abc(["X:1", "T:欢乐颂", "M:4/4", "L:1/4", "Q:1/4=108", "K:C",
      "E E F G | G F E D | C C D E | E D D2 | E E F G | G F E D |",
      "C C D E | D C C2 |"]),
  },
  {
    id: "st两只老虎", demo: true, type: "abc", name: "两只老虎",
    content: abc(["X:1", "T:两只老虎", "M:4/4", "L:1/4", "Q:1/4=120", "K:C",
      "C D E C | C D E C | E F G2 | E F G2 |",
      "G/2A/2G/2F/2 E C | G/2A/2G/2F/2 E C | C G, C2 | C G, C2 |]"]),
  },
  {
    id: "st小蜜蜂", demo: true, type: "abc", name: "小蜜蜂",
    content: abc(["X:1", "T:小蜜蜂", "M:4/4", "L:1/4", "Q:1/4=110", "K:C",
      "G E E2 | F D D2 | C D E F | G G G2 |",
      "G E E2 | F D D2 | C E G G | E4 |]"]),
  },
  {
    id: "st生日快乐", demo: true, type: "abc", name: "生日快乐",
    content: abc(["X:1", "T:生日快乐", "M:3/4", "L:1/4", "Q:1/4=100", "K:C",
      "G/2G/2 | A G C' | B2 G/2G/2 | A G D' | C2 G/2G/2 |",
      "G' E' C' | B A F'/2F'/2 | E' C' D' | C3 |]"]),
  },
  {
    id: "st卡农", demo: true, type: "abc", name: "卡农·主题 (D大调)",
    content: abc(["X:1", "T:卡农·主题 (D大调)", "M:4/4", "L:1/4", "Q:1/4=90", "K:D",
      "F#2 E2 | D2 C#2 | B2 A2 | B2 C#2 |",
      "D2 C#2 | B2 A2 | G2 F#2 | G2 E2 |]"]),
  },
  {
    id: "st音阶", demo: true, type: "abc", name: "C大调音阶（上下行）",
    content: abc(["X:1", "T:C大调音阶（上下行）", "M:4/4", "L:1/4", "Q:1/4=90", "K:C",
      "C D E F | G A B c | c B A G | F E D C |]"]),
  },
  {
    id: "st琶音", demo: true, type: "abc", name: "C大调短琶音",
    content: abc(["X:1", "T:C大调短琶音", "M:4/4", "L:1/4", "Q:1/4=90", "K:C",
      "C E G c | c G E C | C E G c | c G E C |]"]),
  },
];

export function allScores() {
  let list = [];
  try {
    const raw = uni.getStorageSync(KEY);
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === "string" && raw) list = JSON.parse(raw);
  } catch (e) { list = []; }
  if (!Array.isArray(list) || !list.length) {
    list = BUILTINS.slice();
    save(list);
  }
  return list;
}

function save(list) { uni.setStorageSync(KEY, JSON.stringify(list)); }

export function addScore(name, type, content, extra = {}) {
  const list = allScores();
  const item = { id: "u" + Date.now(), name, type, content, ...extra };
  list.unshift(item);
  save(list);
  return item;
}

export function removeScore(id) {
  save(allScores().filter((x) => x.id !== id));
}
