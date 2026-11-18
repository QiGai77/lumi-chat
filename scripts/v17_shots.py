"""v0.17 自测截图：Flow 页、Flow 编辑器（逻辑 / 类 / AI 节点）、折叠侧栏（390px 手机 + 1280px 桌面）。
用法：npm run build && python3 scripts/v17_shots.py   （需要 pip install playwright && python3 -m playwright install chromium）
原生插件 LumiPhone 用 window.Capacitor.PluginHeaders 模拟：flowRun 返回按步骤类型编的耗时（不是真机数据），只用来看运行明细面板的样子。
截图写到 design/v17/，并检查页面有没有横向溢出的元素。"""
import asyncio, json, subprocess, time, sys, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design', 'v17')
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
  const ms = (k, s) => ({ launch: 640, tap: 210 + (s.length * 37) % 140, input: 150, enter: 90, scroll: 380, key: 120, wait: 300, sleep: s.ms || 1000 })[k] ?? 1;
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
      if (m === 'appIcon') throw new Error('mock');
      return {};
    },
  };
})();
"""

OVERFLOW = """() => { const W = document.documentElement.clientWidth; const bad = [];
  for (const el of document.querySelectorAll('.main *, .side *')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1) && getComputedStyle(el).position !== 'fixed') { const cs = el.closest('.scroll, .s-list, .seg-s, .fa-chips'); if (!cs || cs === el) bad.push((el.className || el.tagName) + ' ' + Math.round(r.right)) } }
  return [...new Set(bad)].slice(0, 12) }"""

async def shot(pg, name, full=False):
    path = os.path.join(OUT, name)
    await pg.screenshot(path=path, full_page=full)
    over = await pg.evaluate(OVERFLOW)
    print(f'{name}: overflow={over}')

async def setup(b, w, h, mini):
    pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.add_init_script(MOCK)
    await pg.route("**/v1/usage*", lambda r: r.fulfill(json={"mode": "unrestricted"}))
    await pg.goto("http://localhost:4173/")
    await pg.evaluate("([f,i,m])=>{localStorage.setItem('lumi.flows',JSON.stringify(f));localStorage.setItem('lumi.appicons',JSON.stringify(i));localStorage.setItem('lumi.sideMini',m)}", [FLOWS, ICONS, '1' if mini else '0'])
    await pg.reload(); await pg.wait_for_timeout(700)
    return pg, errs

async def open_flows(pg, mini):
    if mini:  # 图标栏没有 Flow：先展开再点
        await pg.locator(".side [aria-label=展开侧栏]").click(); await pg.wait_for_timeout(450)
    elif await pg.locator(".home-top .side-btn").is_visible():
        await pg.locator(".home-top .side-btn").click(); await pg.wait_for_timeout(450)
    await pg.locator(".s-item:has-text('Flow')").click(); await pg.wait_for_timeout(700)

async def main():
    srv = subprocess.Popen(["npx", "vite", "preview", "--port", "4173", "--strictPort"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            # ---------- 手机 390px
            pg, errs = await setup(b, 390, 844, True)
            await shot(pg, 'sidebar-collapsed-phone.png')
            await pg.locator(".side [aria-label=展开侧栏]").click(); await pg.wait_for_timeout(500)
            await shot(pg, 'sidebar-expanded-phone.png')
            await pg.locator(".side [aria-label=折叠侧栏]").click(); await pg.wait_for_timeout(500)
            await open_flows(pg, True)  # 手机：抽屉临时拉出，选完回到图标栏
            await shot(pg, 'flow-grid-phone.png')
            await pg.locator(".fapp:has-text('小红书')").click(); await pg.wait_for_timeout(700)
            await shot(pg, 'flow-app-phone.png', True)
            await pg.locator(".ftile:has-text('收藏前') .ft-more").click(); await pg.wait_for_timeout(700)
            await shot(pg, 'flow-editor-phone.png', True)
            await pg.set_viewport_size({"width": 390, "height": 2300}); await pg.wait_for_timeout(300)
            await shot(pg, 'flow-editor-full-phone.png')
            await pg.set_viewport_size({"width": 390, "height": 844}); await pg.wait_for_timeout(300)
            await pg.locator(".tl-card .fs-head:has-text('调用 note.open')").click(); await pg.wait_for_timeout(300)
            await pg.locator(".tl-card .fs-head:has-text('如果 note.saved')").click(); await pg.wait_for_timeout(300)
            await shot(pg, 'flow-editor-open-phone.png', True)
            await pg.locator(".add-btn").click(); await pg.wait_for_timeout(600)
            await shot(pg, 'flow-add-sheet-phone.png')
            await pg.locator(".sheet-back").click(position={"x": 30, "y": 30}); await pg.wait_for_timeout(300)
            await pg.locator(".cls-card:has-text('Note')").click(); await pg.wait_for_timeout(600)
            await shot(pg, 'flow-class-sheet-phone.png')
            await pg.locator(".sheet-back").click(position={"x": 30, "y": 30}); await pg.wait_for_timeout(300)
            await pg.locator(".btn-ink:has-text('试运行')").click(); await pg.wait_for_timeout(900)
            await pg.locator(".run-panel").scroll_into_view_if_needed()
            await shot(pg, 'flow-run-phone.png')
            # 我的（官网入口）
            await pg.locator(".side [aria-label=展开侧栏]").click(); await pg.wait_for_timeout(450)
            await pg.locator(".s-me").click(); await pg.wait_for_timeout(600)
            await shot(pg, 'me-phone.png', True)
            print('phone errors:', errs)
            # 编辑器里的 AI 步（搜索笔记）
            pg2, errs2 = await setup(b, 390, 844, False)
            await open_flows(pg2, False)
            await pg2.locator(".fapp:has-text('小红书')").click(); await pg2.wait_for_timeout(600)
            await pg2.locator(".ftile:has-text('搜索笔记') .ft-more").click(); await pg2.wait_for_timeout(600)
            await pg2.locator(".tl-card .fs-head:has-text('第一篇笔记')").click(); await pg2.wait_for_timeout(300)
            await shot(pg2, 'flow-editor-ai-phone.png', True)
            print('phone2 errors:', errs2)
            # ---------- 桌面 1280px
            pg, errs = await setup(b, 1280, 820, True)
            await shot(pg, 'sidebar-collapsed-desktop.png')
            await open_flows(pg, True)
            await shot(pg, 'flow-grid-desktop-expanded.png')
            await pg.locator(".side [aria-label=折叠侧栏]").click(); await pg.wait_for_timeout(500)
            await shot(pg, 'flow-grid-desktop.png')
            await pg.locator(".fapp:has-text('小红书')").click(); await pg.wait_for_timeout(600)
            await pg.locator(".ftile:has-text('收藏前') .ft-more").click(); await pg.wait_for_timeout(600)
            await pg.locator(".tl-card .fs-head:has-text('循环 i')").click(); await pg.wait_for_timeout(300)
            await shot(pg, 'flow-editor-desktop.png', True)
            print('desktop errors:', errs)
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
