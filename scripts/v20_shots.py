"""v0.20 自测截图：原生应用图标（模拟的 Phone.appIcon 返回品牌色 PNG）、便当格 / 叠卡 / 编辑器、技能页「用对话定制」、按任务生成弹窗、
对话里的确认卡（Flow / 技能 / MCP：待确认 → 保存后可撤销 / 试跑）。
用法：npm run build && python3 scripts/v20_shots.py [phone|desktop]
聊天接口用 Playwright 拦截 /v1/chat/completions 返回 SSE：第一轮返回工具调用（flow_save / skill_save / mcp_add），工具结果回来后返回一句总结。
原生插件 LumiPhone 是模拟的；运行耗时、图标都不是真机数据。截图写到 design/v20/，并检查横向溢出。"""
import asyncio, json, subprocess, time, sys, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design', 'v20')
os.makedirs(OUT, exist_ok=True)

def F(id, app, pkg, name, steps, **kw):
    d = {"id": id, "app": app, "pkg": pkg, "name": name, "desc": kw.pop('desc', ''), "params": kw.pop('params', []), "runs": kw.pop('runs', 0), "updated": 1, "steps": steps}
    d.update(kw); return d

XHS = 'com.xingin.xhs'
FLOWS = [
    F('x1', '小红书', XHS, '搜索笔记', [{"kind": "launch", "app": "小红书"}, {"kind": "tap", "sel": {"text": "跳过"}, "optional": True}, {"kind": "ai", "goal": "顶部的搜索框", "act": "tap", "sel": {"id": "com.xingin.xhs:id/search"}},
        {"kind": "input", "text": "{关键词}"}, {"kind": "enter"}, {"kind": "ai", "goal": "第一篇笔记", "act": "tap"}], params=['关键词'], runs=12, lastMs=4300),
    F('x2', '小红书', XHS, '批量点赞', [{"kind": "launch", "app": "小红书"}, {"kind": "set", "var": "n", "value": "0"},
        {"kind": "while", "cond": {"kind": "var", "var": "n", "op": "<", "value": "10"}, "max": 12},
        {"kind": "if", "cond": {"kind": "exists", "sel": {"text": "赞"}}}, {"kind": "tap", "sel": {"text": "赞"}, "vision": True}, {"kind": "set", "var": "n", "value": "n + 1"},
        {"kind": "else"}, {"kind": "scroll", "forward": True}, {"kind": "endif"}, {"kind": "endwhile"}], runs=3),
    F('x3', '小红书', XHS, '收藏前 5 篇', [
        {"kind": "launch", "app": "小红书"},
        {"kind": "new", "var": "note", "cls": "Note", "args": {"tag": "'露营'"}},
        {"kind": "for", "var": "i", "from": 1, "to": 5},
        {"kind": "method", "var": "note", "method": "open", "args": {"k": "${i}"}},
        {"kind": "if", "cond": {"kind": "exists", "sel": {"text": "收藏"}}},
        {"kind": "method", "var": "note", "method": "save"},
        {"kind": "else"}, {"kind": "key", "key": "back"}, {"kind": "endif"},
        {"kind": "endfor"},
        {"kind": "set", "var": "p", "value": "0.5,0.92"},
        {"kind": "if", "cond": {"kind": "var", "var": "note.saved", "op": ">=", "value": "3"}}, {"kind": "tap", "pointVar": "p"}, {"kind": "endif"},
    ], classes=[{"name": "Note", "fields": {"tag": "''", "saved": "0"}, "methods": [
        {"name": "open", "params": ["k"], "steps": [{"kind": "ai", "goal": "第 ${k} 篇${this.tag}笔记", "act": "tap"}]},
        {"name": "save", "steps": [{"kind": "tap", "sel": {"text": "收藏"}}, {"kind": "set", "var": "this.saved", "value": "this.saved + 1"}, {"kind": "key", "key": "back"}]}]}], runs=5, lastMs=9800),
    F('m1', '美团', 'com.sankuai.meituan', '点外卖', [{"kind": "launch", "app": "美团"}, {"kind": "tap", "sel": {"text": "外卖"}}, {"kind": "input", "text": "{店名}"}, {"kind": "tap", "sel": {"text": "去结算"}, "confirm": True}], params=['店名'], runs=8),
    F('m2', '美团', 'com.sankuai.meituan', '再来一单', [{"kind": "launch", "app": "美团"}, {"kind": "tap", "sel": {"text": "订单"}}], runs=2),
    F('w1', '微信', 'com.tencent.mm', '发给文件传输助手', [{"kind": "launch", "app": "微信"}, {"kind": "tap", "sel": {"text": "文件传输助手"}}, {"kind": "input", "text": "{内容}"}], params=['内容']),
    F('d1', '抖音', 'com.ss.android.ugc.aweme', '每日签到', [{"kind": "launch", "app": "抖音"}]),
    F('t1', '淘宝', 'com.taobao.taobao', '查快递', [{"kind": "launch", "app": "淘宝"}, {"kind": "tap", "sel": {"text": "我的淘宝"}}]),
    F('a1', '支付宝', 'com.eg.android.AlipayGphone', '蚂蚁森林收能量', [{"kind": "launch", "app": "支付宝"}]),
    F('s1', '设置', 'com.android.settings', '深色模式', [{"kind": "launch", "app": "设置"}]),
]
# 没有真机图标：按品牌主色写色相缓存（键是包名），卡片配色由 tint() 从色相选色族
ICONS = {XHS: {"hue": 355, "sat": .82, "light": .52}, 'com.sankuai.meituan': {"hue": 48, "sat": .95, "light": .52}, 'com.tencent.mm': {"hue": 135, "sat": .7, "light": .45},
         'com.ss.android.ugc.aweme': {"hue": 0, "sat": .05, "light": .1}, 'com.taobao.taobao': {"hue": 22, "sat": .95, "light": .52}, 'com.eg.android.AlipayGphone': {"hue": 212, "sat": .9, "light": .5},
         'com.android.settings': {"hue": 220, "sat": .1, "light": .5}}

