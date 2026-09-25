// 验证三个真实文件里的 _rx 解析器
global.window = global;
const fs = require("fs");

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log("  ✓", msg); } else { failed++; console.log("  ✗ FAIL:", msg); } }

// 旧 H5 版：new Function 包一层拿到 PianoBLE
const bleOld = new Function(fs.readFileSync("D:/钢琴/piano_app/js/ble.js", "utf8") + "; return PianoBLE;")();

async function main() {
  // uni 版：ESM import
  const h5 = await import("file:///D:/钢琴/piano-uniapp/src/utils/ble-h5.js");
  const mp = await import("file:///D:/钢琴/piano-uniapp/src/utils/ble-mp.js");

  for (const [name, PB] of [["ble.js(旧H5)", bleOld], ["ble-h5.js(uni)", h5.PianoBLE], ["ble-mp.js(uni小程序)", mp.PianoBLE]]) {
    console.log(`\n[${name}]`);
    const collected = [];
    PB.onPianoNote = (m, v, on) => collected.push({ m, v, on });
    PB.onLog = () => {};
    PB.connected = true; // 绕过连接检查（_rx 不依赖，但保险）

    // 1. BLE-MIDI 单音 NoteOn（标准 5 字节）
    collected.length = 0;
    PB._rx(new Uint8Array([0x80, 0x82, 0x90, 0x3c, 0x64]));
    ok(collected.length === 1 && collected[0].m === 60 && collected[0].on === true, "BLE NoteOn C4");

    // 2. BLE-MIDI NoteOff
    collected.length = 0;
    PB._rx(new Uint8Array([0x80, 0x83, 0x80, 0x3c, 0x00]));
    ok(collected.length === 1 && collected[0].m === 60 && collected[0].on === false, "BLE NoteOff C4");

    // 3. 一包双消息（第二条带新时间戳）
    collected.length = 0;
    PB._rx(new Uint8Array([0x80, 0x82, 0x90, 0x3c, 0x64, 0x87, 0x90, 0x3e, 0x50]));
    ok(collected.length === 2 && collected[0].m === 60 && collected[1].m === 62, "一包两条 NoteOn");

    // 4. Note On vel=0 → 当作抬起
    collected.length = 0;
    PB._rx(new Uint8Array([0x80, 0x84, 0x90, 0x43, 0x00]));
    ok(collected.length === 1 && collected[0].on === false, "vel=0 NoteOn 视为 NoteOff");

    // 5. SysEx 包不产生琴键事件、不崩
    collected.length = 0;
    PB._rx(new Uint8Array([0x80, 0x82, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, 0x30, 0x03, 0xf7]));
    ok(collected.length === 0, "SysEx 不误报琴键");

    // 6. 裸 MIDI 兼容（90 3c 64）
    collected.length = 0;
    PB._rx(new Uint8Array([0x90, 0x3c, 0x64]));
    ok(collected.length === 1 && collected[0].m === 60 && collected[0].on === true, "裸 MIDI NoteOn");

    // 7. 裸 MIDI NoteOff (80 3c 00)：第二字节无高位 → 走裸分支
    collected.length = 0;
    PB._rx(new Uint8Array([0x80, 0x3c, 0x00]));
    ok(collected.length === 1 && collected[0].m === 60 && collected[0].on === false, "裸 MIDI NoteOff");

    // 8. 音符范围外(杂讯)过滤
    collected.length = 0;
    PB._rx(new Uint8Array([0x80, 0x82, 0x90, 0x0c, 0x64]));
    ok(collected.length === 0, "音符 <21 过滤");
  }

  console.log(`\n======== ${passed} passed, ${failed} failed ========`);
  process.exit(failed ? 1 : 0);
}
main();
