// 练习偏好设置（uni 存储）
const KEY = "pp_settings_v1";

const DEFAULTS = {
  speedPct: 100,
  mode: "wait", // wait | follow
  hands: "both", // both | 1 | 2
};

export function getSettings() {
  try {
    const raw = uni.getStorageSync(KEY);
    if (!raw) return { ...DEFAULTS };
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { ...DEFAULTS, ...obj };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function setSetting(k, v) {
  const s = getSettings();
  s[k] = v;
  uni.setStorageSync(KEY, JSON.stringify(s));
  return s;
}
