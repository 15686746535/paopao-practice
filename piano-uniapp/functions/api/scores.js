// 曲谱云同步 API（EdgeOne Pages Functions + Blob 存储）
// GET  /api/scores?key=<同步码>          → { scores: [...] }
// POST /api/scores  body {key, scores}   → { ok: true, count }
// GET  /api/ping                         → { ok: true }
// 同步码 = 客户端随机生成的设备标识（无账号体系），Blob key = scores/<同步码>。
// Blob 首次调用自动建库，无需控制台配置；SDK 由部署构建打包（部署目录 package.json 声明依赖）。
import { getStore } from "@edgeone/pages-blob";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });

const validKey = (key) => typeof key === "string" && /^[A-Za-z0-9]{6,32}$/.test(key);

export async function onRequest(context) {
  const req = context.request;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  if (url.pathname === "/api/ping") return json({ ok: true, ts: Date.now() });
  if (url.pathname !== "/api/scores") return json({ error: "not found" }, 404);

  const store = getStore("paolianqin-scores");
  const qKey = url.searchParams.get("key") || "";

  if (req.method === "GET") {
    if (!validKey(qKey)) return json({ error: "同步码格式不正确" }, 400);
    const raw = await store.get("scores/" + qKey, { consistency: "strong" });
    let scores = [];
    try { scores = raw ? JSON.parse(raw) : []; } catch (e) { scores = []; }
    return json({ scores: Array.isArray(scores) ? scores : [] });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "请求体不是 JSON" }, 400); }
    const key = body && body.key;
    const scores = body && body.scores;
    if (!validKey(key)) return json({ error: "同步码格式不正确" }, 400);
    if (!Array.isArray(scores)) return json({ error: "scores 必须是数组" }, 400);
    const raw = JSON.stringify(scores);
    if (raw.length > 15 * 1024 * 1024) return json({ error: "曲谱总量过大" }, 413);
    await store.set("scores/" + key, raw);
    return json({ ok: true, count: scores.length });
  }

  return json({ error: "method not allowed" }, 405);
}
