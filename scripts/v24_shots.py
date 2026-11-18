"""v0.24 截图：Flow 编辑器里的 AI 接管步（时间线 + 展开编辑）、添加步骤菜单、Flow 首页的模板、模拟的对比卡（运行记录里的示例数据，不是真实运行）。
用法：npm run build && python3 scripts/v24_shots.py   → design/v24/。原生插件沿用 v20 的模拟。"""
import asyncio, os, subprocess, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v20_shots.py'), encoding='utf-8').read()
_ns = {'os': os, '__file__': __file__}; exec(_src[:_src.index('def sse(')].replace("os.makedirs(OUT, exist_ok=True)", ""), _ns)
MOCK, FLOWS, ICONS, OVERFLOW, F = (_ns[k] for k in ('MOCK', 'FLOWS', 'ICONS', 'OVERFLOW', 'F'))
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design', 'v24'); os.makedirs(OUT, exist_ok=True)
TB = 'com.taobao.taobao'
EAR = F('tb1', '淘宝', TB, '挑耳机', [
    {"kind": "launch", "app": "淘宝", "pkg": TB},
    {"kind": "tap", "sel": {"text": "搜索"}, "vision": True, "goal": "首页顶部的搜索框", "note": "点搜索框"},
    {"kind": "input", "text": "{关键词}"},
    {"kind": "enter"},
    {"kind": "agent", "goal": "在搜索结果里比较至少 5 款{关键词}，按 {预算} 和口碑挑最合适的一款，停在商品详情页", "criteria": "{预算}", "maxSteps": 25, "model": "argon"},
], params=['关键词', '预算'], runs=1, lastMs=104000)
EAR['desc'] = '搜索{关键词}，AI 比较至少 5 款后按预算和口碑挑一款，停在详情页（不会下单）'
ALL = [EAR] + FLOWS

# 示例数据（和 src/agentui.tsx 的 MOCK_OUTCOME 一致），只用于截图
OUTCOME = {
  "id": "mock", "status": "done", "at": 0, "reason": "", "ms": 96400, "modelCalls": 15, "modelMs": 61200,
  "cfg": {"goal": "在搜索结果里比较至少 5 款蓝牙耳机，按 300 元以内 和口碑挑最合适的一款，停在商品详情页", "criteria": "300 元以内，降噪优先", "maxSteps": 25, "maxMinutes": 5, "stopBefore": ["pay", "submit", "send", "delete"], "output": "compare", "model": "argon", "app": "淘宝", "pkg": TB},
  "summary": "看了 5 款，按价格和评价筛掉 2 款超预算的，剩下 3 款里降噪和续航最均衡的是第 3 款。",
  "pick": {"name": "示例耳机 C 主动降噪蓝牙耳机", "reason": "279 元在预算内，评价里降噪和续航提得最多，差评主要是盒子偏大"},
  "candidates": [
    {"name": "示例耳机 A 半入耳蓝牙耳机", "price": "¥199", "rating": "4.8", "sales": "月销 1 万+", "shop": "示例 A 旗舰店", "pros": "轻、便宜", "cons": "无降噪"},
    {"name": "示例耳机 B 运动挂耳式", "price": "¥239", "rating": "4.7", "sales": "月销 5000+", "shop": "示例 B 官方店", "pros": "不掉", "cons": "通话一般"},
    {"name": "示例耳机 C 主动降噪蓝牙耳机", "price": "¥279", "rating": "4.9", "sales": "月销 2 万+", "shop": "示例 C 旗舰店", "pros": "降噪好、续航 30 小时", "cons": "盒子偏大"},
    {"name": "示例耳机 D 头戴式降噪", "price": "¥459", "rating": "4.9", "sales": "月销 3000+", "shop": "示例 D 自营", "pros": "音质好", "cons": "超预算"},
    {"name": "示例耳机 E 开放式", "price": "¥329", "rating": "4.6", "sales": "月销 800+", "shop": "示例 E 专卖店", "pros": "不堵耳", "cons": "漏音、超预算"}],
  "turns": [
    {"i": 1, "ms": 5200, "modelMs": 3900, "calls": 1, "label": "记下 3 个候选", "thought": "搜索结果第一屏有 3 款，先记下"},
    {"i": 2, "ms": 6100, "modelMs": 4300, "calls": 1, "label": "向下滚动", "thought": "继续往下看更多款", "changed": True},
    {"i": 3, "ms": 5800, "modelMs": 4100, "calls": 1, "label": "点击「示例耳机 C 主动降噪…」", "thought": "C 价格合适，进详情看评价", "changed": True}],
}
TRACE = [
  {"pc": 0, "i": 0, "fid": "tb1", "label": "打开 淘宝", "ms": 1900, "src": "native", "lk": 0, "ac": 40, "wt": 1860, "tier": "launch"},
  {"pc": 1, "i": 1, "fid": "tb1", "label": "点搜索框", "ms": 420, "src": "native", "lk": 60, "ac": 20, "wt": 340, "tier": "ahead"},
  {"pc": 2, "i": 2, "fid": "tb1", "label": "输入「蓝牙耳机」", "ms": 260, "src": "native", "lk": 30, "ac": 30, "wt": 200, "tier": "focus"},
  {"pc": 3, "i": 3, "fid": "tb1", "label": "回车 / 搜索", "ms": 1300, "src": "native", "lk": 0, "ac": 20, "wt": 1280},
  {"pc": 4, "i": 4, "fid": "tb1", "label": "AI 接管：在搜索结果里比较至少 5 款蓝牙耳机…", "ms": 96400, "src": "agent", "tier": "agent"}]
