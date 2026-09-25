// 泡泡钢琴 BLE 直连（协议来自对 cn.abcpiano.pianist 的逆向分析）
// 线上帧格式: 80 80 <MIDI字节...>   SysEx: 80 80 F0 ... F7
const PIANO_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const PIANO_CHAR = "7772e5db-3868-4112-a1a9-f2669d106bf3";

const PianoBLE = {
  device: null,
  char: null,
  connected: false,
  onLog: null,       // (text, dir) => void   dir: 'in' | 'out'
  onDisconnect: null,
  onPianoNote: null, // (midi, velocity, isOn) => void —— 琴键按下/抬起（练琴判定入口）
  _mock: false,      // 测试模式：无硬件，raw 直通
  _queue: Promise.resolve(),

  // 测试/演示用：不碰真实蓝牙，直接进入"已连接"状态
  mockConnect() {
    this._mock = true;
    this.connected = true;
    this.char = { properties: { writeWithoutResponse: true } };
    this._log("（模拟连接，用于测试）");
    return Promise.resolve("MockPiano");
  },

  async connect() {
    if (this._mock) return "MockPiano";
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth，请用 Chrome/Edge 并通过 http://127.0.0.1:8321 访问");
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
      this.onDisconnect && this.onDisconnect();
    });
    this.device = device;
    this.char = ch;
    this.connected = true;
    // 按特征值支持的属性选择写入方式（不带响应优先，MIDI BLE 的惯例）
    if (ch.properties.writeWithoutResponse) this.writeMode = "noResponse";
    else if (ch.properties.write) this.writeMode = "withResponse";
    else throw new Error("该特征值不支持写入");
    this._log("写入方式: " + this.writeMode);
    // 控制权握手：80 80 F0 0C 01 73 7E F7
    await this.raw([0x80, 0x80, 0xf0, 0x0c, 0x01, 0x73, 0x7e, 0xf7]);
    this._log("已连接并发送控制权握手");
    // 灯系统激活包（Lite 协议族必须先激活，MLNE 点灯才生效）
    await this.raw([0x80, 0x80, 0xf0, 0x50, 0, 0, 0, 0, 0, 0xf7]);
    await this.lightsClear();
    this._log("灯系统已激活并复位");
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
    if (this._mock) return Promise.resolve(); // 模拟模式直通
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
    // 串行化写入，避免并发 GATT 写冲突
    this._queue = this._queue.then(async () => {
      try {
        if (this.writeMode === "withResponse") await this.char.writeValue(new Uint8Array(bytes));
        else await this.char.writeValueWithoutResponse(new Uint8Array(bytes));
        this.lastWriteError = null;
      } catch (e) {
        this.lastWriteError = e.message;
        this._log(`写入失败: ${e.message} [${hex}]`, "err");
      }
    });
    return this._queue;
  },

  // 单音试奏 + 点灯：验证链路用
  async testTone() {
    if (!this.connected) throw new Error("钢琴未连接");
    this.lastWriteError = null;
    await this.raw([0x80, 0x80, 0xf0, 0x0c, 0x01, 0x73, 0x7e, 0xf7]); // 控制权握手
    await this.raw([0x80, 0x80, 0x90, 72, 100]); // C5 Note On
    await this.raw([0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, 72, 0x11, 0xf7]); // 点灯
    await new Promise((r) => setTimeout(r, 600));
    await this.raw([0x80, 0x80, 0x80, 72, 0]); // Note Off
    await this.raw([0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, 72, 0x00, 0xf7]); // 灭灯
    return this.lastWriteError;
  },

  // 灯协议探测：依次发送已知的各型号灯指令，观察哪个亮灯
  async probeLights() {
    if (!this.connected) throw new Error("钢琴未连接");
    const note = 72;      // C5
    const idx20 = note - 20; // PopPiano 批量包的键位偏移
    // 16 字节批量灯包构造（标准 PopPiano：F0 09 [左手槽2..7][右手槽8..13] 00 F7）
    const popPacket = (pos) => {
      const p = new Array(16).fill(0);
      p[0] = 0xf0; p[1] = 0x09; p[pos] = idx20; p[15] = 0xf7;
      return [0x80, 0x80, ...p];
    };
    const steps = [
      ["0 型号验证包(观察回包)", [[0x80, 0x80, 0xf1, 0x05, 0x42, 0x24, 0x00, 0x00, 0x00, 0xf7]]],
      ["1 Lite激活+MLNE蓝灯", [[0x80, 0x80, 0xf0, 0x50, 0, 0, 0, 0, 0, 0xf7],
                               [0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, note, 0x11, 0xf7]]],
      ["2 MLNE蓝灯(note原值)", [[0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, note, 0x11, 0xf7]]],
      ["3 MLNE蓝灯(note-20)", [[0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, idx20, 0x11, 0xf7]]],
      ["4 PopPiano批量包(左手槽)", [popPacket(2)]],
      ["5 PopPiano批量包(右手槽)", [popPacket(8)]],
      ["6 灯光模式切换+MLNE", [[0x80, 0x80, 0xf0, 0x26, 0x01, 0x80, 0xf7],
                               [0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, note, 0x11, 0xf7]]],
    ];
    for (const [label, frames] of steps) {
      this._log("💡 试灯: " + label);
      for (const f of frames) await this.raw(f);
      await new Promise((r) => setTimeout(r, 1600));
    }
    await this.lightsClear(); // 探测结束全部熄灭
    this._log("💡 试灯完毕：哪一步亮灯请记录序号");
    return this.lastWriteError;
  },

  // ---- MIDI ----
  noteOn(note, velocity = 100, channel = 0) {
    return this.raw([0x80, 0x80, 0x90 | channel, note & 0x7f, velocity & 0x7f]);
  },
  noteOff(note, channel = 0) {
    return this.raw([0x80, 0x80, 0x80 | channel, note & 0x7f, 0x00]);
  },

  // ---- 灯光（MLNE 单键包：PopPianoLite 及多数型号）----
  lightOn(note, color = 0x11) { // 0x11=蓝 0x01=红 0x00=灭
    return this.raw([0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, note & 0x7f, color, 0xf7]);
  },
  lightOff(note) {
    return this.lightOn(note, 0x00);
  },
  lightsClear() {
    return this.raw([0x80, 0x80, 0xf0, 0x4d, 0x4c, 0x4e, 0x45, 0x30, 0x03, 0xf7]);
  },

  // ---- 接收方向解析（复刻官方 BleMidiParser.parse 状态机）----
  // BLE-MIDI 线上格式: [header(0x8x)][timestamp(0x8x)][status][data1][data2] ...
  // 每条消息前都有 1 字节时间戳；裸 MIDI(90 3c 64) 做兼容分支
  _rx(data) {
    if (!data || data.length < 2) return;
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

  _log(text, level) {
    if (this.onLog) this.onLog(text, level);
  },
};