MOCK = r"""
(() => {
  const listeners = {};
  // 模拟原生启动图标：按包名画一个品牌色圆角方形 PNG（真机上是 Java renderIcon 画的启动图标）
  const BRAND = { 'com.xingin.xhs': ['#FF2442', '#fff', '小红书'], 'com.sankuai.meituan': ['#FFD100', '#222', '美团'], 'com.tencent.mm': ['#07C160', '#fff', '微'],
    'com.ss.android.ugc.aweme': ['#111', '#fff', '抖'], 'com.taobao.taobao': ['#FF5000', '#fff', '淘'], 'com.eg.android.AlipayGphone': ['#1677FF', '#fff', '支'], 'com.android.settings': ['#5B6475', '#fff', '设'] };
  const BYNAME = { '小红书': 'com.xingin.xhs', '美团': 'com.sankuai.meituan', '微信': 'com.tencent.mm', '抖音': 'com.ss.android.ugc.aweme', '淘宝': 'com.taobao.taobao', '支付宝': 'com.eg.android.AlipayGphone', '设置': 'com.android.settings' };
  const mockIcon = (o) => {
    const pkg = BRAND[o.pkg] ? o.pkg : BYNAME[o.name];
    if (!pkg) throw new Error('没找到应用');
    const [bg, fg, t] = BRAND[pkg];
    const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d');
    g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, 160, 160, 35); g.fill();
    g.fillStyle = fg; g.font = `bold ${t.length > 2 ? 40 : 84}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 80, 86);
    window.__iconCalls = (window.__iconCalls || 0) + 1;
    return { pkg, label: o.name, src: c.toDataURL('image/png') };
  };
  const ms = (k, s) => ({ launch: 640, tap: 210 + (s.length * 37) % 140, input: 150, enter: 90, scroll: 380, key: 120, wait: 300, sleep: s.ms || 1000 })[k] ?? 1;
  window.CapacitorCustomPlatform = { name: 'android', plugins: {} };  // 让 isNative 为 true，走原生分支（图标、试跑）
  window.Capacitor = {
    PluginHeaders: [{ name: 'LumiPhone', methods: ['flowRun','flowStop','flowVisionAnswer','a11yStatus','apps','appIcon','folderStatus','recordStatus'].map(n => ({ name: n, rtype: 'promise' })).concat([{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }]) }],
    nativeCallback: (p, m, o, cb) => { listeners[o.eventName] = cb; return String(Math.random()) },
    nativePromise: async (p, m, o) => {
      if (m === 'flowRun') {
        const trace = [], learned = []; let total = 0, vm = 0, vc = 0;
        o.steps.forEach((s, pc) => {
          let src = /^(if|else|endif|while|endwhile|do|dowhile|for|endfor|set|new|bind|unbind|break|continue)$/.test(s.kind) ? 'logic' : 'native';
          let t = src === 'logic' ? 1 : ms(s.kind, JSON.stringify(s));
          if (s.kind === 'ai') { if (s.sel) { src = 'cache'; t = 260 } else { src = 'vision'; t = 1150 + (pc * 53) % 400; vm += t; vc++; learned.push({ fid: s._fid, i: s._i, sel: { text: s.goal } }) } }
          if (s.kind === 'tap' && s.pointVar) src = 'coord';
          if (s.kind !== 'endif' && s.kind !== 'endwhile' && s.kind !== 'endfor' && s.kind !== 'unbind') trace.push({ pc, i: s._i, fid: s._fid, label: s.note || ({ launch: '打开 ' + (s.app || ''), tap: s.pointVar ? '点击变量点 ' + s.pointVar : '点击「' + (s.sel?.text || '') + '」', input: '输入「' + (s.text || '') + '」', enter: '回车 / 搜索', key: '返回', scroll: '向下滚动', ai: 'AI 找「' + (s.goal || '').replace('${k}', '1').replace('${this.tag}', '露营') + '」并点击', new: '新建 ' + s.var, bind: '进入 ' + s.var + '.' + s.method + '()', set: '设置 ' + s.var, for: '循环 ' + s.var, if: '如果 …' })[s.kind] || s.kind, ms: t, src });
          total += t + (src === 'logic' ? 0 : 120);
        });
        return { ok: true, done: o.steps.length, total: o.steps.length, ms: total, trace, learned, visionMs: vm, visionCalls: vc, stepMs: trace.map(x => x.ms) };
      }
      if (m === 'a11yStatus') return { enabled: true };
      if (m === 'apps') return { apps: [] };
      if (m === 'folderStatus') return { linked: false };
      if (m === 'recordStatus') return { recording: false, steps: [] };
      if (m === 'appIcon') return mockIcon(o);
      return {};
    },
  };
})();
"""