RUNS = [{"flowId": "tb1", "name": "挑耳机", "app": "淘宝", "at": 1763460000000, "r": {"ok": True, "done": 5, "total": 5, "ms": 100300, "trace": TRACE, "visionCalls": 0, "agent": [OUTCOME]}}]

async def shot(pg, name, full=False, clip=None):
    vp = pg.viewport_size
    if full:
        h = await pg.evaluate("() => Math.max(...[...document.querySelectorAll('.page .scroll')].map(e => e.scrollHeight))")
        await pg.set_viewport_size({"width": vp["width"], "height": max(vp["height"], min(int(h), 3600))}); await pg.wait_for_timeout(300)
    await pg.screenshot(path=os.path.join(OUT, name), clip=clip)
    if full: await pg.set_viewport_size(vp); await pg.wait_for_timeout(200)
    print(name, 'overflow', await pg.evaluate(OVERFLOW))

async def setup(b, w, h):
    pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.add_init_script(MOCK)
    await pg.route("**/v1/usage*", lambda r: r.fulfill(json={"mode": "unrestricted"}))
    await pg.goto("http://localhost:4173/")
    await pg.evaluate("([f,i,r])=>{localStorage.clear();localStorage.setItem('lumi.flows',JSON.stringify(f));localStorage.setItem('lumi.appicons',JSON.stringify(i));localStorage.setItem('lumi.flowRuns',JSON.stringify(r))}", [ALL, ICONS, RUNS])
    await pg.reload(); await pg.wait_for_timeout(800)
    return pg, errs

async def main():
    srv = subprocess.Popen(["npx", "vite", "preview", "--port", "4173", "--strictPort"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg, errs = await setup(b, 390, 844)
            await pg.evaluate("() => window.dispatchEvent(new CustomEvent('lumi-go', { detail: 'flows' }))"); await pg.wait_for_timeout(900)
            await shot(pg, 'flows-template.png')
            await pg.evaluate("() => window.dispatchEvent(new CustomEvent('lumi-go', { detail: 'flow:tb1' }))"); await pg.wait_for_timeout(900)
            await shot(pg, 'editor-agent.png', True)
            await pg.locator(".flow-steps li.is-agent .fs-head").first.click(); await pg.wait_for_timeout(500)
            await shot(pg, 'editor-agent-open.png', True)
            await pg.locator(".flow-steps li.is-agent .fs-head").first.click(); await pg.wait_for_timeout(300)
            await pg.locator(".add-btn").first.click(); await pg.wait_for_timeout(600)
            await shot(pg, 'add-sheet.png')
            await pg.locator(".sheet-back").click(position={"x": 195, "y": 20}); await pg.wait_for_timeout(500)
            # 最近运行 → 运行明细 + 对比卡（示例数据）
            await pg.locator(".rp-recent .chip-t").first.click(); await pg.wait_for_timeout(600)
            card = pg.locator(".ag-card").first
            await card.scroll_into_view_if_needed(); await pg.wait_for_timeout(300)
            await card.screenshot(path=os.path.join(OUT, 'compare-card.png'))
            await pg.locator(".ag-meta").first.click(); await pg.wait_for_timeout(300)
            await card.screenshot(path=os.path.join(OUT, 'compare-card-log.png'))
            await pg.locator(".ag-btns .btn-ghost").first.click(); await pg.wait_for_timeout(300)
            await card.screenshot(path=os.path.join(OUT, 'compare-card-feedback.png'))
            print('table scroll', await pg.evaluate("() => { const w = document.querySelector('.ag-tbl-wrap'); return [w.clientWidth, w.scrollWidth] }"))
            print('emoji check', await pg.evaluate("() => /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(document.body.innerText)"))
            print('page errors', errs)
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
