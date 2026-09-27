// 无头集成测试 v3：真实 bluetooth-shim 源码 + 真实 ble-h5.js 源码 + Capacitor 插件 mock
// mock 线格式逐字对齐插件源码（不再按假设！）：
//   - write 值 = 空格分隔小写十六进制（Conversion.kt stringToBytes / conversion.js dataViewToHexString）
//   - notification 事件负载 {value: 十六进制串}（Device.kt bytesToString）
//   - getServices 返回 {services:[...]} 包装对象（BluetoothLe.kt）
//   - addListener 同步返回 handle{remove}（真机形态）
// 用法：node shim-headless.test.js
const path = require("path");
const fs = require("fs");
const assert = require("assert");

global.window = global;
global.navigator = {};
const pluginListeners = new Map();
const HEX_RE = /^[0-9a-f]{2}( [0-9a-f]{2})*$/; // Kotlin toDigit 白名单格式

global.Capacitor = {
  Plugins: {
    BluetoothLe: {
      async initialize() {},
      async requestLEScan() { setTimeout(() => this.emit("onScanResult", { device: { deviceId: "AA:BB:CC:DD:EE:FF", name: "POP Piano Lite" }, rssi: -55, uuids: [] }), 200); },
      async stopLEScan() {},
      async requestDevice() { return { deviceId: "AA:BB:CC:DD:EE:FF", name: "POP Piano Lite" }; },
      addListener(ev, cb) {
        if (!pluginListeners.has(ev)) pluginListeners.set(ev, []);
        pluginListeners.get(ev).push(cb);
        return { remove: async () => pluginListeners.delete(ev) };
      },
      async connect() {},
      async getServices() {
        return {
          services: [
            {
              uuid: "03b80e5a-ede8-4b33-a751-6ce34ec4c700",
              characteristics: [
                { uuid: "7772e5db-3868-4112-a1a9-f2669d106bf3", properties: { write: true, writeWithoutResponse: true, notify: true }, descriptors: [] },
              ],
            },
          ],
        };
      },
      writes: [],
      async write(args) {
        // ★ 原生侧 hexToByte 对非十六进制字符 require(digit != -1) 会抛 IllegalArgumentException
        //   → 桥接层 rethrow RuntimeException → 真机闪退。这里等价复刻该校验，格式错就地失败。
        if (!HEX_RE.test(args.value)) throw new Error("NativeCrash(IllegalArgumentException): Invalid Hexadecimal Character in \"" + args.value + "\"");
        this.writes.push(args);
      },
      async startNotifications() {},
      async disconnect() {},
      emit: (key, payload) => (pluginListeners.get(key) || []).forEach((cb) => cb(payload)),
    },
    CrashLog: { last: async () => ({ content: "" }) },
  },
};

// 加载真实 shim 源码
new Function(fs.readFileSync(path.join(__dirname, "..", "piano-apk", "shim", "bluetooth-shim.js"), "utf8"))();

// 加载真实 ble-h5.js（剥 export 转可执行形态）
const src = fs.readFileSync(path.join(__dirname, "..", "piano-uniapp", "src", "utils", "ble-h5.js"), "utf8")
  .replace(/^export\s+/gm, "");
const PianoBLE = new Function(src + "\nreturn PianoBLE;")();

(async () => {
  const logs = [];
  PianoBLE.onLog = (t) => logs.push(t);
  const notes = [];
  PianoBLE.onPianoNote = (note, vel, on) => notes.push({ note, vel, on });

  const P = global.Capacitor.Plugins.BluetoothLe;
  const hex = (s) => s; // 已是十六进制串
  const t0 = Date.now();

  // 真实 connect()：扫描(自动命中) → GATT → 订阅 → 握手+激活+灯复位 三连写
  const name = await PianoBLE.connect();
  assert.equal(name, "POP Piano Lite");
  assert.ok(PianoBLE.connected, "connected 标志");
  assert.ok(logs.some((l) => l.includes("已连接：握手 + 灯激活完成")), "握手+激活日志: " + logs.join(" | "));

  // 写入必须是十六进制线格式（v1.0.9 闪退根因）
  const frames = P.writes.map((w) => w.value);
  for (const f of frames) assert.ok(HEX_RE.test(f), "写入为十六进制串: " + f);
  assert.ok(frames.some((f) => f === "80 80 f0 0c 01 73 7e f7"), "控制权握手帧(十六进制): " + frames[0]);
  assert.ok(frames.some((f) => f === "80 80 f0 50 00 00 00 00 00 f7"), "灯系统激活帧");
  assert.ok(frames.some((f) => f === "80 80 f0 4d 4c 4e 45 30 03 f7"), "灯复位帧");

  // 琴键回传：原生发【无分隔符大写】十六进制串（Conversion.kt toHexString 契约）
  // → [header][ts][NoteOn 3c 64] → onPianoNote
  const notiKey = "notification|AA:BB:CC:DD:EE:FF|03b80e5a-ede8-4b33-a751-6ce34ec4c700|7772e5db-3868-4112-a1a9-f2669d106bf3";
  P.emit(notiKey, { value: "8081" + "903C" + "64" });
  assert.deepStrictEqual(notes, [{ note: 60, vel: 100, on: true }], "琴键 NoteOn 解析回调（无分隔大写格式）");
  notes.length = 0;
  // 兼容：带空格小写格式同样可解析
  P.emit(notiKey, { value: "80 82 80 3c 00" });
  assert.deepStrictEqual(notes, [{ note: 60, vel: 0, on: false }], "NoteOff 解析（带空格小写格式）");

  // 试音写入
  const before = P.writes.length;
  await PianoBLE.testTone();
  assert.ok(P.writes.length - before >= 4, "试音写入序列");
  assert.ok(P.writes.slice(before).every((w) => HEX_RE.test(w.value)), "试音写入全为十六进制");

  // 断开
  PianoBLE.disconnect();
  assert.ok(!PianoBLE.connected, "断开复位");
  assert.ok(logs.some((l) => l.includes("连接已断开")), "断开日志");

  console.log(`PASS: 真实 shim + 真实 ble-h5 全链路通过（${Date.now() - t0}ms，${P.writes.length} 次写入，日志 ${logs.length} 条）`);
})().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
