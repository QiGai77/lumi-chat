"""v0.21 端到端测试用的模拟网关（OpenAI 兼容 SSE，真流式，逐块 sleep）。
用法：python3 scripts/mock_sse.py [端口，默认 8787]
- /v1/chat/completions：按最后一条用户消息里的关键词返回不同内容（见 pick()）；stream:false 时当作 AI 视觉定位，返回 {"i":1}
- /v1/usage：返回一个 Pro 套餐的用量
- /mcp：最小 MCP（initialize / tools/list）
所有响应都带 CORS 头。只用于本地测试。"""
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Expose-Headers": "mcp-session-id"}

MD = """下面是 Python、Go 和 Rust 的对比（Benchmark 2026）：

| 语言 | 性能 | 学习曲线 |
| --- | --- | --- |
| Python | 中 | 平缓 |
| Go | 高 | 适中 |
| Rust | 很高 | 陡峭 |

```go
package main

import "net/http"

func main() {
\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("hi")) })
\thttp.ListenAndServe(":8080", nil)
}
```

行内公式 $E = mc^2$，块公式：

$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$

- **加粗** 和 *斜体*
- `inline code`
"""
HTML = """可以预览：

```html
<!doctype html><html><body style="font-family:sans-serif"><h1 id="t">Hello Lumi</h1><button onclick="document.getElementById('t').textContent='clicked'">点我</button></body></html>
```
"""
TASK_FLOW = {"app": "小红书", "name": "收藏南京咖啡笔记", "desc": "搜索关键词，依次打开前几篇笔记并收藏",
  "steps": [{"kind": "launch", "app": "小红书", "pkg": "com.xingin.xhs"},
    {"kind": "if", "cond": {"kind": "exists", "sel": {"text": "跳过"}}}, {"kind": "tap", "sel": {"text": "跳过"}}, {"kind": "endif"},
    {"kind": "ai", "goal": "首页顶部的搜索框", "act": "tap"}, {"kind": "ai", "goal": "搜索输入框", "act": "input", "text": "{关键词}"}, {"kind": "enter"},
    {"kind": "wait", "sel": {"text": "综合"}},
    {"kind": "for", "var": "i", "from": 1, "to": "{数量}"},
    {"kind": "ai", "goal": "结果列表里第 ${i} 篇笔记", "act": "tap"},
    {"kind": "ai", "goal": "笔记底部的收藏按钮（星形）", "act": "tap"},
    {"kind": "key", "key": "back"}, {"kind": "endfor"}]}
SKILL = {"name": "会议纪要", "desc": "把会议记录整理成结论、待办和风险", "icon": "doc", "prompt": "你是会议记录员。把会议文字整理成结论、待办、风险。", "hello": "把会议记录发给我。"}
OPT = {"name": "点外卖（优化）", "desc": "打开美团外卖搜索店铺", "steps": [{"kind": "launch", "app": "美团"}, {"kind": "tap", "sel": {"text": "跳过"}, "optional": True},
    {"kind": "tap", "sel": {"text": "外卖"}}, {"kind": "input", "text": "{店名}"}, {"kind": "enter"}, {"kind": "tap", "sel": {"text": "去结算"}, "confirm": True}]}

LOG = []

def chunks_of(s, n=6):
    return [s[i:i + n] for i in range(0, len(s), n)]

