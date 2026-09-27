// bitmidi 搜索代理 —— bitmidi 搜索页不带 CORS 头，浏览器直连会被拦；
// 同域代理（/api/bitmidi-search）无跨域问题，且把结果解析成干净 JSON，客户端零解析。
// GET /api/bitmidi-search?q=summer&page=0 → { list:[{id,name,url,downloadUrl}], total, pageTotal }
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });

function extractInitStore(html) {
  const m = html.match(/window\.initStore\s*=\s*/);
  if (!m) throw new Error("搜索页结构已变化");
  const s = html.slice(m.index + m[0].length);
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { if (--depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error("搜索数据解析失败");
  return JSON.parse(s.slice(0, end));
}

export async function onRequest(context) {
  const req = context.request;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 64);
  const page = Math.max(0, Math.min(50, parseInt(url.searchParams.get("page") || "0", 10) || 0));
  if (!q) return json({ error: "缺少关键词" }, 400);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let html;
  try {
    const res = await fetch(`https://bitmidi.com/search?q=${encodeURIComponent(q)}&page=${page}`, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: ctrl.signal,
    });
    if (!res.ok) return json({ error: "上游搜索失败 HTTP " + res.status }, 502);
    html = await res.text();
  } catch (e) {
    return json({ error: "上游连接失败" }, 504);
  } finally {
    clearTimeout(timer);
  }

  try {
    const data = extractInitStore(html);
    const views = (data.views && data.views.search) || {};
    const kwKey = Object.keys(views)[0];
    const stat = (kwKey && views[kwKey]) || {};
    const pageKey = Object.keys(stat).find((k) => Array.isArray(stat[k]));
    const order = pageKey ? stat[pageKey] : [];
    const midis = (data.data && data.data.midis) || {};
    const list = order
      .map((slug) => midis[slug])
      .filter(Boolean)
      .map((r) => ({
        id: r.id,
        name: String(r.name || "").replace(/\.mid$/i, ""),
        url: r.url,
        downloadUrl: r.downloadUrl,
      }));
    return json({ list, total: stat.total || list.length, pageTotal: stat.pageTotal || 1 });
  } catch (e) {
    return json({ error: e.message || "解析失败" }, 502);
  }
}
