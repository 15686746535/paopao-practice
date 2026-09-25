// PianoCore.Mxl —— 解析 .mxl（压缩的 MusicXML，即 zip 容器）
// 依赖浏览器 DecompressionStream('deflate-raw')（Chrome 80+ / Edge 80+）
(function () {
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  const A = (G.PianoCore = G.PianoCore || {});

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持解压 .mxl，请改用 .musicxml 或先解压");
    }
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function utf8(u8) {
    return new TextDecoder().decode(u8);
  }

  // 解析 zip 中央目录，返回 [{name, method, csize, usize, data(Uint8Array 压缩态)}]
  function readCentral(u8) {
    // 找 EOCD (PK\x05\x06)
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的 zip/mxl 文件");
    const count = u8[eocd + 10] | (u8[eocd + 11] << 8);
    let p = u8[eocd + 16] | (u8[eocd + 17] << 8) | (u8[eocd + 18] << 16) | (u8[eocd + 19] << 24);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (!(u8[p] === 0x50 && u8[p + 1] === 0x4b && u8[p + 2] === 0x01 && u8[p + 3] === 0x02)) break;
      const method = u8[p + 10] | (u8[p + 11] << 8);
      const csize = u8[p + 20] | (u8[p + 21] << 8) | (u8[p + 22] << 16) | (u8[p + 23] << 24);
      const usize = u8[p + 24] | (u8[p + 25] << 8) | (u8[p + 26] << 16) | (u8[p + 27] << 24);
      const nameLen = u8[p + 28] | (u8[p + 29] << 8);
      const extraLen = u8[p + 30] | (u8[p + 31] << 8);
      const cmtLen = u8[p + 32] | (u8[p + 33] << 8);
      const localOff = u8[p + 42] | (u8[p + 43] << 8) | (u8[p + 44] << 16) | (u8[p + 45] << 24);
      const name = utf8(u8.subarray(p + 46, p + 46 + nameLen));
      // 定位本地头后的数据
      let lp = localOff;
      const lNameLen = u8[lp + 26] | (u8[lp + 27] << 8);
      const lExtraLen = u8[lp + 28] | (u8[lp + 29] << 8);
      const dataStart = lp + 30 + lNameLen + lExtraLen;
      entries.push({ name, method, csize, usize, start: dataStart });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  async function mxlToXml(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    const entries = readCentral(u8);
    const files = [];
    for (const e of entries) {
      if (e.name.endsWith("/")) continue;
      const raw = u8.subarray(e.start, e.start + e.csize);
      const data = e.method === 0 ? raw : await inflateRaw(raw);
      files.push({ name: e.name, data });
    }
    // 1) 按 META-INF/container.xml 的 rootfile
    const container = files.find((f) => f.name === "META-INF/container.xml");
    if (container) {
      try {
        const doc = new DOMParser().parseFromString(utf8(container.data), "application/xml");
        const root = doc.querySelector("rootfile[full-path]");
        if (root) {
          const path = root.getAttribute("full-path");
          const hit = files.find((f) => f.name === path);
          if (hit) return utf8(hit.data);
        }
      } catch (e) { /* fallback */ }
    }
    // 2) 第一个不在 META-INF 的 .xml
    const first = files.find((f) => /\.xml$/i.test(f.name) && !/^META-INF\//i.test(f.name));
    if (first) return utf8(first.data);
    throw new Error("mxl 中找不到 MusicXML 主文件");
  }

  A.Mxl = { mxlToXml, readCentral };
})();
