// PianoCore.Records —— 练习记录（跨端存储：uni 存储 / localStorage 自适应）
(function () {
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  const A = (G.PianoCore = G.PianoCore || {});
  const KEY = "pp_records_v1";

  function rawGet(k) {
    if (typeof uni !== "undefined" && uni.getStorageSync) {
      return uni.getStorageSync(k); // uni 直接返回存入值（对象或字符串）
    }
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function rawSet(k, v) {
    if (typeof uni !== "undefined" && uni.setStorageSync) {
      uni.setStorageSync(k, v);
      return;
    }
    try { localStorage.setItem(k, v); } catch (e) { /* ignore */ }
  }

  function all() {
    const raw = rawGet(KEY);
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function save(list) { rawSet(KEY, JSON.stringify(list.slice(0, 100))); }

  function add(rec) {
    const list = all();
    list.unshift(Object.assign({ ts: Date.now() }, rec));
    save(list);
    return list;
  }

  function last(scoreName, n = 10) {
    return all().filter((r) => !scoreName || r.score === scoreName).slice(0, n);
  }

  A.Records = { all, add, last };
})();
