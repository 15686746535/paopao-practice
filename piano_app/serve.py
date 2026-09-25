# -*- coding: utf-8 -*-
"""
泡泡练琴 本地服务器
- 提供静态页面（Web Bluetooth 要求 https 或 localhost）
- /llm-proxy 代理大模型 API 请求（浏览器直连遇到 CORS 时的备用通道）
用法: python serve.py  然后浏览器打开 http://127.0.0.1:8321
"""
import http.server
import json
import os
import socketserver
import urllib.error
import urllib.request

PORT = 8321
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path != "/llm-proxy":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            req = urllib.request.Request(
                payload["url"],
                data=json.dumps(payload["body"]).encode("utf-8"),
                headers=payload.get("headers", {}),
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    body, code, ctype = r.read(), r.status, r.headers.get("Content-Type", "application/json")
            except urllib.error.HTTPError as e:
                body, code, ctype = e.read(), e.code, "application/json"
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:  # noqa: BLE001
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"泡泡练琴已启动: http://127.0.0.1:{PORT}  (Ctrl+C 退出)")
        httpd.serve_forever()