OVERFLOW = """() => { const W = document.documentElement.clientWidth; const bad = [];
  for (const el of document.querySelectorAll('.main *, .side *')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1) && getComputedStyle(el).position !== 'fixed') { const cs = el.closest('.scroll, .s-list, .seg-s, .fa-chips'); if (!cs || cs === el) bad.push((el.className || el.tagName) + ' ' + Math.round(r.right)) } }
  return [...new Set(bad)].slice(0, 12) }"""

TASK_FLOW = {"app": "小红书", "name": "收藏南京咖啡笔记", "desc": "搜索关键词，依次打开前几篇笔记并收藏",
  "steps": [{"kind": "launch", "app": "小红书", "pkg": "com.xingin.xhs"},
    {"kind": "if", "cond": {"kind": "exists", "sel": {"text": "跳过"}}}, {"kind": "tap", "sel": {"text": "跳过"}}, {"kind": "endif"},
    {"kind": "ai", "goal": "首页顶部的搜索框", "act": "tap"}, {"kind": "ai", "goal": "搜索输入框", "act": "input", "text": "{关键词}"}, {"kind": "enter"},
    {"kind": "wait", "sel": {"text": "综合"}},
    {"kind": "for", "var": "i", "from": 1, "to": "{数量}"},
    {"kind": "ai", "goal": "结果列表里第 ${i} 篇笔记", "act": "tap"},
    {"kind": "ai", "goal": "笔记底部的收藏按钮（星形）", "act": "tap"},
    {"kind": "key", "key": "back"}, {"kind": "endfor"}]}
