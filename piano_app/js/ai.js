// 大模型写谱：OpenAI 兼容接口（智谱 GLM / DeepSeek / 其他），ABC 输出
const AIGen = {
  buildPrompt(desc) {
    return [
      "请为钢琴初学者创作一首简短练习曲，用 ABC 记谱表示。",
      "要求：" + (desc || "轻快、简单、适合初学者") + "。",
      "硬性要求：",
      "1. 单声部旋律，不要和弦、不要多声部；",
      "2. 必须包含 X:/T:/M:/L:1/4/Q:/K: 头部行；",
      "3. 音域控制在 C4 到 C6 之间；",
      "4. 只输出 ABC 记谱文本（以 X: 开头），不要任何解释文字。",
    ].join("\n");
  },

  extractAbc(text) {
    // 优先取 ```abc 代码块，否则截取 X: 开头的整段
    const fence = text.match(/```(?:abc|text)?\s*([\s\S]*?)```/i);
    let body = fence ? fence[1] : text;
    const xi = body.indexOf("X:");
    if (xi >= 0) body = body.slice(xi);
    body = body.trim();
    // 截掉尾部的解释行（非 ABC 行）
    const lines = body.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
      if (/^\s*[A-Za-z0-9"'|\[\]:\/,()\-_>=. ]*$/.test(line) || /^(X|T|M|L|Q|K|C|W|w|%%|V|P|R):/.test(line)) out.push(line);
      else if (out.length > 3) break;
    }
    return out.join("\n").trim();
  },

  async generate(cfg) {
    const body = {
      model: cfg.model || "glm-4-flash",
      temperature: 0.9,
      messages: [
        { role: "system", content: "你是一位作曲家，只输出 ABC 记谱文本，不输出解释。" },
        { role: "user", content: this.buildPrompt(cfg.prompt) },
      ],
    };
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey };

    let resp;
    try {
      resp = await fetch(cfg.base, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e) {
      // 直连失败（多半是 CORS），走本地 serve.py 代理
      const pr = await fetch("/llm-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cfg.base, headers, body }),
      });
      resp = pr;
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`接口返回 ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "";
    const abc = this.extractAbc(content);
    if (!abc.startsWith("X:")) throw new Error("AI 返回内容里没有找到有效的 ABC 记谱");
    return abc;
  },
};
