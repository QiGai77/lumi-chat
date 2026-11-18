"""v0.22 截图：首页默认没有图标栏、长按侧栏按钮出现图标栏、单击打开抽屉、Flow 编辑器里的子 Flow 步 + 继续录制按钮 + 多选合并、桌面首页。
用法：npm run build && python3 scripts/v22_shots.py   → design/v22/。原生插件沿用 v20 的模拟（图标是模拟的品牌色 PNG）。"""
import asyncio, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# 只取 v20_shots.py 里的数据和模拟（那个脚本没有 __main__ 保护，不能直接 import）
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v20_shots.py'), encoding='utf-8').read()
_ns = {'os': os, '__file__': __file__}; exec(_src[:_src.index('def sse(')].replace("os.makedirs(OUT, exist_ok=True)", ""), _ns)
MOCK, FLOWS, ICONS, OVERFLOW, F = (_ns[k] for k in ('MOCK', 'FLOWS', 'ICONS', 'OVERFLOW', 'F'))
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design', 'v22'); os.makedirs(OUT, exist_ok=True)
XHS = 'com.xingin.xhs'
SUB = F('x4', '小红书', XHS, '搜笔记发给自己', [
    {"kind": "launch", "app": "小红书"},
    {"kind": "call", "flowId": "x1", "args": {"关键词": "{关键词}"}},
    {"kind": "ai", "goal": "笔记右上角的分享按钮", "act": "tap", "sel": {"desc": "分享"}},
    {"kind": "tap", "sel": {"text": "复制链接"}},
    {"kind": "call", "flowId": "w1", "args": {"内容": "刚找到的 {关键词} 笔记"}},
    {"kind": "key", "key": "back"}], params=['关键词'], runs=4, lastMs=8600)
ALL = [SUB] + FLOWS

async def shot(pg, name, full=False):
    vp = pg.viewport_size
    if full:
        h = await pg.evaluate("() => Math.max(...[...document.querySelectorAll('.page .scroll')].map(e => e.scrollHeight))")
        await pg.set_viewport_size({"width": vp["width"], "height": max(vp["height"], min(int(h), 3200))}); await pg.wait_for_timeout(300)
    await pg.screenshot(path=os.path.join(OUT, name))
    if full: await pg.set_viewport_size(vp); await pg.wait_for_timeout(200)
    print(name, 'overflow', await pg.evaluate(OVERFLOW))

async def setup(b, w, h):
    pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.add_init_script(MOCK)
    await pg.route("**/v1/usage*", lambda r: r.fulfill(json={"mode": "unrestricted"}))
    await pg.goto("http://localhost:4173/")
    await pg.evaluate("([f,i])=>{localStorage.clear();localStorage.setItem('lumi.flows',JSON.stringify(f));localStorage.setItem('lumi.appicons',JSON.stringify(i))}", [ALL, ICONS])
    await pg.reload(); await pg.wait_for_timeout(800)
    return pg, errs

async def long_press(pg, sel):
    box = await pg.locator(sel).first.bounding_box()
    await pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    await pg.mouse.down(); await pg.wait_for_timeout(700); await pg.mouse.up(); await pg.wait_for_timeout(500)

async def main():
    srv = subprocess.Popen(["npx", "vite", "preview", "--port", "4173", "--strictPort"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg, errs = await setup(b, 390, 844)
            st = lambda: pg.evaluate("() => ({ rail: !!document.querySelector('.side.rail'), drawer: !!document.querySelector('.side:not(.rail)'), mainLeft: getComputedStyle(document.querySelector('.main')).left, pref: localStorage.getItem('lumi.sideRail') })")
            print('default', await st())
            await shot(pg, 'home-no-rail.png')
            await pg.locator(".home-top .side-btn").click(); await pg.wait_for_timeout(600)
            print('after tap', await st())
            await shot(pg, 'home-drawer.png')
            await pg.locator(".side-scrim").click(position={"x": 370, "y": 400}); await pg.wait_for_timeout(500)
            print('after scrim', await st())
            await long_press(pg, ".home-top .side-btn")
            print('after long-press', await st())
            await shot(pg, 'home-rail.png')
            await long_press(pg, ".side.rail .side-btn")
            print('after 2nd long-press', await st())
            await pg.evaluate("() => window.dispatchEvent(new CustomEvent('lumi-go', { detail: 'flow:x4' }))"); await pg.wait_for_timeout(900)
            await shot(pg, 'flow-editor-subflow.png', True)
            await pg.locator(".flow-steps li.is-sub .fs-head").first.click(); await pg.wait_for_timeout(500)
            await shot(pg, 'flow-editor-subflow-open.png', True)
            await pg.locator(".flow-steps li.is-sub .fs-head").first.click(); await pg.wait_for_timeout(300)
            await pg.locator(".sec-row .chip-t").click(); await pg.wait_for_timeout(300)
            for i in (2, 3): await pg.locator(".flow-steps li .fs-head").nth(i).click(); await pg.wait_for_timeout(150)
            await shot(pg, 'flow-editor-merge.png', True)
            await pg.locator(".sec-row .chip-t").click(); await pg.wait_for_timeout(300)
            await pg.locator(".add-btn.rec").click(); await pg.wait_for_timeout(500)
            print('continue-record msg', await pg.locator(".imp-msg").all_inner_texts())
            print('page errors', errs)
            pd, e2 = await setup(b, 1280, 800)
            await shot(pd, 'desktop-home.png')
            await pd.locator(".side .side-btn").first.click(); await pd.wait_for_timeout(600)
            await shot(pd, 'desktop-home-closed.png')
            print('desktop errors', e2)
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