SKILL = {"name": "会议纪要", "desc": "把会议记录整理成结论、待办和风险", "icon": "doc", "prompt": "你是会议记录员。把用户给的会议文字整理成三段：结论；待办（每条写负责人和截止日期）；风险与未决问题。语气简洁，不编造没有提到的信息。", "hello": "把会议记录或录音转写发给我。"}
MCP = {"url": "https://mcp.deepwiki.com/mcp", "name": "DeepWiki"}

def sse(chunks):
    body = ''.join('data: ' + json.dumps(c, ensure_ascii=False) + '\n\n' for c in chunks) + 'data: [DONE]\n\n'
    return body

def tool_call(name, args, text=''):
    ch = []
    if text: ch.append({"choices": [{"delta": {"content": text}}]})
    ch.append({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}]}}]})
    return sse(ch)

async def chat_route(route):
    req = json.loads(route.request.post_data or '{}')
    msgs = req.get('messages', [])
    last = msgs[-1] if msgs else {}
    if last.get('role') == 'tool':
        res = last.get('content', '')
        txt = '已保存。点卡片上的「试跑」先跑一次，AI 视觉步找到的位置会存回，之后走原生。想每天自动跑，可以在「定时任务」里加一条：运行 Flow「收藏南京咖啡笔记」。' if '用户确认' in res else '好的，没有保存。想改哪里？'
        body = sse([{"choices": [{"delta": {"content": txt}}]}])
    else:
        u = next((m['content'] for m in reversed(msgs) if m.get('role') == 'user'), '')
        if '技能' in u: body = tool_call('skill_save', SKILL, '好的，下面是这个技能：')
        elif 'MCP' in u or 'mcp' in u: body = tool_call('mcp_add', MCP)
        else: body = tool_call('flow_save', TASK_FLOW, '按任务生成了一个 Flow：不认识的界面用 AI 视觉步。')
    await route.fulfill(status=200, headers={"content-type": "text/event-stream", "access-control-allow-origin": "*"}, body=body)

