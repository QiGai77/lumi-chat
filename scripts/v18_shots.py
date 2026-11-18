"""v0.18 自测截图（Riffs 风格重做后）：Flow 页、Flow 编辑器（逻辑 / 类 / AI 节点）、折叠侧栏（390px 手机 + 1280px 桌面）。
用法：npm run build && python3 scripts/v17_shots.py   （需要 pip install playwright && python3 -m playwright install chromium）
原生插件 LumiPhone 用 window.Capacitor.PluginHeaders 模拟：flowRun 返回按步骤类型编的耗时（不是真机数据），只用来看运行明细面板的样子。
截图写到 design/v18/，并检查页面有没有横向溢出的元素。"""
import asyncio, json, subprocess, time, sys, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design', 'v18')
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

CONVS = [{"id": "c1", "title": "周末露营装备清单", "tier": "neon", "updated": 1763400000000, "messages": [
    {"role": "user", "content": "帮我列一个两天一夜的露营装备清单，两个人。"},
    {"role": "assistant", "tier": "neon", "ms": 820, "content": "好的，两天一夜、两个人，按用途分四类：\n\n**住宿**\n- 双人帐篷 + 地钉、防潮垫\n- 睡袋 ×2（舒适温度 ≤10°C）\n\n**炊事**\n- 卡式炉 + 气罐 ×2\n- 套锅、餐具、保温壶\n\n**照明与电**\n- 营地灯、头灯 ×2、充电宝\n\n出发前看一眼天气，下雨的话加一块天幕。"}]},
  {"id": "c2", "title": "解释一下 do-while", "tier": "helium", "updated": 1763300000000, "messages": [{"role": "user", "content": "do-while 和 while 有什么区别"}]}]

async def shot(pg, name, full=False):
    """full=True：内容在 .scroll 里滚动，整页截图截不到，临时把视口拉高到内容高度再截。"""
    path = os.path.join(OUT, name)
    vp = pg.viewport_size
    if full:
        h = await pg.evaluate("() => Math.max(...[...document.querySelectorAll('.page .scroll')].map(e => e.scrollHeight))")
        await pg.set_viewport_size({"width": vp["width"], "height": max(vp["height"], min(int(h), 4000))}); await pg.wait_for_timeout(300)
    await pg.screenshot(path=path)
    if full:
        await pg.set_viewport_size(vp); await pg.wait_for_timeout(200)
    over = await pg.evaluate(OVERFLOW)
    print(f'{name}: overflow={over}')

async def setup(b, w, h, collapsed, convs=None):
    pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.add_init_script(MOCK)
    await pg.route("**/v1/usage*", lambda r: r.fulfill(json={"mode": "unrestricted"}))
    await pg.goto("http://localhost:4173/")
    await pg.evaluate("([f,i,m,c])=>{localStorage.setItem('lumi.flows',JSON.stringify(f));localStorage.setItem('lumi.appicons',JSON.stringify(i));localStorage.setItem('lumi.sideMini',m);localStorage.setItem('lumi.convs',JSON.stringify(c))}", [FLOWS, ICONS, '1' if collapsed else '0', convs or []])
    await pg.reload(); await pg.wait_for_timeout(700)
    return pg, errs

async def open_flows(pg):
    if await pg.locator(".side.rail").count():  # 图标栏没有 Flow：先展开再点
        await pg.locator(".side [aria-label=展开侧栏]").click(); await pg.wait_for_timeout(500)
    await pg.locator(".s-item:has-text('Flow')").click(); await pg.wait_for_timeout(700)

async def rail_check(pg):
    """图标栏不能盖住内容：main 的左边要 >= 图标栏右边。"""
    return await pg.evaluate("""() => { const s = document.querySelector('.side'), m = document.querySelector('.main');
      return { side: Math.round(s.getBoundingClientRect().right), main: Math.round(m.getBoundingClientRect().left), rail: s.classList.contains('rail') } }""")

