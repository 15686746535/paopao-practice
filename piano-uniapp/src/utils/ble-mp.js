// uni 蓝牙适配层（微信小程序 / App 平台）
// 同一套 PianoBLE 接口，底层用 uni.* BLE API；协议与 H5 版完全一致
const PIANO_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const PIANO_CHAR = "7772e5db-3868-4112-a1a9-f2669d106bf3";
const NAME_PREFIXES = ["MP", "POP", "PianoProdigy", "GPP", "Xkey"];

const norm = (u) => (u || "").toString().toLowerCase().replace(/-/g, "");
const SERVICE_N = norm(PIANO_SERVICE);
const CHAR_N = norm(PIANO_CHAR);

function ab2u8(ab) { return new Uint8Array(ab); }

export const PianoBLE = {
  device: null, // {deviceId, name}
  serviceId: "",
  characteristicId: "",
  connected: false,
  onLog: null,
  onDisconnect: null,
  onPianoNote: null,
  _mock: false,
  _queue: Promise.resolve(),
  _found: [],

  _log(t) { if (this.onLog) this.onLog(t); },

  mockConnect() {
    this._mock = true;
    this.connected = true;
    this._log("（模拟连接，用于测试）");
    return Promise.resolve("MockPiano");
  },

  // 小程序没有系统选择框：自动挑信号最强的匹配设备
  async connect() {
    if (this._mock) return "MockPiano";
    const init = await new Promise((res, rej) =>
      uni.openBluetoothAdapter({ success: res, fail: (e) => rej(new Error("蓝牙初始化失败: " + e.errMsg)) })
    );
    if (!init || init.errMsg?.indexOf("ok") < 0) throw new Error("蓝牙适配器打开失败");

    this._found = [];
    await new Promise((res) => uni.startBluetoothDevicesDiscovery({ services: [PIANO_SERVICE], success: res, fail: res }));
    // 等待扫描积累设备
    await new Promise((res) => {
      uni.onBluetoothDeviceFound((r) => {
        for (const d of r.devices || []) {
          if (d.name && NAME_PREFIXES.some((p) => d.name.startsWith(p))) this._found.push(d);
        }
      });
      setTimeout(res, 3000);
    });
    await new Promise((res) => uni.stopBluetoothDevicesDiscovery({ success: res, fail: res }));

    if (!this._found.length) throw new Error("未发现钢琴，请确认琴已开机且手机 App 已断开");
    this._found.sort((a, b) => (b.RSSI || -999) - (a.RSSI || -999));
    const dev = this._found[0];
    this._log(`发现钢琴: ${dev.name}（共 ${this._found.length} 台候选）`);

    await new Promise((res, rej) =>
      uni.createBLEConnection({ deviceId: dev.deviceId, success: res, fail: (e) => rej(new Error("连接失败: " + e.errMsg)) })
    );
    uni.onBLEConnectionStateChange((r) => {
      if (!r.connected) {
        this.connected = false;
        this._log("钢琴连接已断开");
        if (this.onDisconnect) this.onDisconnect();
      }
    });

    const svcs = await new Promise((res, rej) =>
      uni.getBLEDeviceServices({ deviceId: dev.deviceId, success: res, fail: (e) => rej(new Error("获取服务失败: " + e.errMsg)) })
    );
    const svc = (svcs.services || []).find((s) => norm(s.uuid) === SERVICE_N);
    if (!svc) throw new Error("钢琴上未找到目标服务");
    const chars = await new Promise((res, rej) =>
      uni.getBLEDeviceCharacteristics({ deviceId: dev.deviceId, serviceId: svc.uuid, success: res, fail: (e) => rej(new Error("获取特征失败: " + e.errMsg)) })
    );
    const ch = (chars.characteristics || []).find((c) => norm(c.uuid) === CHAR_N && (c.properties.notify || c.properties.indicate));
    if (!ch) throw new Error("未找到 MIDI 通知特征");

    await new Promise((res, rej) =>
      uni.notifyBLECharacteristicValueChange({
        deviceId: dev.deviceId, serviceId: svc.uuid, characteristicId: ch.uuid, state: true,
        success: res, fail: (e) => rej(new Error("订阅通知失败: " + e.errMsg)),
      })
    );
    uni.onBLECharacteristicValueChange((r) => this._rx(ab2u8(r.value)));

    this.device = { deviceId: dev.deviceId, name: dev.name };
    this.serviceId = svc.uuid;
    this.characteristicId = ch.uuid;
    this.connected = true;

    await this.raw([0x80, 0x80, 0xf0, 0x0c, 0x01, 0x73, 0x7e, 0xf7]);
    await this.raw([0x80, 0x80, 0xf0, 0x50, 0, 0, 0, 0, 0, 0xf7]);
    await this.lightsClear();
    this._log("已连接：握手 + 灯激活完成");
    return dev.name;
  },

  disconnect() {
    if (this._mock) {
      this._mock = false;
      this.connected = false;
      this._log("（模拟断开）");
      if (this.onDisconnect) this.onDisconnect();
      return;
    }
    if (this.device) {
      uni.closeBLEConnection({ deviceId: this.device.deviceId });
      this.connected = false;
    }
  },

  raw(bytes) {
    if (!this.connected) return Promise.reject(new Error("钢琴未连接"));
    if (this._mock) return Promise.resolve();
    const value = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this._queue = this._queue.then(
      () =>
        new Promise((res) => {
          uni.writeBLECharacteristicValue(
            {
              deviceId: this.device.deviceId,
              serviceId: this.serviceId,
              characteristicId: this.characteristicId,
              value,
              success: res,
              fail: (e) => { this._log(`写入失败: ${e.errMsg}`); res(); },
            }
          );
        })
    );
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
};

// 暴露全局引用：调试 / 自动化测试 / mock
if (typeof globalThis !== "undefined") globalThis.PianoBLE = PianoBLE;
