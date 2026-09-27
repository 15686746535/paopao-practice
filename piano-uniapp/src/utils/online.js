// 在线搜谱源 —— bitmidi.com（用户上传 MIDI 库，约 2 万+ 首，含大量流行/动漫/游戏改编）
// 搜索走同域代理 /api/bitmidi-search（bitmidi 搜索页无 CORS 头，浏览器直连会被拦）；
// MIDI 下载直连（该站下载带 access-control-allow-origin:*，可跨域）。
// 注意：曲目为用户上传 MIDI，仅供个人练习；商业化分发需另行授权（详见「我的-关于」）。
const BASE = "https://bitmidi.com";
const SEARCH_API = "https://popp.jinglingtuoke.cn/api/bitmidi-search";

/** 搜索曲名，返回 { list: [{id,name,url,downloadUrl}], total, pageTotal } */
export async function searchOnlineMidi(kw, page = 0) {
  const res = await fetch(`${SEARCH_API}?q=${encodeURIComponent(kw)}&page=${page}`);
  if (!res.ok) {
    let msg = "搜索失败 HTTP " + res.status;
    try { msg = (await res.json()).error || msg; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  const data = await res.json();
  return {
    list: (data.list || []).map((r) => ({
      id: r.id,
      name: String(r.name || "").replace(/\.mid$/i, ""),
      url: r.url,
      downloadUrl: r.downloadUrl,
    })),
    total: data.total || 0,
    pageTotal: data.pageTotal || 1,
  };
}

/** 下载 MIDI 并校验魔数，返回 Uint8Array */
export async function downloadMidi(downloadUrl) {
  const res = await fetch(BASE + downloadUrl);
  if (!res.ok) throw new Error("下载失败 HTTP " + res.status);
  const u8 = new Uint8Array(await res.arrayBuffer());
  if (!(u8.length > 14 && u8[0] === 0x4d && u8[1] === 0x54 && u8[2] === 0x68 && u8[3] === 0x64)) {
    throw new Error("不是有效的 MIDI 文件");
  }
  return u8;
}