async def main():
    only = sys.argv[1:]  # 可只跑 phone / desktop
    srv = subprocess.Popen(["npx", "vite", "preview", "--port", "4173", "--strictPort"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for W in ([390, 360] if not only or 'phone' in only else []):
                sfx = '' if W == 390 else '-360'
                pg, errs = await setup(b, W, 844, True, CONVS)
                print('rail', W, await rail_check(pg))
                await shot(pg, f'home-phone{sfx}.png')
                await shot(pg, f'sidebar-collapsed-phone{sfx}.png')
                await pg.locator(".side [aria-label=展开侧栏]").click(); await pg.wait_for_timeout(600)
                await shot(pg, f'sidebar-expanded-phone{sfx}.png')
                await pg.locator(".s-conv:has-text('露营')").click(); await pg.wait_for_timeout(800)
                print('rail after pick', await rail_check(pg))
                await shot(pg, f'chat-phone{sfx}.png')
                await pg.locator(".cb-t").click(); await pg.wait_for_timeout(700)
                await shot(pg, f'mode-sheet-phone{sfx}.png')
                await pg.locator(".scrim").click(position={"x": 30, "y": 30}); await pg.wait_for_timeout(500)
                await pg.locator(".side [aria-label=新对话]").click(); await pg.wait_for_timeout(600)
                await open_flows(pg)
                await shot(pg, f'flow-grid-phone{sfx}.png')
                await pg.locator(".fapp:has-text('小红书')").click(); await pg.wait_for_timeout(700)
                await shot(pg, f'flow-app-phone{sfx}.png', True)
                await pg.locator(".ftile:has-text('收藏前') .ft-more").click(); await pg.wait_for_timeout(700)
                await shot(pg, f'flow-editor-phone{sfx}.png')
                await pg.locator(".tl-card .fs-head:has-text('如果 note.saved')").click(); await pg.wait_for_timeout(300)
                await shot(pg, f'flow-editor-full-phone{sfx}.png', True)
                await pg.locator(".add-btn").click(); await pg.wait_for_timeout(700)
                await shot(pg, f'flow-add-sheet-phone{sfx}.png')
                await pg.locator(".sheet-back").click(position={"x": 30, "y": 30}); await pg.wait_for_timeout(300)
                await pg.locator(".cls-card:has-text('Note')").click(); await pg.wait_for_timeout(700)
                await shot(pg, f'flow-class-sheet-phone{sfx}.png')
                await pg.locator(".sheet-back").click(position={"x": 30, "y": 30}); await pg.wait_for_timeout(300)
                await pg.locator(".btn-ink:has-text('试运行')").click(); await pg.wait_for_timeout(900)
                await pg.locator(".run-panel").scroll_into_view_if_needed()
                await shot(pg, f'flow-run-phone{sfx}.png')
                await pg.locator(".side [aria-label=展开侧栏]").click(); await pg.wait_for_timeout(500)
                await pg.locator(".s-me").click(); await pg.wait_for_timeout(700)
                await shot(pg, f'me-phone{sfx}.png', True)
                await pg.locator(".row:has-text('设置')").first.click(); await pg.wait_for_timeout(700)
                await shot(pg, f'settings-phone{sfx}.png', True)
                print('phone errors:', errs)
                await pg.close()
            if not only or 'desktop' in only:
                pg, errs = await setup(b, 1280, 820, True, CONVS)
                print('rail desktop', await rail_check(pg))
                await shot(pg, 'sidebar-collapsed-desktop.png')
                await open_flows(pg)
                await shot(pg, 'flow-grid-desktop-expanded.png')
                await pg.locator(".side [aria-label=折叠侧栏]").click(); await pg.wait_for_timeout(600)
                print('rail desktop2', await rail_check(pg))
                await shot(pg, 'flow-grid-desktop.png')
                await pg.locator(".fapp:has-text('小红书')").click(); await pg.wait_for_timeout(600)
                await shot(pg, 'flow-app-desktop.png')
                await pg.locator(".ftile:has-text('收藏前') .ft-more").click(); await pg.wait_for_timeout(600)
                await pg.locator(".tl-card .fs-head:has-text('循环 i')").click(); await pg.wait_for_timeout(300)
                await shot(pg, 'flow-editor-desktop.png', True)
                print('desktop errors:', errs)
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
