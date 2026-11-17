import asyncio, json
from playwright.async_api import async_playwright
FLOWS=[{"id":"f1","app":"小红书","pkg":"com.xingin.xhs","name":"搜索","desc":"搜索笔记","params":["关键词"],"runs":3,"lastOk":True,"updated":1,"steps":[
 {"kind":"launch","app":"小红书","pkg":"com.xingin.xhs"},{"kind":"tap","sel":{"text":"跳过"},"optional":True,"note":"关掉开屏广告"},
 {"kind":"tap","sel":{"desc":"搜索","id":"com.xingin.xhs:id/search"},"x":0.92,"y":0.06},{"kind":"input","text":"{关键词}"},{"kind":"enter"},{"kind":"wait","sel":{"text":"综合"}}]},
 {"id":"f2","app":"美团","pkg":"com.sankuai.meituan","name":"点外卖","desc":"按店名点上次的外卖","params":["店名"],"runs":1,"updated":1,"steps":[
 {"kind":"launch","app":"美团"},{"kind":"tap","sel":{"text":"外卖"}},{"kind":"tap","sel":{"desc":"搜索"}},{"kind":"input","text":"{店名}"},{"kind":"enter"},{"kind":"tap","sel":{"text":"再来一单"}},{"kind":"tap","sel":{"text":"提交订单"},"confirm":True}]},
 {"id":"f3","app":"小红书","name":"发笔记","desc":"","params":[],"runs":0,"updated":1,"steps":[{"kind":"launch","app":"小红书"},{"kind":"tap","sel":{"text":"跳过"}},{"kind":"tap","sel":{"text":"跳过"}},{"kind":"tap","x":0.5,"y":0.95},{"kind":"tap","sel":{"text":"从相册选择"}},{"kind":"input","text":"今天去了海边露营"}]}]
OPT={"name":"发笔记","desc":"从相册选图发一篇笔记","steps":[{"kind":"launch","app":"小红书"},{"kind":"tap","sel":{"text":"跳过"},"optional":True,"note":"关掉开屏广告"},{"kind":"tap","sel":{"desc":"发布"},"x":0.5,"y":0.95,"note":"点底部加号"},{"kind":"tap","sel":{"text":"从相册选择"}},{"kind":"input","text":"{正文}"},{"kind":"tap","sel":{"text":"发布笔记"},"confirm":True}]}
async def chat(route):
    d='data: '+json.dumps({"choices":[{"delta":{"content":json.dumps(OPT,ensure_ascii=False)}}]},ensure_ascii=False)+'\n\ndata: [DONE]\n\n'
    await route.fulfill(status=200, headers={"Content-Type":"text/event-stream","Access-Control-Allow-Origin":"*"}, body=d)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={"width":390,"height":844},device_scale_factor=2)
        errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.route("**/v1/usage", lambda r: r.fulfill(json={"mode":"unrestricted"}))
        await pg.route("**/v1/chat/completions", chat)
        await pg.goto("http://localhost:4173/")
        await pg.evaluate("f=>localStorage.setItem('lumi.flows',JSON.stringify(f))", FLOWS)
        await pg.reload(); await pg.wait_for_timeout(600)
        await pg.locator("[aria-label=侧栏]").first.click(); await pg.wait_for_timeout(400)
        await pg.locator(".s-item:has-text('Flow')").click(); await pg.wait_for_timeout(600)
        await pg.screenshot(path="/tmp/e2e/v15-list.png")
        await pg.locator(".flow-row .grow:has-text('搜索')").click(); await pg.wait_for_timeout(400)
        await pg.locator(".fs-head").nth(3).click(); await pg.wait_for_timeout(300)
        await pg.screenshot(path="/tmp/e2e/v15-edit.png", full_page=True)
        await pg.locator(".back-btn, [aria-label=返回]").first.click(); await pg.wait_for_timeout(400)
        await pg.locator(".flow-row .grow:has-text('发笔记')").click(); await pg.wait_for_timeout(400)
        await pg.locator("button:has-text('优化')").first.click(); await pg.wait_for_timeout(1200)
        await pg.locator(".sec:has-text('优化后')").scroll_into_view_if_needed()
        await pg.screenshot(path="/tmp/e2e/v15-opt.png")
        print(errs)
        await b.close()
asyncio.run(main())
