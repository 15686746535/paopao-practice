// Web Bluetooth shim for Capacitor v4
// - 修复：Capacitor 原生代理 addListener 同步返回 handle（非 Promise），v3 在此崩溃
// - 自动扫描 4 秒（名字前缀/广播服务匹配），未命中回退系统全量列表
// - 全程日志桥到 PianoBLE.onLog
(function () {
  if (typeof window === "undefined") return;

  const norm = (u) => (u || "").toString().toLowerCase().replace(/-/g, "");
  const dash = (u) => {
    const s = norm(u);
    if (s.length !== 32) return (u || "").toLowerCase();
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  };
  // 插件桥接线格式为空格分隔的小写十六进制串（Conversion.kt stringToBytes / bytesToString，
  // 官方 JS 客户端 dataViewToHexString 同款）——不是 base64！发 base64 会 hexToByte 抛
  // IllegalArgumentException → 桥接层 rethrow RuntimeException → 原生闪退
  const hexToU8 = (hex) => {
    const parts = String(hex || "").trim().split(/\s+/).filter(Boolean);
    const u8 = new Uint8Array(parts.length);
    for (let i = 0; i < parts.length; i++) u8[i] = parseInt(parts[i], 16);
    return u8;
  };
  const u8ToHex = (u8) =>
    Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join(" ");

  const NAME_PREFIXES = ["MP", "POP", "PianoProdigy", "GPP", "Xkey"];
  const PIANO_SVC = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
  // 原生插件句柄：requestDevice 时注入，GATT 对象模型（makeCharacteristic/makeDevice）跨作用域使用
  let plugin = null;

  function btLog(text) {
    try {
      if (window.PianoBLE && window.PianoBLE.onLog) window.PianoBLE.onLog("[BT] " + text);
      else console.log("[BT]", text);
    } catch (e) { /* ignore */ }
  }

  // 取回上次原生崩溃（若曾闪退），等首页日志框就绪后展示；读后即清
  (function reportLastCrash() {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const cl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CrashLog;
      if (cl && typeof cl.last === "function" && window.PianoBLE && window.PianoBLE.onLog) {
        clearInterval(timer);
        Promise.resolve(cl.last()).then((r) => {
          if (r && r.content) btLog("⚠ 检测到上次异常退出（原生崩溃）:\n" + r.content);
        }).catch(() => { /* ignore */ });
      } else if (tries > 30) clearInterval(timer);
    }, 500);
  })();
  function errText(e) {
    return e && (e.message || e.localizedMessage || JSON.stringify(e));
  }
  function getP() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BluetoothLe;
  }

  // addListener 兼容：同步 handle 或 Promise<handle>，统一成 Promise<handle>
  function addListener(P, ev, cb) {
    return new Promise((resolve) => {
      try {
        const r = P.addListener(ev, cb);
        if (r && typeof r.then === "function") r.then(resolve).catch(() => resolve(null));
        else resolve(r);
      } catch (e) {
        btLog("addListener(" + ev + ") 失败: " + errText(e));
        resolve(null);
      }
    });
  }

  // -------- 自动扫描 --------
  function autoScan(P, ms) {
    return new Promise(async (resolve) => {
      const all = new Map();
      const matched = new Map();
      let done = false;
      let rawCount = 0;
      const handle = await addListener(P, "onScanResult", (r) => {
        rawCount++;
        try {
          const dev = (r && r.device) || {};
          const id = dev.deviceId;
          if (!id) return;
          const name = dev.name || "";
          const uuids = (r.uuids || []).map(norm);
          const viaService = uuids.indexOf(norm(PIANO_SVC)) >= 0;
          const viaName = NAME_PREFIXES.some((p) => name.startsWith(p));
          const prev = all.get(id);
          const rssi = typeof r.rssi === "number" ? r.rssi : (prev && prev.rssi) || -999;
          all.set(id, { deviceId: id, name: name || (prev && prev.name) || "", rssi });
          if (viaService || viaName) {
            matched.set(id, { deviceId: id, name: name || (prev && prev.name) || "", rssi, viaService });
          }
        } catch (e) { /* ignore */ }
      });
      const finish = async () => {
        if (done) return;
        done = true;
        try { handle && handle.remove && (await handle.remove()); } catch (e) { /* ignore */ }
        try { await P.stopLEScan(); } catch (e) { /* ignore */ }
        btLog(`扫描结束：原始回调 ${rawCount} 次，可见 ${all.size} 台设备，匹配钢琴特征 ${matched.size} 台`);
        if (all.size) {
          const sample = Array.from(all.values())
            .sort((a, b) => (b.rssi || -999) - (a.rssi || -999))
            .slice(0, 8)
            .map((d) => d.name || "无名(" + String(d.deviceId).slice(-5) + ")")
            .join("、");
          btLog("可见设备样例: " + sample);
        } else {
          btLog("⚠ 一台设备都没扫到 —— 请检查：①手机蓝牙已开 ②定位服务已开 ③App权限全部允许");
        }
        let best = null;
        for (const d of matched.values()) {
          if (!best || (d.rssi || -999) > (best.rssi || -999)) best = d;
        }
        resolve(best);
      };
      try {
        // SCAN_MODE_LOW_LATENCY(2)：最高频率扫描，4-6 秒窗口内捕获率最高
        await P.requestLEScan({ scanMode: 2, allowDuplicates: true });
        btLog("后台扫描已启动…");
      } catch (e) {
        btLog("⚠ 扫描启动失败: " + errText(e));
        setTimeout(finish, 300);
        return;
      }
      setTimeout(finish, ms);
    });
  }

  // -------- GATT 对象模型 --------
  function makeCharacteristic(deviceId, svcUuid, chr) {
    const uuid = dash(chr.uuid);
    const listeners = { value: [] };
    let notifying = false;
    return {
      uuid,
      properties: {
        write: !!(chr.properties && (chr.properties.write || chr.properties.writeWithResponse)),
        writeWithoutResponse: !!(chr.properties && chr.properties.writeWithoutResponse),
        notify: !!(chr.properties && chr.properties.notify),
        indicate: !!(chr.properties && chr.properties.indicate),
      },
      async startNotifications() {
        if (notifying) return;
        notifying = true;
        const key = `notification|${deviceId}|${svcUuid}|${uuid}`;
        await addListener(plugin, key, (event) => {
          const u8 = hexToU8(event && event.value);
          const dv = new DataView(u8.buffer);
          for (const fn of listeners.value) {
            try { fn({ target: { value: dv } }); } catch (e) { /* ignore */ }
          }
        });
        await plugin.startNotifications({ deviceId, service: svcUuid, characteristic: uuid });
      },
      async writeValue(buf) {
        const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        await plugin.write({ deviceId, service: svcUuid, characteristic: uuid, value: u8ToHex(u8), writeType: "withResponse" });
      },
      async writeValueWithoutResponse(buf) {
        const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        await plugin.write({ deviceId, service: svcUuid, characteristic: uuid, value: u8ToHex(u8), writeType: "withoutResponse" });
      },
      // Web Bluetooth 标准事件接口（ble-h5 调 characteristicvaluechanged）
      addEventListener(ev, fn) {
        if (ev === "characteristicvaluechanged" && typeof fn === "function") listeners.value.push(fn);
      },
      removeEventListener(ev, fn) {
        if (ev !== "characteristicvaluechanged") return;
        const i = listeners.value.indexOf(fn);
        if (i >= 0) listeners.value.splice(i, 1);
      },
      __on(ev, fn) { if (listeners[ev]) listeners[ev].push(fn); },
    };
  }

  function makeService(deviceId, svc) {
    const uuid = dash(svc.uuid);
    const chars = (svc.characteristics || []).map((c) => makeCharacteristic(deviceId, uuid, c));
    return {
      uuid,
      getCharacteristic: async (u) => {
        const hit = chars.find((c) => norm(c.uuid) === norm(u));
        if (!hit) throw new Error(`找不到特征值 ${u}`);
        return hit;
      },
    };
  }

  function makeDevice(bd) {
    const deviceId = bd.deviceId;
    const listeners = { disconnected: [] };
    const device = {
      id: deviceId,
      name: bd.name || "",
      __connected: false,
      gatt: {
        get connected() { return device.__connected === true; },
        async connect() {
          const key = `disconnected|${deviceId}`;
          await addListener(plugin, key, () => {
            device.__connected = false;
            btLog("钢琴连接已断开");
            for (const fn of listeners.disconnected) {
              try { fn(); } catch (e) { /* ignore */ }
            }
          });
          btLog("连接 GATT…");
          await plugin.connect({ deviceId });
          device.__connected = true;
          const res = await plugin.getServices({ deviceId });
          // 插件返回 { services: BleService[] } 包装对象（Android/JS 实现一致），必须解包
          const services = (res && res.services) || [];
          const svcList = services.map((s) => dash(s.uuid)).join("、");
          btLog(`服务发现完成（${services.length} 个服务）: ${svcList}`);
          return {
            getPrimaryService: async (u) => {
              const svc = (services || []).find((s) => norm(s.uuid) === norm(u));
              if (!svc) throw new Error(`找不到服务 ${u}`);
              return makeService(deviceId, svc);
            },
          };
        },
        disconnect() {
          try { plugin.disconnect({ deviceId }); } catch (e) { /* ignore */ }
          device.__connected = false;
          for (const fn of listeners.disconnected) {
            try { fn(); } catch (e) { /* ignore */ }
          }
        },
      },
      addEventListener(ev, fn) {
        if (ev === "gattserverdisconnected") listeners.disconnected.push(fn);
      },
    };
    return device;
  }

  navigator.bluetooth = {
    async requestDevice(options = {}) {
      const P = getP();
      if (!P) {
        btLog("⚠ BluetoothLe 原生插件未注入 —— Capacitor 桥异常");
        throw new Error("BluetoothLe 插件未注入");
      }
      btLog("原生蓝牙初始化（申请蓝牙权限）…");
      plugin = P;
      try {
        await P.initialize({ androidNeverForLocation: true });
        btLog("✓ 权限就绪，蓝牙已启用");
      } catch (e) {
        btLog("⚠ 初始化失败（权限被拒绝?）: " + errText(e));
        throw e;
      }

      btLog("开始自动搜索钢琴（4 秒）…");
      const hit = await autoScan(P, 4000).catch((e) => {
        btLog("自动搜索异常: " + errText(e));
        return null;
      });
      if (hit) {
        btLog(`✓ 自动匹配: ${hit.name || hit.deviceId}（${hit.rssi}dBm${hit.viaService ? "，广播含钢琴服务" : "，按名字匹配"}）`);
        return makeDevice(hit);
      }

      btLog("弹出系统设备列表，请手动选择钢琴…");
      const bd = await P.requestDevice({ acceptAllDevices: true });
      if (!bd || !bd.deviceId) throw new Error("NotFoundError");
      btLog(`✓ 手动选择: ${bd.name || bd.deviceId}`);
      return makeDevice(bd);
    },
  };

  console.log("[BT shim] v8 已加载（桥接十六进制线格式修复）");
})();
