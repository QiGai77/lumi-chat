import json, time, asyncio, subprocess, sys
from playwright.async_api import async_playwright
KEY='lumi-app-7f3c9a2e'
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
        t=time.time(); await pg.goto("http://localhost:4173/"); await pg.wait_for_load_state("networkidle")
        print("load",round(time.time()-t,2))
        await pg.screenshot(path="/tmp/e2e/0-home-empty.png")
        async def ask(q,name,think=False,timeout=90):
            if think:
                await pg.evaluate("localStorage.setItem('lumi.think','1')"); await pg.goto("http://localhost:4173/"); await pg.wait_for_timeout(800)
            ta=pg.locator(".chat textarea").first if await pg.locator(".chat textarea").count() else pg.locator("textarea").first
            await ta.fill(q); t0=time.time()
            await (pg.locator(".chat .send") if await pg.locator(".chat").count() else pg.locator(".send")).last.click()
            first=None
            while time.time()-t0<timeout:
                n=await pg.locator(".msg.ai, .bot, .assistant").count()
                busy=await pg.locator(".send.stop").count()
                txt=await pg.evaluate("()=>{const a=[...document.querySelectorAll('.md, .think')];return a.length?a[a.length-1].innerText.length:0}")
                if txt and first is None: first=time.time()-t0
                if first and not busy: break
                await pg.wait_for_timeout(200)
            tot=time.time()-t0
            await pg.wait_for_timeout(400)
            await pg.screenshot(path=f"/tmp/e2e/{name}.png",full_page=False)
            print(name,"first",first and round(first,2),"total",round(tot,2))
        await ask("你好，你是什么模型？谁开发的？","1-identity")
        await ask("用一个 markdown 表格对比 Python、Go、Rust 的性能、学习曲线、生态，再给一段 Go 的 HTTP 服务器代码","2-table-code")
        await ask("9.11 和 9.9 哪个大？","3-think",think=True)
        # scroll position check
        info=await pg.evaluate("()=>{const s=document.scrollingElement;const els=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+5&&getComputedStyle(e).overflowY!='visible');return {doc:[s.scrollTop,s.scrollHeight,s.clientHeight],scrollers:els.slice(0,5).map(e=>[e.className,e.scrollTop,e.scrollHeight,e.clientHeight])}}")
        print("scroll",info)
        # stop mid-stream
        ta=pg.locator(".chat textarea").first
        await ta.fill("写一篇 1500 字的散文，题目是秋天的南京"); await (pg.locator(".chat .send") if await pg.locator(".chat").count() else pg.locator(".send")).last.click()
        await pg.wait_for_timeout(3500)
        if await pg.locator(".send.stop").count(): await pg.locator(".send.stop").click(); print("stopped ok")
        await pg.wait_for_timeout(800); await pg.screenshot(path="/tmp/e2e/4-stopped.png")
        # horizontal overflow check
        ov=await pg.evaluate("()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1&&!e.closest('pre,table,.folders,.tbl,.md-table')}).slice(0,8).map(e=>e.tagName+'.'+e.className+' '+Math.round(e.getBoundingClientRect().right))")
        print("overflow",ov)
        # back home
        await pg.goto("http://localhost:4173/"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path="/tmp/e2e/5-home-after.png")
        print("convs",await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.convs')||'[]').map(c=>c.title)"))
        await b.close()
    srv.kill()
    print("\n".join(log) or "no console errors")
asyncio.run(main())
