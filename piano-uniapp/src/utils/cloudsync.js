// 曲谱云同步（EdgeOne Pages Functions + Blob 存储）
// 每台设备首次使用时生成随机「同步码」，曲谱列表整表推送/拉取，按 id + ts 合并。
// 无账号体系：换设备时在「我的」页输入原同步码即可拉回曲谱。
const API = "https://popp.jinglingtuoke.cn/api/scores";
const KEY_STORE = "pp_sync_key";

export function getSyncKey() {
  let key = "";
  try { key = uni.getStorageSync(KEY_STORE) || ""; } catch (e) { key = ""; }
  if (!/^[A-Za-z0-9]{6,32}$/.test(key)) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let rnd = "";
    const g = (n) => {
      try {
        const a = new Uint8Array(n);
        (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256));
        return Array.from(a, (b) => b % chars.length);
      } catch (e) { return Array.from({ length: n }, () => Math.floor(Math.random() * chars.length)); }
    };
    for (const i of g(8)) rnd += chars[i];
    key = rnd;
    try { uni.setStorageSync(KEY_STORE, key); } catch (e) { /* ignore */ }
  }
  return key;
}

export function setSyncKey(key) {
  key = String(key || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6,32}$/.test(key)) throw new Error("同步码格式不正确（6-32 位字母数字）");
  try { uni.setStorageSync(KEY_STORE, key); } catch (e) { /* ignore */ }
  return key;
}

/** 整表推送（fire-and-forget，失败静默，不打扰用户） */
export function pushScores(scores) {
  const key = getSyncKey();
  const body = JSON.stringify({ key, scores });
  const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), 15000);
  return fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: ctrl && ctrl.signal,
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((j) => (j && j.ok ? true : Promise.reject(new Error(j && j.error || "写入失败"))))
    .catch(() => false)
    .finally(() => timer && clearTimeout(timer));
}

/** 拉取云端列表；无网络/无数据返回 [] */
export async function pullScores() {
  const key = getSyncKey();
  try {
    const res = await fetch(API + "?key=" + encodeURIComponent(key));
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j && j.scores) ? j.scores : [];
  } catch (e) {
    return [];
  }
}

/** 按 id 合并（同 id 取 ts 新者），保持本地顺序、云端新增按 ts 新→旧排在后面 */
export function mergeScores(localList, remoteList) {
  const byId = new Map();
  for (const s of localList || []) {
    if (s && s.id) byId.set(s.id, s);
  }
  const remote = (remoteList || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const additions = [];
  let changed = false;
  for (const r of remote) {
    if (!r || !r.id) continue;
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, r);
      additions.push(r);
      changed = true;
    } else if ((r.ts || 0) > (l.ts || 0)) {
      byId.set(r.id, r);
      Object.assign(l, r);
      changed = true;
    }
  }
  return { list: localList || [], additions, changed };
}
