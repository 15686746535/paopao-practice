// Web Bluetooth 适配层（H5 平台）—— 协议来自对泡泡钢琴 App 的逆向
// 与 piano_app/js/ble.js 同源：帧格式 80 80 <MIDI...>，SysEx 参数包，MLNE 灯协议
export const PIANO_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const PIANO_CHAR = "7772e5db-3868-4112-a1a9-f2669d106bf3";

export const PianoBLE = {
  device: null,
  char: null,
  connected: false,
  onLog: null,
  onDisconnect: null,
  onPianoNote: null,
  rxCount: 0, // 琴→App 收到的通知包数（RX 诊断用）
  _mock: false,
  _queue: Promise.resolve(),

  _log(text, level) { if (this.onLog) this.onLog(text, level); },

  mockConnect() {
    this._mock = true;
    this.connected = true;
    this.char = { properties: { writeWithoutResponse: true } };
    this._log("（模拟连接，用于测试）");
    return Promise.resolve("MockPiano");
  },

  async connect() {
    if (this._mock) return "MockPiano";
    if (this.connected && this.device) return this.device.name || this.device.id; // 防重入：重复连接会叠加通知监听器
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth，请用 Chrome/Edge 通过 https 访问");
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [PIANO_SERVICE] },
        { namePrefix: "MP" },
        { namePrefix: "POP" },
        { namePrefix: "PianoProdigy" },
        { namePrefix: "GPP" },
        { namePrefix: "Xkey" },
      ],
      optionalServices: [PIANO_SERVICE],
    });
    this._log(`正在连接 ${device.name || device.id} ...`);
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(PIANO_SERVICE);
    const ch = await svc.getCharacteristic(PIANO_CHAR);
    await ch.startNotifications();
    ch.addEventListener("characteristicvaluechanged", (e) => {
      this._rx(new Uint8Array(e.target.value.buffer));
    });
    device.addEventListener("gattserverdisconnected", () => {
      this.connected = false;
      this.char = null;
      this._log("钢琴连接已断开");
      if (this.onDisconnect) this.onDisconnect();
    });
    this.device = device;
    this.char = ch;
    this.connected = true;
    if (ch.properties.writeWithoutResponse) this.writeMode = "noResponse";
    else if (ch.properties.write) this.writeMode = "withResponse";
    else throw new Error("该特征值不支持写入");
    // 控制权握手 + 灯系统激活 + 灯复位
    await this.raw([0x80, 0x80, 0xf0, 0x0c, 0x01, 0x73, 0x7e, 0xf7]);
    await this.raw([0x80, 0x80, 0xf0, 0x50, 0, 0, 0, 0, 0, 0xf7]);
    await this.lightsClear();
    this._log("已连接：握手 + 灯激活完成");
    return device.name || device.id;
  },

  disconnect() {
    if (this._mock) {
      this._mock = false;
      this.connected = false;
      this.char = null;
      this._log("（模拟断开）");
      if (this.onDisconnect) this.onDisconnect();
      return;
    }
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  },

  raw(bytes) {
    if (!this.connected || !this.char) return Promise.reject(new Error("钢琴未连接"));
    if (this._mock) return Promise.resolve();
    this._queue = this._queue.then(async () => {
      try {
        if (this.writeMode === "withResponse") await this.char.writeValue(new Uint8Array(bytes));
        else await this.char.writeValueWithoutResponse(new Uint8Array(bytes));
      } catch (e) {
        this._log(`写入失败: ${e.message}`);
      }
    });
    return this._queue;
  },

  async testTone() {
    if (!this.connected) throw new Error("钢琴未连接");
    await this.raw([0x80, 0x80, 0xf0, 0x0c, 0x01, 0x73, 0x7e, 0xf7]);
    await this.raw([0x80, 0x80, 0x90, 72, 100]);
    await this.raw([0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, 72, 0x11, 0xf7]);
    await new Promise((r) => setTimeout(r, 600));
    await this.raw([0x80, 0x80, 0x80, 72, 0]);
    await this.raw([0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, 72, 0x00, 0xf7]);
  },

  noteOn(note, velocity = 100, channel = 0) {
    return this.raw([0x80, 0x80, 0x90 | channel, note & 0x7f, velocity & 0x7f]);
  },
  noteOff(note, channel = 0) {
    return this.raw([0x80, 0x80, 0x80 | channel, note & 0x7f, 0x00]);
  },
  lightOn(note, color = 0x11) {
    return this.raw([0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, note & 0x7f, color, 0xf7]);
  },
  lightOff(note) { return this.lightOn(note, 0x00); },
  lightsClear() {
    return this.raw([0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, 0x30, 0x03, 0xf7]);
  },

  // BLE-MIDI 线上格式: [header(0x8x)][timestamp(0x8x)][status][data1][data2] ...
  // 每条消息前都有 1 字节时间戳；裸 MIDI(90 3c 64) 做兼容分支
  _rx(data) {
    if (!data || !data.length) return;
    this.rxCount++;
    const hex = Array.from(data).map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const looksBLE = (data[0] & 0x80) !== 0 && (data[1] & 0x80) !== 0;
    const events = [];
    if (looksBLE) {
      let st = 0, kind = 0, note = 0;
      for (let i = 1; i < data.length; i++) {
        const b = data[i];
        if (st === 0) st = 1; // 时间戳字节，丢弃
        else if (st === 1) {
          const hi = b & 0xf0;
          if (hi === 0x80 || hi === 0x90 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) { kind = b; st = 31; }
          else if (hi === 0xc0 || hi === 0xd0) { kind = b; st = 21; }
          else if (b === 0xf0) st = 41; // SysEx 开始
          else st = 0;                  // 其他系统消息/意外字节，复位
        }
        else if (st === 31) { note = b & 0x7f; st = 32; }
        else if (st === 32) {
          if (((kind & 0xf0) === 0x90 || (kind & 0xf0) === 0x80) && note >= 21 && note <= 108) {
            events.push({ s: kind, a: note, b });
          }
          st = 0;
        }
        else if (st === 21) st = 0;
        else if (st === 41) { if (b === 0xf7) st = 0; }
      }
    } else {
      // 裸 MIDI：按 3 字节组读
      for (let i = 0; i + 2 < data.length; i += 3) {
        const s = data[i], a = data[i + 1], b = data[i + 2];
        if (((s & 0xf0) === 0x90 || (s & 0xf0) === 0x80) && a >= 21 && a <= 108) {
          events.push({ s, a, b });
        }
      }
    }
    for (const ev of events) {
      const isOn = (ev.s & 0xf0) === 0x90 && ev.b > 0;
      const isOff = (ev.s & 0xf0) === 0x80 || ((ev.s & 0xf0) === 0x90 && ev.b === 0);
      if (isOn || isOff) {
        this._log(`琴键 ${isOn ? "NoteOn" : "NoteOff"} note=${ev.a} vel=${ev.b}`);
        if (this.onPianoNote) {
          try { this.onPianoNote(ev.a, ev.b, isOn); } catch (e) { /* 判定器异常不影响连接 */ }
        }
      }
    }
    if (!events.length) this._log(`收 ${hex}`, "in");
  },
};

// 暴露全局引用：调试 / 自动化测试 / mock
if (typeof globalThis !== "undefined") globalThis.PianoBLE = PianoBLE;