async def mcp_route(route):
    if route.request.method == 'OPTIONS':
        return await route.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST"})
    req = json.loads(route.request.post_data or '{}')
    h = {"access-control-allow-origin": "*", "access-control-expose-headers": "mcp-session-id", "mcp-session-id": "s1", "content-type": "application/json"}
    if req.get('method') == 'tools/list':
        return await route.fulfill(status=200, headers=h, body=json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "read_wiki_structure"}, {"name": "read_wiki_contents"}, {"name": "ask_question"}]}}))
    if req.get('id') is None: return await route.fulfill(status=202, headers=h, body='')
    await route.fulfill(status=200, headers=h, body=json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-06-18", "capabilities": {}}}))

async def shot(pg, name, full=False):
    path = os.path.join(OUT, name)
    vp = pg.viewport_size
    if full:
        h = await pg.evaluate("() => Math.max(...[...document.querySelectorAll('.page .scroll, .chat .scroll')].map(e => e.scrollHeight))")
        await pg.set_viewport_size({"width": vp["width"], "height": max(vp["height"], min(int(h), 4000))}); await pg.wait_for_timeout(300)
    await pg.screenshot(path=path)
    if full:
        await pg.set_viewport_size(vp); await pg.wait_for_timeout(200)
    over = await pg.evaluate(OVERFLOW)
    print(f'{name}: overflow={over}')

async def setup(b, w, h, collapsed):
    pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.add_init_script(MOCK)
    await pg.route("**/v1/usage*", lambda r: r.fulfill(json={"mode": "unrestricted"}))
    await pg.route("**/v1/chat/completions", chat_route)
    await pg.route("https://mcp.deepwiki.com/**", mcp_route)
    await pg.goto("http://localhost:4173/")
    await pg.evaluate("([f,i,m])=>{localStorage.setItem('lumi.flows',JSON.stringify(f));localStorage.setItem('lumi.appicons',JSON.stringify(i));localStorage.setItem('lumi.sideMini',m);localStorage.removeItem('lumi.convs')}", [FLOWS, ICONS, '1' if collapsed else '0'])
    await pg.reload(); await pg.wait_for_timeout(700)
    return pg, errs

async def open_side(pg, label):
    if await pg.locator(".side.rail").count():
        await pg.locator(".side [aria-label=展开侧栏]").click(); await pg.wait_for_timeout(500)
    await pg.locator(f".s-item:has-text('{label}')").first.click(); await pg.wait_for_timeout(700)
    if await pg.locator(".side [aria-label=折叠侧栏]").count() and pg.viewport_size['width'] < 980:
        await pg.locator(".side [aria-label=折叠侧栏]").click(); await pg.wait_for_timeout(400)

async def native_icons(pg):
    return await pg.evaluate("() => ({ img: document.querySelectorAll('img.app-ic').length, ph: document.querySelectorAll('.app-ic.ph').length, calls: window.__iconCalls || 0 })")

async def ask_in_chat(pg, text):
    """首页输入框发一句话，等确认卡出现。"""
    await pg.locator(".s-item:has-text('新对话'), [aria-label=新对话]").first.click() if False else None
    ta = pg.locator(".home textarea, textarea").first
    await ta.fill(text); await pg.keyboard.press("Enter") if pg.viewport_size['width'] > 700 else await pg.locator(".send").first.click()
    await pg.wait_for_selector(".ccard", timeout=8000); await pg.wait_for_timeout(600)

async def main():
    only = sys.argv[1:]
    srv = subprocess.Popen(["npx", "vite", "preview", "--port", "4173", "--strictPort"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for W in ([390, 360] if not only or 'phone' in only else []):
                sfx = '' if W == 390 else '-360'
                pg, errs = await setup(b, W, 844, True)
                await open_side(pg, 'Flow')
                await pg.wait_for_timeout(600)
                print('icons bento', W, await native_icons(pg))
                await shot(pg, f'flow-bento-phone{sfx}.png', True)
                await pg.locator(".bt.hero").click(position={"x": 60, "y": 30}); await pg.wait_for_timeout(700)
                print('icons deck', W, await native_icons(pg))
                await shot(pg, f'flow-deck-phone{sfx}.png', True)
                await pg.locator(".wcard:has-text('批量点赞') .wc-head").click(); await pg.wait_for_timeout(900)
                await shot(pg, f'flow-deck-open-phone{sfx}.png', True)
                await pg.locator(".wcard.open .btn-ghost:has-text('编辑')").click(); await pg.wait_for_timeout(700)
                await shot(pg, f'flow-editor-phone{sfx}.png')
                await pg.locator(".nav-back").click(); await pg.wait_for_timeout(500)
                await pg.locator(".fh-gen").click(); await pg.wait_for_timeout(500)
                await shot(pg, f'flow-ask-sheet-phone{sfx}.png')
                await pg.locator(".sheet-back").click(position={"x": 10, "y": 10}); await pg.wait_for_timeout(400)
                if W == 390:
                    await open_side(pg, '技能'); await shot(pg, 'skills-phone.png', True)
                    await open_side(pg, 'MCP'); await shot(pg, 'mcp-phone.png', True)
                    # 对话：按任务生成 Flow → 确认卡 → 保存 → 撤销 / 试跑
                    await pg.locator(".side [aria-label=展开侧栏]").click(); await pg.wait_for_timeout(400)
                    await pg.locator(".s-item:has-text('新对话')").first.click(); await pg.wait_for_timeout(600)
                    await ask_in_chat(pg, '按任务生成 Flow：每天帮我在小红书收藏前5篇南京咖啡笔记')
                    await shot(pg, 'chat-flow-confirm-phone.png', True)
                    await pg.locator(".ccard .cc-ok:has-text('保存')").click(); await pg.wait_for_timeout(1200)
                    await shot(pg, 'chat-flow-saved-phone.png', True)
                    await pg.locator(".ccard .cc-ok:has-text('试跑')").click(); await pg.wait_for_timeout(500)
                    if await pg.locator(".sheet .inp").count():
                        ins = pg.locator(".sheet .inp"); await ins.nth(0).fill('南京咖啡'); await ins.nth(1).fill('5')
                        await pg.locator(".sheet .btn-run").click(); await pg.wait_for_timeout(1200)
                    await shot(pg, 'chat-flow-tryrun-phone.png', True)
                    saved = await pg.evaluate("() => JSON.parse(localStorage.getItem('lumi.flows')).filter(f => f.name === '收藏南京咖啡笔记').map(f => ({ n: f.steps.length, params: f.params, cached: f.steps.filter(s => s.kind === 'ai' && s.sel).length }))")
                    print('saved flow', saved)
                    await pg.locator(".cb-btn[aria-label=新对话]").click(); await pg.wait_for_timeout(600)
                    await ask_in_chat(pg, '帮我做个技能：会议纪要')
                    await shot(pg, 'chat-skill-confirm-phone.png', True)
                    await pg.locator(".ccard .cc-ok:has-text('保存')").click(); await pg.wait_for_timeout(1000)
                    print('skills', await pg.evaluate("() => JSON.parse(localStorage.getItem('lumi.skills')||'[]').map(s => s.name)"))
                    await pg.locator(".cb-btn[aria-label=新对话]").click(); await pg.wait_for_timeout(600)
                    await ask_in_chat(pg, '加一个 MCP https://mcp.deepwiki.com/mcp')
                    await shot(pg, 'chat-mcp-confirm-phone.png', True)
                    await pg.locator(".ccard .cc-ok:has-text('保存')").click(); await pg.wait_for_timeout(1000)
                    await pg.locator(".ccard .btn-ghost:has-text('撤销')").click(); await pg.wait_for_timeout(500)
                    await shot(pg, 'chat-mcp-undone-phone.png', True)
                    await open_side(pg, '技能'); await shot(pg, 'skills-custom-phone.png', True)
                    print('mcp after undo', await pg.evaluate("() => JSON.parse(localStorage.getItem('lumi.mcp')||'[]').length"))
                print('phone errors:', errs)
                await pg.close()
            if not only or 'desktop' in only:
                pg, errs = await setup(b, 1280, 820, True)
                await open_side(pg, 'Flow')
                if await pg.locator(".side [aria-label=折叠侧栏]").count():
                    await pg.locator(".side [aria-label=折叠侧栏]").click(); await pg.wait_for_timeout(600)
                print('icons desktop', await native_icons(pg))
                await shot(pg, 'flow-bento-desktop.png', True)
                await pg.locator(".bt.hero").click(position={"x": 80, "y": 30}); await pg.wait_for_timeout(600)
                await pg.locator(".wcard:has-text('搜索笔记') .wc-head").click(); await pg.wait_for_timeout(900)
                await shot(pg, 'flow-deck-desktop.png', True)
                print('desktop errors:', errs)
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