def pick(req):
    msgs = req.get('messages', [])
    sysm = next((m['content'] for m in msgs if m.get('role') == 'system' and isinstance(m.get('content'), str)), '')
    last = msgs[-1] if msgs else {}
    tools = [t.get('function', {}).get('name') for t in req.get('tools') or []]
    u = next((m['content'] for m in reversed(msgs) if m.get('role') == 'user'), '')
    u = u if isinstance(u, str) else json.dumps(u, ensure_ascii=False)
    think = bool(req.get('reasoning_effort'))
    if '安卓无障碍自动化专家' in sysm:
        return {'text': json.dumps(OPT, ensure_ascii=False)}
    if last.get('role') == 'tool':
        res = last.get('content', '')
        return {'text': '已保存。可以在卡片上撤销。' if '用户确认' in res or '已保存' in res else '好的，没有保存。'}
    if 'skill_delete' in tools and '删除技能' in u: return {'tool': ('skill_delete', {"id": "会议纪要"})}
    if 'flow_delete' in tools and '删除 Flow' in u: return {'tool': ('flow_delete', {"id": "x2"})}
    if 'flow_list' in tools and '列出 Flow' in u: return {'tool': ('flow_list', {})}
    if 'phone_screen' in tools and '看屏幕' in u: return {'tool': ('phone_screen', {})}
    if 'flow_run' in tools and '运行 Flow' in u: return {'tool': ('flow_run', {"id": "x1", "params": {"关键词": "咖啡"}})}
    if 'skill_save' in tools and '技能' in u: return {'tool': ('skill_save', SKILL), 'text': '下面是这个技能：'}
    if 'mcp_add' in tools and 'MCP' in u: return {'tool': ('mcp_add', {"url": "http://localhost:%d/mcp" % PORT, "name": "本地测试"})}
    if 'flow_save' in tools and 'Flow' in u: return {'tool': ('flow_save', TASK_FLOW), 'text': '按任务生成了一个 Flow：'}
    if '散文' in u: return {'text': '秋天的南京，' + '梧桐叶慢慢落下，' * 200, 'delay': 0.05}
    if 'markdown' in u.lower() or '表格' in u: return {'text': MD}
    if 'html' in u.lower(): return {'text': HTML}
    return {'text': '你好，我是栖语 Lumi 的 Neon 模型。Hello from Lumi.', 'reasoning': '先想一想。' if think else ''}

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def hdr(self, code, ctype=None, extra=None, length=None):
        self.send_response(code)
        for k, v in {**CORS, **(extra or {})}.items(): self.send_header(k, v)
        if ctype: self.send_header('Content-Type', ctype)
        if length is not None: self.send_header('Content-Length', str(length))
        self.end_headers()
    def body(self, code, obj, extra=None):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.hdr(code, 'application/json', extra, len(b)); self.wfile.write(b)
    def do_OPTIONS(self): self.hdr(204, length=0)
    def do_GET(self):
        if self.path.startswith('/v1/usage'):
            return self.body(200, {"planName": "Pro", "mode": "subscription", "subscription": {"daily_usage_usd": 0.42, "weekly_usage_usd": 2.1, "monthly_usage_usd": 6.3, "daily_limit_usd": 5, "weekly_limit_usd": 20, "monthly_limit_usd": 50},
                                   "daily_usage": [{"date": "2026-11-17", "requests": 12, "total_tokens": 34000, "cost": 0.3, "actual_cost": 0.3}, {"date": "2026-11-18", "requests": 5, "total_tokens": 9000, "cost": 0.12, "actual_cost": 0.12}]})
        if self.path.startswith('/v1/card'): return self.body(404, {"error": "not found"})
        self.body(404, {"error": "no"})
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        req = json.loads(self.rfile.read(n) or b'{}')
        if self.path.startswith('/mcp'):
            h = {"mcp-session-id": "s1"}
            if req.get('id') is None: return self.hdr(202, extra=h, length=0)
            if req.get('method') == 'tools/list':
                return self.body(200, {"jsonrpc": "2.0", "id": req['id'], "result": {"tools": [{"name": "echo", "description": "回声"}, {"name": "time"}]}}, h)
            return self.body(200, {"jsonrpc": "2.0", "id": req['id'], "result": {"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "mock"}}}, h)
        if not self.path.startswith('/v1/chat/completions'): return self.body(404, {"error": "no"})
        LOG.append(req)
        with open('/tmp/mock_reqs.jsonl', 'a', encoding='utf-8') as fh: fh.write(json.dumps(req, ensure_ascii=False) + '\n')
        if not req.get('stream'):
            return self.body(200, {"choices": [{"message": {"role": "assistant", "content": '{"i":1}'}}]})
        p = pick(req)
        self.hdr(200, 'text/event-stream', {"Cache-Control": "no-cache", "Connection": "close"})
        def send(obj):
            self.wfile.write(('data: ' + json.dumps(obj, ensure_ascii=False) + '\n\n').encode()); self.wfile.flush()
        try:
            for c in chunks_of(p.get('reasoning', ''), 4):
                send({"choices": [{"delta": {"reasoning_content": c}}]}); time.sleep(0.03)
            for c in chunks_of(p.get('text', '')):
                send({"model": req.get('model'), "choices": [{"delta": {"content": c}}]}); time.sleep(p.get('delay', 0.01))
            if 'tool' in p:
                name, args = p['tool']
                send({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}]}}]})
            send({"choices": [], "usage": {"prompt_tokens": 20, "completion_tokens": 30}})
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
