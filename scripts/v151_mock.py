import asyncio, json, sys
sys.path.insert(0,'/tmp'); exec(open('/tmp/v15mock.py').read().split('async def chat')[0])
FLOWS.append({"id":"f4","app":"小红书","pkg":"com.xingin.xhs","name":"看消息","desc":"","params":[],"runs":0,"updated":1,"steps":[{"kind":"launch","app":"小红书"},{"kind":"tap","sel":{"text":"消息"}}]})
FLOWS.append({"id":"f5","app":"抖音","pkg":"com.ss.android.ugc.aweme","name":"每日签到","desc":"","params":[],"runs":0,"updated":1,"steps":[{"kind":"launch","app":"抖音"}]})
for f in FLOWS:
    if f["app"]=="美团": f["pkg"]="com.sankuai.meituan"
    if f["app"]=="小红书": f["pkg"]="com.xingin.xhs"
ICONS={k:{"src":v} for k,v in json.load(open('/tmp/icons.json')).items()}
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={"width":390,"height":844},device_scale_factor=2)
        errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.route("**/v1/usage", lambda r: r.fulfill(json={"mode":"unrestricted"}))
        await pg.goto("http://localhost:4173/")
        await pg.evaluate("([f,i])=>{localStorage.setItem('lumi.flows',JSON.stringify(f));localStorage.setItem('lumi.appicons',JSON.stringify(i))}", [FLOWS,ICONS])
        await pg.reload(); await pg.wait_for_timeout(600)
        await pg.locator("[aria-label=侧栏]").first.click(); await pg.wait_for_timeout(400)
        await pg.locator(".s-item:has-text('Flow')").click(); await pg.wait_for_timeout(900)
        await pg.screenshot(path="/tmp/e2e/v151-grid.png")
        await pg.locator(".fapp:has-text('小红书')").click(); await pg.wait_for_timeout(700)
        await pg.screenshot(path="/tmp/e2e/v151-app.png")
        await pg.locator(".ftile:has-text('搜索')").click(); await pg.wait_for_timeout(500)
        await pg.screenshot(path="/tmp/e2e/v151-param.png")
        await pg.locator(".sheet-back").click(position={"x":20,"y":20}); await pg.wait_for_timeout(300)
        await pg.locator(".ftile:has-text('搜索') .ft-more").click(); await pg.wait_for_timeout(600)
        await pg.locator(".tl-card .fs-head").nth(3).click(); await pg.wait_for_timeout(300)
        await pg.screenshot(path="/tmp/e2e/v151-edit.png", full_page=True)
        print(errs); await b.close()
asyncio.run(main())
