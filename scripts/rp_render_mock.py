import asyncio, json
from playwright.async_api import async_playwright
msg = '''*她把茶杯轻轻放下，抬眼看你。* "你终于来了。我等了你整整三天。"

<think>他看起来很累……要不要先问问路上的事？不，先说正事。</think>

她压低声音：「北边的结界出现了裂缝，<span style="color:#7a3fb0;font-weight:600">魔物</span>随时会进城。」

【好感度：62】

<stats>
地点: 王都·白塔第七层
时间: 夜 23:40
HP: 84/100
MP: 30/120
背包: ["回复药×2", "旧地图", "银哨"]
状态: 轻微疲劳
任务: 前往北门调查裂缝
</stats>

<details style="background:#1f2433;color:#f3efe6;border-radius:14px;padding:12px 14px"><summary style="font-weight:600">📜 王都公告</summary><p style="margin:8px 0 0">即日起宵禁提前至 22:00。<br>违者罚银币 5 枚。</p></details>
'''
card = {"id":"c1","name":"艾琳","description":"白塔的守塔人","personality":"","scenario":"","first_mes":"","alternate_greetings":[],"mes_example":"","system_prompt":"","post_history":"","creator_notes":"白塔的守塔人，冷静而温柔。","tags":["奇幻"],"book":[],"created":1,
 "regex":[{"name":"好感度","find":"/【好感度：(\\d+)】/g","replace":"<div style=\"display:flex;align-items:center;gap:8px;font-size:13px;color:#b8452f\"><b>好感度</b><div style=\"flex:1;height:8px;border-radius:4px;background:#f3d9d2\"><div style=\"width:$1%;height:100%;border-radius:4px;background:linear-gradient(90deg,#f6a3b5,#d4587a)\"></div></div>$1</div>","placement":[2],"disabled":False,"markdownOnly":True,"promptOnly":False,"trim":[]}]}
conv = {"id":"v1","title":"艾琳","tier":"neon","updated":1763380000000,"char":"c1","messages":[{"role":"user","content":"我来了，发生什么事？"},{"role":"assistant","content":msg,"tier":"neon"}]}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":390,"height":844}, device_scale_factor=2)
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.route("**/v1/usage", lambda r: r.fulfill(json={"mode":"unrestricted"}))
        await pg.goto("http://localhost:4173/")
        await pg.evaluate("([c,v])=>{localStorage.setItem('lumi.chars',JSON.stringify([c]));localStorage.setItem('lumi.convs',JSON.stringify([v]))}", [card, conv])
        await pg.reload(); await pg.wait_for_timeout(800)
        await pg.locator(".home-top .side-btn").click(); await pg.wait_for_timeout(400)
        await pg.locator(".s-list >> text=艾琳").first.click(); await pg.wait_for_timeout(1500)
        await pg.locator(".chat .scroll").first.evaluate("e=>e.scrollTo(0,0)"); await pg.wait_for_timeout(300)
        await pg.screenshot(path="/tmp/e2e/rr1.png")
        await pg.locator(".rp-fold button").click(); await pg.wait_for_timeout(300); await pg.locator(".rp-frame").nth(1).evaluate("f=>f.contentDocument.querySelector(\"summary\").click()"); await pg.wait_for_timeout(400)
        await pg.locator(".chat .scroll").first.evaluate("e=>e.scrollTo(0,1e9)"); await pg.wait_for_timeout(500)
        await pg.screenshot(path="/tmp/e2e/rr2.png")
        print("frames", await pg.locator(".rp-frame").count(), "status", await pg.locator(".rp-status").count(), errs)
        await b.close()
asyncio.run(main())
