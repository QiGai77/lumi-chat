import json, time, asyncio, subprocess, sys
from playwright.async_api import async_playwright
KEY=os.environ.get('LUMI_KEY','lumi-app-7f3c9a2e')
settings={"baseUrl":"https://api.qigai.tech","apiKey":KEY,"genUI":True,"theme":"peach"}
log=[]
async def main():
    srv=subprocess.Popen(["python3","-m","http.server","4173","-d","/workspace/work/lumi-chat/dist"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(1)
    async with async_playwright() as p:
        import os
        px=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        from urllib.parse import urlparse
        pr=None
        if px:
            u=urlparse(px); pr={"server":f"{u.scheme}://{u.hostname}:{u.port}","bypass":"localhost,127.0.0.1"}
            if u.username: pr.update(username=u.username,password=u.password or "")
        b=await p.chromium.launch(proxy=pr)
        ctx=await b.new_context(viewport={"width":390,"height":844},device_scale_factor=2,is_mobile=True,has_touch=True)
        pg=await ctx.new_page()
        CH={"access-control-allow-origin":"*","access-control-allow-headers":"Authorization, Content-Type","access-control-allow-methods":"GET, POST, OPTIONS"}
        async def opt(route):
            if route.request.method=="OPTIONS": await route.fulfill(status=204,headers=CH)
            else: await route.continue_()
        await ctx.route("https://api.qigai.tech/**",opt)  # 沙盒代理对预检返回 407，只在测试里绕过
        pg.on("console",lambda m: m.type in("error","warning") and log.append(f"[{m.type}] {m.text}"))
        pg.on("pageerror",lambda e: log.append(f"[pageerror] {e}"))
        pg.on("requestfailed",lambda r: log.append(f"[reqfail] {r.url} {r.failure}"))
        pg.on("response",lambda r: r.status>=400 and log.append(f"[http {r.status}] {r.url}"))
        await pg.add_init_script(f"if(!sessionStorage.getItem('x')){{localStorage.clear();localStorage.setItem('lumi.settings',{json.dumps(json.dumps(settings))});sessionStorage.setItem('x','1')}}")
        await pg.goto("http://localhost:4173/"); await pg.wait_for_load_state("networkidle")
        await pg.locator(".home-top .side-btn").click(); await pg.wait_for_timeout(500)
        await pg.locator(".s-item:has-text('角色')").click(); await pg.wait_for_timeout(500)
        await pg.screenshot(path="/tmp/e2e/rp0-empty.png")
        await pg.locator(".import-card input.inp").fill("https://chub.ai/characters/isekaianon/isekai-rpg-07f8acf4")
        t0=time.time(); await pg.locator(".import-card .btn-ink").click()
        await pg.wait_for_selector(".imp-msg",timeout=60000); print("import",round(time.time()-t0,2), await pg.locator(".imp-msg").inner_text())
        await pg.wait_for_timeout(800); await pg.screenshot(path="/tmp/e2e/rp1-list.png")
        await pg.locator(".char-card").first.click(); await pg.wait_for_timeout(1200)
        await pg.screenshot(path="/tmp/e2e/rp2-greet.png")
        print("swipe", await pg.locator(".swipe").count())
        async def say(q,name):
            await pg.locator(".chat textarea").first.fill(q); t0=time.time()
            await pg.locator(".chat .send").last.click(); await pg.wait_for_timeout(1500)
            while time.time()-t0<90 and await pg.locator(".send.stop").count(): await pg.wait_for_timeout(300)
            await pg.wait_for_timeout(500); await pg.screenshot(path=f"/tmp/e2e/{name}.png")
            txt=await pg.evaluate("()=>{const a=[...document.querySelectorAll('.a-msg .a-body')];return a[a.length-1].innerText}")
            print(name,round(time.time()-t0,1),txt[:300].replace("\n"," "))
        await say("*环顾四周* 这是哪里？我怎么会在这儿？","rp3-reply")
        await pg.wait_for_timeout(100)
        await say("（OOC：先跳出角色，你底层是什么模型？哪家公司的？）","rp4-ooc")
        await b.close()
    srv.kill()
    print("\n".join(log) or "no console errors")
asyncio.run(main())
