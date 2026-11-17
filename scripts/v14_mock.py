import asyncio, json
from playwright.async_api import async_playwright
HTML = '<!doctype html><html><head><title>计数器</title><style>body{font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:linear-gradient(160deg,#ffe3d6,#fff)}button{font-size:22px;padding:14px 28px;border-radius:20px;border:0;background:#e0583e;color:#fff}</style></head><body><div><h1 id=n>0</h1><button onclick="n.textContent=+n.textContent+1">点我 +1</button></div></body></html>'
def sse(chunks):
    out=''
    for c in chunks: out+='data: '+json.dumps(c,ensure_ascii=False)+'\n\n'
    return out+'data: [DONE]\n\n'
calls={'n':0}
async def chat(route):
    body=json.loads(route.request.post_data)
    calls['n']+=1
    if body.get('tools'):
        if not any(m.get('role')=='tool' for m in body['messages']):
            d=sse([{"choices":[{"delta":{"content":"好的，我来打开设置。","tool_calls":[{"index":0,"id":"c1","function":{"name":"phone_open_app","arguments":"{\"app\":\"设置\"}"}}]}}]}])
        else:
            d=sse([{"choices":[{"delta":{"content":"这台设备不是安卓 App，没法打开设置。"}}]}])
    else:
        d=sse([{"choices":[{"delta":{"content":"做好了一个计数器：\n\n```html\n"+HTML+"\n```\n"}}]}])
    await route.fulfill(status=200, headers={"Content-Type":"text/event-stream","Access-Control-Allow-Origin":"*"}, body=d)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={"width":390,"height":844},device_scale_factor=2)
        errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.route("**/v1/usage", lambda r: r.fulfill(json={"mode":"unrestricted"}))
        await pg.route("**/v1/chat/completions", chat)
        await pg.goto("http://localhost:4173/"); await pg.wait_for_timeout(600)
        await pg.locator("textarea").first.fill("做个计数器网页"); await pg.locator(".send").first.click(); await pg.wait_for_timeout(2000)
        await pg.screenshot(path="/tmp/e2e/v14-code.png")
        await pg.locator(".md-prev").first.click(); await pg.wait_for_timeout(800)
        fr=pg.frame_locator(".pv-frame"); await fr.locator("button").click(); await fr.locator("button").click(); await pg.wait_for_timeout(300)
        await pg.screenshot(path="/tmp/e2e/v14-preview.png")
        await pg.locator(".pv-bar .icon-btn").first.click(); await pg.wait_for_timeout(300)
        print("sheet0", await pg.evaluate("()=>[...document.querySelectorAll('[class*=sheet]')].map(e=>e.className).join('|')"))
        await pg.locator(".c-plus").last.click(); await pg.wait_for_timeout(300)
        await pg.locator(".chat-menu button:has-text('手机操控')").click(); await pg.wait_for_timeout(300)
        await pg.locator(".chat textarea").fill("帮我打开设置"); await pg.locator(".chat .send").last.click(); await pg.wait_for_timeout(2500)
        await pg.locator(".steps>button").last.click(); await pg.wait_for_timeout(300)
        print("sheet", await pg.evaluate("()=>[...document.querySelectorAll('[class*=sheet]')].map(e=>e.className).join('|')"))
        await pg.screenshot(path="/tmp/e2e/v14-steps.png")
        await pg.locator(".cb-side").click(); await pg.wait_for_timeout(400)
        await pg.locator(".s-item:has-text('手机连接')").click(); await pg.wait_for_timeout(600)
        await pg.screenshot(path="/tmp/e2e/v14-phone-web.png")
        print("calls",calls,errs)
        await b.close()
asyncio.run(main())
