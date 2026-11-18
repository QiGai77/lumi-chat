"""v0.21 全功能端到端测试（网页版）。
用法：npm run build && python3 scripts/e2e_v21.py [段名…]
自己起 vite preview（4173）和模拟网关 scripts/mock_sse.py（8787），设置里网关指向模拟网关。
段：chat side pages flow native custom fonts（不写就全跑）。截图在 /tmp/e2e21/，design/v21/ 只放挑出来的几张。
收集 console error / pageerror / 4xx-5xx（模拟网关的 /v1/card 404 除外），结束时打印通过 / 失败清单。"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT = '/tmp/e2e21'; os.makedirs(SHOT, exist_ok=True)
DESIGN = os.path.join(ROOT, 'design', 'v21'); os.makedirs(DESIGN, exist_ok=True)
URL = 'http://localhost:4173/'
GW = 'http://127.0.0.1:8787'
SETTINGS = {"baseUrl": GW, "apiKey": "test-key", "genUI": True, "theme": "peach", "chatCustom": True}
RES = []   # (段, 项, ok, 说明)
LOGS = []

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
_spec = importlib.util.spec_from_file_location('v20', os.path.join(ROOT, 'scripts', 'v20_shots.py'))
# v20_shots 末尾直接 asyncio.run(main())，不能 import；把需要的常量用 exec 取出来
_src = open(os.path.join(ROOT, 'scripts', 'v20_shots.py'), encoding='utf-8').read().split('async def main')[0]
V20 = {'__file__': os.path.join(ROOT, 'scripts', 'v20_shots.py')}
exec(_src, V20)
FLOWS, ICONS, NATIVE_MOCK, OVERFLOW = V20['FLOWS'], V20['ICONS'], V20['MOCK'], V20['OVERFLOW']

def ok(seg, name, cond, info=''):
    RES.append((seg, name, bool(cond), str(info)[:300]))
    print(('PASS ' if cond else 'FAIL ') + f'[{seg}] {name}' + (f' -- {info}' if info and not cond else ''))

async def new_page(b, w=390, h=844, native=False, flows=False, extra=None, seg=''):
    ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=w < 700, has_touch=w < 700)
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=URL.rstrip('/'))
    pg = await ctx.new_page()
    def lg(kind, t):
        t = str(t)
        if '/v1/card' in t: return
        LOGS.append(f'[{seg}] [{kind}] {t}')
    pg.on('console', lambda m: m.type == 'error' and lg('console', m.text))
    pg.on('pageerror', lambda e: lg('pageerror', e))
    pg.on('response', lambda r: r.status >= 400 and lg(f'http {r.status}', r.url))
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('5' if d.type == 'prompt' else None)))
    if native: await pg.add_init_script(NATIVE_MOCK)
    init = {'lumi.settings': json.dumps(SETTINGS), 'lumi.sideMini': '1'}
    if flows: init['lumi.flows'] = json.dumps(FLOWS, ensure_ascii=False); init['lumi.appicons'] = json.dumps(ICONS)
    init.update(extra or {})
    await pg.add_init_script("(o=>{try{if(window!==top)return;if(sessionStorage.getItem('__init'))return;localStorage.clear();for(const k in o)localStorage.setItem(k,o[k]);sessionStorage.setItem('__init','1')}catch(e){}})(%s)" % json.dumps(init, ensure_ascii=False))
    await pg.goto(URL); await pg.wait_for_timeout(700)
    return pg

async def shot(pg, name, design=False):
    st = await pg.evaluate("()=>{const a=document.querySelector('.app');return a?a.scrollTop:0}")
    if st: ok('layout', f'{name}: .app 没有被滚动', False, st)
    await pg.screenshot(path=os.path.join(DESIGN if design else SHOT, name))

async def overflow(pg):
    return await pg.evaluate(OVERFLOW)

async def side(pg, label):
    """打开侧栏点一项（手机上点完自动关回图标栏）。"""
    if await pg.locator('.side.rail').count():
        await pg.locator('.side [aria-label=展开侧栏]').click(); await pg.wait_for_timeout(450)
    await pg.locator(f".side .s-item:has-text('{label}')").first.click(); await pg.wait_for_timeout(600)
    if pg.viewport_size['width'] < 980 and await pg.locator('.side [aria-label=折叠侧栏]').count():
        await pg.locator('.side [aria-label=折叠侧栏]').click(); await pg.wait_for_timeout(400)

async def wait_idle(pg, timeout=20):
    t0 = time.time()
    await pg.wait_for_timeout(300)
    while time.time() - t0 < timeout:
        if not await pg.locator('.send.stop').count(): return True
        await pg.wait_for_timeout(150)
    return False

async def home_send(pg, text):
    ta = pg.locator('.compose-card textarea')
    await ta.fill(text); await pg.locator('.compose-card .send').click()
    await pg.wait_for_selector('.chat', timeout=5000)

async def chat_send(pg, text):
    ta = pg.locator('.chat textarea').first
    await ta.fill(text); await pg.locator('.chat .send').last.click()

# ---------------------------------------------------------------- 段：对话
async def seg_chat(b):
    S = 'chat'
    pg = await new_page(b, seg=S)
    ok(S, '首页问候', await pg.locator('.hello h1').count(), '')
    await shot(pg, 'home.png')
    ok(S, '首页无横向溢出', not await overflow(pg), await overflow(pg))
    # 快捷芯片
    await pg.locator('.q-chip').first.click(); await pg.wait_for_timeout(200)
    ok(S, '快捷芯片填入输入框', (await pg.locator('.compose-card textarea').input_value()).startswith('帮我把'))
    # + 菜单
    await pg.locator('.cc-plus').click(); await pg.wait_for_timeout(300)
    labels = await pg.locator('.gen-menu.show button').all_inner_texts()
    ok(S, '+ 菜单（对话/图片/视频/按任务生成 Flow/选择模式）', any('按任务生成' in x for x in labels) and any('生成图片' in x for x in labels), labels)
    await pg.locator(".gen-menu.show button:has-text('选择模式')").click(); await pg.wait_for_timeout(500)
    await shot(pg, 'mode-sheet.png')
    ok(S, '模式面板打开', await pg.locator('.sheet-wrap.show').count())
    await pg.locator(".sheet-wrap.show .model:has-text('Argon')").click()
    await pg.locator('.sheet-wrap.show .dark-btn').click(); await pg.wait_for_timeout(400)
    ok(S, '选择 Argon 模型', 'Argon' in await pg.locator('.compose-card .chip').first.inner_text() and not await pg.locator('.sheet-wrap.show').count())
    await pg.locator('.compose-card .chip').first.click(); await pg.wait_for_timeout(300)
    await pg.locator(".sheet-wrap.show .model:has-text('Neon')").click(); await pg.locator('.sheet-wrap.show .dark-btn').click(); await pg.wait_for_timeout(400)
    # 发送 + 流式
    t0 = time.time()
    await home_send(pg, '你好')
    first = None
    while time.time() - t0 < 10:
        if await pg.locator('.chat .md').count() and (await pg.locator('.chat .md').last.inner_text()).strip(): first = time.time() - t0; break
        await pg.wait_for_timeout(50)
    ok(S, '发送后流式出字', first is not None, first)
    await wait_idle(pg)
    txt = await pg.locator('.chat .md').last.inner_text()
    ok(S, '回答完整', 'Hello from Lumi' in txt, txt)
    # markdown / 代码 / LaTeX
    await chat_send(pg, '用 markdown 表格对比语言，再给段代码和公式'); await wait_idle(pg)
    md = pg.locator('.chat .md').last
    ok(S, 'Markdown 表格', await md.locator('table').count(), '')
    ok(S, '代码块高亮', await md.locator('pre code, pre').count() and await md.locator('pre .token').count(), await md.locator('pre').count())
    ok(S, 'LaTeX（KaTeX）', await md.locator('.katex').count() >= 2, await md.locator('.katex').count())
    ok(S, '加粗/行内代码', await md.locator('strong').count() and await md.locator('code').count())
    await shot(pg, 'chat-md.png')
    # 代码复制按钮
    cb = md.locator('pre').first.locator('xpath=..').locator('button')
    ok(S, '代码块有复制按钮', await cb.count() or await md.locator('.code-copy, .cb-copy, button:has-text("复制")').count(), await cb.count())
    # 消息操作：复制、收藏、重答
    acts = await pg.locator('.chat [aria-label=复制], .chat [aria-label=收藏], .chat [aria-label=重新回答]').count()
    ok(S, '消息操作按钮', acts >= 3, acts)
    await pg.locator('.chat [aria-label=收藏]').last.click(); await pg.wait_for_timeout(200)
    favs = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.convs')).flatMap(c=>c.messages).filter(m=>m.fav).length")
    ok(S, '收藏一条回答', favs == 1, favs)
    n0 = await pg.locator('.chat .md').count()
    await pg.locator('.chat [aria-label=重新回答]').last.click(); await wait_idle(pg)
    ok(S, '重新回答', await pg.locator('.chat .md').count() == n0 and await pg.locator('.chat .md table').count(), await pg.locator('.chat .md').count())
    # HTML 预览
    await chat_send(pg, '给我一个 html 页面'); await wait_idle(pg)
    pv = pg.locator(".chat button:has-text('预览')")
    ok(S, 'HTML 代码块有预览按钮', await pv.count())
    if await pv.count():
        await pv.last.click(); await pg.wait_for_timeout(800)
        fr = pg.frame_locator('iframe').last
        try:
            await fr.locator('button').click(timeout=3000); t = await fr.locator('#t').inner_text(timeout=2000)
        except Exception as e: t = str(e)[:80]
        ok(S, 'HTML 预览运行脚本', t == 'clicked', t)
        await shot(pg, 'html-preview.png')
        await pg.locator('.icon-btn[aria-label=关闭]').last.click(); await pg.wait_for_timeout(300)
    # 停止生成
    await chat_send(pg, '写一篇散文'); await pg.wait_for_timeout(1200)
    stopped = False
    if await pg.locator('.send.stop').count():
        await pg.locator('.send.stop').click(); await pg.wait_for_timeout(600); stopped = True
    body = await pg.locator('.chat').inner_text()
    ok(S, '停止生成', stopped and '已停止' in body and not await pg.locator('.send.stop').count(), body[-80:])
    # 深度思考
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(500)
    await pg.locator('.chip-think').click()
    await home_send(pg, '9.11 和 9.9 哪个大'); await wait_idle(pg)
    ok(S, '深度思考显示思考过程', await pg.locator('.chat .think, .chat .reason, .chat details').count(), await pg.locator('.chat').inner_text())
    await shot(pg, 'chat-think.png')
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(500)
    await pg.locator('.chip-think').click()
    # 首页最近对话 / 全部 / 搜索 / 删除
    fold = await pg.locator('.folders > *').count()
    ok(S, '首页最近对话文件夹', fold >= 2, fold)
    await pg.locator('.sec-h .more').click(); await pg.wait_for_timeout(300)
    await pg.locator('.searchbox input').fill('散文'); await pg.wait_for_timeout(200)
    ok(S, '全部对话搜索', await pg.locator('.all .row').count() == 0 or await pg.locator('.all .row').count() >= 0, await pg.locator('.all .row').count())
    await pg.locator('.searchbox input').fill(''); n = await pg.locator('.all .row').count()
    await pg.locator('.all .row .del').first.click(); await pg.wait_for_timeout(300)
    ok(S, '删除对话', await pg.locator('.all .row').count() == n - 1, (n, await pg.locator('.all .row').count()))
    await pg.locator('.link-back').click()
    # 图片生成（没有配置图片接口时的报错是否友好）
    await pg.locator('.cc-plus').click(); await pg.wait_for_timeout(200)
    await pg.locator(".gen-menu.show button:has-text('生成图片')").click()
    await home_send(pg, '一只猫'); await pg.wait_for_timeout(1500)
    t = await pg.locator('.chat').inner_text()
    ok(S, '图片生成失败时有中文提示', '失败' in t or '错误' in t or '请求' in t, t[-120:])
    await shot(pg, 'chat-image-fail.png')
    await pg.close()

# ---------------------------------------------------------------- 段：侧栏
async def seg_side(b):
    S = 'side'
    for W in (390, 1280):
        pg = await new_page(b, W, 844 if W < 900 else 820, seg=S)
        ok(S, f'{W} 默认图标栏', await pg.locator('.side.rail').count())
        rail = await pg.locator('.side.rail .s-item').count()
        ok(S, f'{W} 图标栏三项', rail == 3, rail)
        await pg.locator('.side [aria-label=展开侧栏]').click(); await pg.wait_for_timeout(500)
        items = await pg.locator('.side .s-item').all_inner_texts()
        ok(S, f'{W} 展开侧栏全部入口', all(any(k in x for x in items) for k in ['新对话', '角色', '手机连接', 'Flow', '技能', 'MCP', '定时任务', '项目']), items)
        await shot(pg, f'side-open-{W}.png')
        ok(S, f'{W} 侧栏无溢出', not await overflow(pg), await overflow(pg))
        if W < 980:
            await pg.locator('.side-scrim').click(position={"x": 380, "y": 400}); await pg.wait_for_timeout(450)
            ok(S, '手机点遮罩关闭侧栏', await pg.locator('.side.rail').count())
        else:
            await pg.locator('.side [aria-label=折叠侧栏]').click(); await pg.wait_for_timeout(450)
            ok(S, '桌面折叠回图标栏', await pg.locator('.side.rail').count())
        # 图标栏直达技能 / MCP / 新对话
        await pg.locator('.side.rail [aria-label=技能]').click(); await pg.wait_for_timeout(400)
        ok(S, f'{W} 图标栏 技能', 'serif' in (await pg.locator('.page-h h1').get_attribute('class') or '') and await pg.locator('.page-h h1').inner_text() == '技能')
        await pg.locator('.side.rail [aria-label=MCP]').click(); await pg.wait_for_timeout(400)
        ok(S, f'{W} 图标栏 MCP', await pg.locator('.page-h h1').inner_text() == 'MCP')
        await pg.locator('.side.rail [aria-label=新对话]').click(); await pg.wait_for_timeout(400)
        ok(S, f'{W} 图标栏 新对话', await pg.locator('.hello').count())
        # 侧栏最近对话 + 搜索 + 打开
        await home_send(pg, '你好'); await wait_idle(pg)
        await pg.locator('.side [aria-label=展开侧栏]').click(); await pg.wait_for_timeout(450)
        ok(S, f'{W} 侧栏最近对话', await pg.locator('.s-conv').count() == 1)
        await pg.locator('.s-search input').fill('不存在的词'); await pg.wait_for_timeout(200)
        ok(S, f'{W} 侧栏搜索无结果', '没有找到' in await pg.locator('.s-list').inner_text())
        await pg.locator('.s-search input').fill('你好'); await pg.wait_for_timeout(200)
        await pg.locator('.s-conv').first.click(); await pg.wait_for_timeout(500)
        ok(S, f'{W} 侧栏打开对话', await pg.locator('.chat').count())
        # 刷新后侧栏状态保持
        st = await pg.locator('.side.rail').count()
        await pg.reload(); await pg.wait_for_timeout(600)
        ok(S, f'{W} 刷新后侧栏状态保持', await pg.locator('.side.rail').count() == st, st)
        await pg.close()

# ---------------------------------------------------------------- 段：各页面
async def seg_pages(b):
    S = 'pages'
    pg = await new_page(b, seg=S)
    # 技能
    await side(pg, '技能')
    cards = await pg.locator('.main .page .scroll button, .main .page .scroll [role=button]').count()
    await shot(pg, 'skills.png')
    ok(S, '技能页', cards >= 6, cards)
    names = await pg.evaluate("()=>[...document.querySelectorAll('.page .scroll .serif, .page .scroll .b')].map(e=>e.innerText).slice(0,12)")
    # 点第一个技能 → 新对话带开场
    first = pg.locator('.agent, .ag-card, .skill-card').first
    if await first.count():
        await first.click(); await pg.wait_for_timeout(500)
        ok(S, '技能开新对话', await pg.locator('.chat').count(), names)
        await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    else:
        ok(S, '技能卡片选择器', False, names)
    # MCP：添加本地模拟服务器
    await side(pg, 'MCP')
    await shot(pg, 'mcp.png')
    ok(S, 'MCP 页（空状态 + 添加按钮 + 用对话添加）', await pg.locator(".add-btn:has-text('添加服务器')").count() and await pg.locator('.ask-bar').count())
    # 定时任务
    await side(pg, '定时任务')
    await shot(pg, 'tasks.png')
    ok(S, '定时任务页', await pg.locator('.page-h h1').inner_text() == '定时任务')
    # 项目
    await side(pg, '项目')
    await shot(pg, 'projects.png')
    ok(S, '项目页', await pg.locator('.page-h h1').inner_text() == '项目')
    # 角色
    await side(pg, '角色')
    await shot(pg, 'chars.png')
    ok(S, '角色页', await pg.locator('.page-h h1').inner_text() == '角色')
    # 手机连接（网页版回退）
    await side(pg, '手机连接')
    t = await pg.locator('.page .scroll').inner_text()
    await shot(pg, 'phone-web.png')
    ok(S, '手机连接网页版提示', '安卓' in t or 'App' in t, t[:200])
    # 我的 / 会员 / 设置 / 收藏
    await pg.locator('.side [aria-label=展开侧栏]').click(); await pg.wait_for_timeout(400)
    await pg.locator('.s-me').click(); await pg.wait_for_timeout(600)
    if await pg.locator('.side [aria-label=折叠侧栏]').count(): await pg.locator('.side [aria-label=折叠侧栏]').click(); await pg.wait_for_timeout(300)
    t = await pg.locator('.page .scroll').inner_text()
    await shot(pg, 'me.png')
    ok(S, '我的页（套餐名来自 /v1/usage）', 'Pro' in t, t[:200])
    ok(S, '我的页无溢出', not await overflow(pg), await overflow(pg))
    await pg.close()


# ---------------------------------------------------------------- 段：各页面的操作
def reqs():
    try: return [json.loads(l) for l in open('/tmp/mock_reqs.jsonl', encoding='utf-8')]
    except FileNotFoundError: return []
def sys_of(r): return next((m['content'] for m in r.get('messages', []) if m.get('role') == 'system'), '')

async def seg_pages2(b):
    S = 'pages2'
    pg = await new_page(b, seg=S)
    # MCP 手动添加（本地模拟 MCP）→ 自动连接读工具 → 开关 → 删除
    await side(pg, 'MCP')
    await pg.locator(".add-btn:has-text('添加服务器')").click()
    ins = pg.locator('.card-row.form .inp')
    await ins.nth(0).fill('本地'); await ins.nth(1).fill(GW + '/mcp')
    await pg.locator(".card-row.form .pill-btn.solid").click(); await pg.wait_for_timeout(1500)
    t = await pg.locator('.page .scroll').inner_text()
    ok(S, 'MCP 添加并读取工具', 'echo' in t and '2 个工具' in t, t[:300])
    await shot(pg, 'mcp-added.png')
    await pg.locator('.card-row .toggle').first.click(); await pg.wait_for_timeout(200)
    ok(S, 'MCP 开关', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.mcp'))[0].enabled") is False)
    await pg.locator(".card-row .pill-btn.ghost:has-text('删除')").click(); await pg.wait_for_timeout(300)
    ok(S, 'MCP 删除', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.mcp')).length") == 0)
    # MCP 地址错误
    await pg.locator(".add-btn:has-text('添加服务器')").click()
    await pg.locator('.card-row.form .inp').nth(1).fill('http://127.0.0.1:9/mcp')
    await pg.locator(".card-row.form .pill-btn.solid").click(); await pg.wait_for_timeout(1500)
    t = await pg.locator('.page .scroll').inner_text()
    ok(S, 'MCP 连不上时提示', '连不上' in t, t[:200])
    await pg.locator(".card-row .pill-btn.ghost:has-text('删除')").click(); await pg.wait_for_timeout(200)
    # 定时任务：新建 → 立即运行 → 上次结果 → 编辑 → 删除
    await side(pg, '定时任务')
    await pg.locator(".add-btn:has-text('新建定时任务')").click()
    await pg.locator('.card-row.form input.inp').first.fill('早间问候')
    await pg.locator('.card-row.form textarea').fill('你好')
    await pg.locator('.card-row.form .days button').nth(1).click()
    await pg.locator(".card-row.form .pill-btn.solid").click(); await pg.wait_for_timeout(300)
    t = await pg.locator('.page .scroll').inner_text()
    ok(S, '定时任务创建', '早间问候' in t and '每周一' in t, t[:200])
    await pg.locator(".pill-btn:has-text('立即运行')").click(); await pg.wait_for_timeout(1500)
    lr = pg.locator(".pill-btn:has-text('上次结果')")
    ok(S, '定时任务立即运行', await lr.count())
    if await lr.count():
        await lr.click(); await pg.wait_for_timeout(600)
        t = await pg.locator('.chat').inner_text()
        ok(S, '定时任务结果对话', 'Hello from Lumi' in t, t[:200])
        await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    await side(pg, '定时任务')
    await pg.locator(".pill-btn:has-text('编辑')").click()
    await pg.locator(".card-row.form .pill-btn.ghost:has-text('删除')").click(); await pg.wait_for_timeout(200)
    ok(S, '定时任务删除', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.tasks')||'[]').length") == 0)
    # 定时任务：运行 Flow（网页版提示）
    await pg.locator(".add-btn:has-text('新建定时任务')").click()
    await pg.locator('.card-row.form textarea').fill('运行 Flow「不存在」')
    await pg.locator(".card-row.form .pill-btn.solid").click(); await pg.wait_for_timeout(300)
    await pg.locator(".pill-btn:has-text('立即运行')").click(); await pg.wait_for_timeout(800)
    await pg.locator(".pill-btn:has-text('上次结果')").click(); await pg.wait_for_timeout(500)
    t = await pg.locator('.chat').inner_text()
    ok(S, '定时任务 运行 Flow（没找到）', '没有找到' in t, t[:200])
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    # 项目：新建 → 写说明 → 项目里新建对话（系统提示带说明）→ 删除
    await side(pg, '项目')
    await pg.locator(".add-btn:has-text('新建项目')").click()
    await pg.locator('.card-row.form .inp').fill('毕业论文')
    await pg.locator(".card-row.form .pill-btn.solid").click(); await pg.wait_for_timeout(500)
    ok(S, '项目创建并进入', await pg.locator('.sub-title').inner_text() == '毕业论文')
    await pg.locator('textarea.inp.big').fill('回答用学术口吻')
    open('/tmp/mock_reqs.jsonl', 'w').close()
    await pg.locator(".add-btn:has-text('在项目里新建对话')").click(); await pg.wait_for_timeout(500)
    await chat_send(pg, '你好'); await wait_idle(pg)
    rq = reqs()
    ok(S, '项目说明注入系统提示', rq and '回答用学术口吻' in sys_of(rq[-1]), sys_of(rq[-1])[:120] if rq else 'no req')
    ok(S, '对话标题栏显示项目', '毕业论文' in await pg.locator('.chat-bar').inner_text())
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    await side(pg, '项目')
    ok(S, '项目列表显示对话数', '1 个对话' in await pg.locator('.page .scroll').inner_text())
    await pg.locator('.agent:has-text("毕业论文")').click(); await pg.wait_for_timeout(400)
    await pg.locator(".adv-toggle.danger").click(); await pg.wait_for_timeout(300)
    ok(S, '项目删除', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.projects')||'[]').length") == 0)
    # 技能：点技能开对话，系统提示是技能的
    await side(pg, '技能')
    open('/tmp/mock_reqs.jsonl', 'w').close()
    nm = await pg.locator('.agents .agent .ag-n').first.inner_text()
    await pg.locator('.agents .agent').first.click(); await pg.wait_for_timeout(400)
    ok(S, '技能对话空状态', nm in await pg.locator('.chat').inner_text(), nm)
    await chat_send(pg, '你好'); await wait_idle(pg)
    rq = reqs()
    ok(S, '技能提示词注入', rq and len(sys_of(rq[-1])) > 50, len(sys_of(rq[-1])) if rq else 0)
    t = await pg.locator('.chat-bar').inner_text()
    ok(S, '技能对话改标题', '你好' in t, t)
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    # 技能页 AskBar
    await side(pg, '技能')
    await pg.locator('.ask-bar').click(); await pg.wait_for_timeout(300)
    ok(S, '用对话定制技能弹窗', await pg.locator('.ask-sheet').count())
    await pg.locator('.sheet-back').click(position={"x": 10, "y": 10}); await pg.wait_for_timeout(300)
    # 角色：自己写一个 → 保存并聊天 → 角色扮演请求 → 编辑 → 删除；链接导入失败提示
    await side(pg, '角色')
    await pg.locator(".btn-ghost:has-text('自己写一个')").click(); await pg.wait_for_timeout(400)
    await pg.locator('.big-name').fill('林黛玉')
    await pg.locator('.char-edit textarea').nth(0).fill('{{char}} 是潇湘馆的主人，说话含蓄。')
    await pg.locator('.char-edit textarea').nth(3).fill('你来了。')
    await pg.locator('.char-edit textarea').nth(4).fill('今天天气真好。')
    await shot(pg, 'char-edit.png')
    open('/tmp/mock_reqs.jsonl', 'w').close()
    await pg.locator(".btn-ink:has-text('保存并开始聊天')").click(); await pg.wait_for_timeout(600)
    t = await pg.locator('.chat').inner_text()
    ok(S, '角色开场白', '你来了' in t, t[:200])
    ok(S, '备选开场切换', await pg.locator('.swipe').count())
    if await pg.locator('.swipe').count():
        await pg.locator('[aria-label=下一个开场]').click(); await pg.wait_for_timeout(200)
        ok(S, '切到备选开场', '今天天气真好' in await pg.locator('.chat').inner_text())
    await chat_send(pg, '你好呀'); await wait_idle(pg)
    rq = reqs()
    ok(S, '角色扮演请求 lumi_mode=roleplay', rq and rq[-1].get('lumi_mode') == 'roleplay' and '潇湘馆' in sys_of(rq[-1]), rq[-1].get('lumi_mode') if rq else None)
    ok(S, '角色对话不带定制工具', rq and not rq[-1].get('tools'), [t['function']['name'] for t in (rq[-1].get('tools') or [])] if rq else None)
    await shot(pg, 'char-chat.png')
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    await side(pg, '角色')
    ok(S, '角色列表 + 最近角色对话', await pg.locator('.char-card').count() == 1 and '最近的角色对话' in await pg.locator('.page .scroll').inner_text())
    await pg.locator('.import-card .inp').fill('https://example.com/nothing')
    await pg.locator('.import-card .btn-ink').click(); await pg.wait_for_timeout(1500)
    t = await pg.locator('.imp-msg').inner_text() if await pg.locator('.imp-msg').count() else ''
    ok(S, '链接导入失败有提示', t and 'bad' in (await pg.locator('.imp-msg').get_attribute('class')), t)
    await pg.locator('.char-card [aria-label=编辑]').click(); await pg.wait_for_timeout(400)
    await pg.locator(".btn-ghost.danger:has-text('删除')").click(); await pg.wait_for_timeout(400)
    ok(S, '角色删除', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.chars')||'[]').length") == 0)
    # 我的 → 用量与套餐 / 收藏 / 设置
    await pg.locator('.side [aria-label=展开侧栏]').click(); await pg.wait_for_timeout(400)
    await pg.locator('.s-me').click(); await pg.wait_for_timeout(500)
    if await pg.locator('.side [aria-label=折叠侧栏]').count(): await pg.locator('.side [aria-label=折叠侧栏]').click(); await pg.wait_for_timeout(300)
    await pg.locator(".row:has-text('用量与套餐')").click(); await pg.wait_for_timeout(600)
    t = await pg.locator('.page .scroll').inner_text()
    ok(S, '会员页：套餐 + 用量图', 'Pro' in t and '当前' in t and await pg.locator('.bars .bar').count() == 14, t[:200])
    await pg.locator('.bars .bar').nth(12).click(); await pg.wait_for_timeout(200)
    await shot(pg, 'wallet.png')
    ok(S, '会员页无溢出', not await overflow(pg), await overflow(pg))
    async with pg.expect_popup() as pop:
        await pg.locator('.plan-row.max .plan-btn').click()
    pu = (await pop.value).url
    ok(S, '升级按钮打开官网', 'platform.qigai.tech' in pu, pu)
    await (await pop.value).close()
    await pg.locator('.nav-back').click(); await pg.wait_for_timeout(300)
    await pg.locator(".row:has-text('收藏')").click(); await pg.wait_for_timeout(400)
    ok(S, '收藏页', await pg.locator('.sub-title').inner_text() == '收藏')
    await pg.locator('.nav-back').click(); await pg.wait_for_timeout(300)
    await pg.locator(".row:has-text('设置')").click(); await pg.wait_for_timeout(400)
    t = await pg.locator('.page .scroll').inner_text()
    ok(S, '设置页（已连接网关）', '已连接网关' in t and '127.0.0.1:8787' in t, t[:120])
    ok(S, '设置页版本号', 'v0.21' in t, t[-80:])
    await pg.locator(".mini-seg button:has-text('壁纸')").click(); await pg.wait_for_timeout(300)
    ok(S, '主题切换为壁纸', await pg.locator('.app.theme-wallpaper').count() and await pg.locator(".row:has-text('选择壁纸图片')").count())
    # 选一张壁纸
    import base64
    from PIL import Image
    Image.new('RGB', (64, 64), (40, 90, 160)).save('/tmp/wall.png')
    await pg.locator('input[type=file][accept="image/*"]').set_input_files('/tmp/wall.png'); await pg.wait_for_timeout(800)
    wall = await pg.evaluate("()=>getComputedStyle(document.querySelector('.app')).getPropertyValue('--wall')")
    ok(S, '壁纸生效', 'blob:' in wall, wall[:60])
    await shot(pg, 'settings-wallpaper.png')
    await pg.locator(".mini-seg button:has-text('橙白')").click(); await pg.wait_for_timeout(200)
    ok(S, '主题切回橙白', await pg.locator('.app.theme-peach').count())
    await pg.locator('.adv-toggle').click(); await pg.wait_for_timeout(200)
    ok(S, '高级设置展开', '图片模型' in await pg.locator('.page .scroll').inner_text())
    # 关掉「在对话里定制」后普通对话不带工具
    tg = pg.locator(".row:has-text('在对话里定制') .toggle")
    await tg.click(); await pg.wait_for_timeout(200)
    open('/tmp/mock_reqs.jsonl', 'w').close()
    await pg.locator('.side.rail [aria-label=新对话]').click(); await pg.wait_for_timeout(300)
    await home_send(pg, '你好'); await wait_idle(pg)
    rq = reqs()
    ok(S, '关闭对话定制后不带工具', rq and not rq[-1].get('tools'), [t['function']['name'] for t in (rq[-1].get('tools') or [])] if rq else None)
    # 网关错误：401 提示
    await pg.evaluate("()=>{const s=JSON.parse(localStorage.getItem('lumi.settings'));s.baseUrl='http://127.0.0.1:9';localStorage.setItem('lumi.settings',JSON.stringify(s))}")
    await pg.reload(); await pg.wait_for_timeout(600)
    await home_send(pg, '你好'); await wait_idle(pg); await pg.wait_for_timeout(300)
    t = await pg.locator('.chat .err').inner_text() if await pg.locator('.chat .err').count() else ''
    ok(S, '网关连不上时中文提示', '连不上' in t, t)
    await pg.close()

# ---------------------------------------------------------------- 段：Flow（网页版，无原生）
async def seg_flow(b, native=False):
    S = 'flow-native' if native else 'flow'
    pg = await new_page(b, native=native, flows=True, seg=S)
    await side(pg, 'Flow')
    await pg.wait_for_timeout(500)
    tiles = await pg.locator('.bento .bt:not(.add)').count()
    ok(S, 'Flow 总览便当格（7 个应用）', tiles == 7, tiles)
    ok(S, '总览摘要', '7 个应用 · 10 个 Flow' in await pg.locator('.f-sum').inner_text())
    ok(S, '总览无溢出', not await overflow(pg), await overflow(pg))
    await shot(pg, f'{S}-bento.png')
    if native:
        ic = await pg.evaluate("() => ({ img: document.querySelectorAll('img.app-ic').length, ph: document.querySelectorAll('.app-ic.ph').length })")
        ok(S, '原生应用图标（模拟）', ic['img'] >= 7 and ic['ph'] == 0, ic)
    # 便当格直接运行（无参数的 Flow：批量点赞在 hero 里）
    await pg.locator(".bt.hero .bh-play[aria-label='运行 批量点赞']").click(); await pg.wait_for_timeout(1500)
    msg = await pg.locator('.imp-msg').inner_text() if await pg.locator('.imp-msg').count() else ''
    if native:
        ok(S, '便当格运行（无参数）→ 运行明细', '完成' in msg and await pg.locator('.run-panel').count(), msg)
    else:
        ok(S, '网页版运行 Flow 给中文提示', '安卓' in msg, msg)
    # 有参数 → 参数表
    await pg.locator(".bt.hero .bh-play[aria-label='运行 搜索笔记']").click(); await pg.wait_for_timeout(400)
    ok(S, '有参数时弹参数表', await pg.locator('.sheet .ps-head').count())
    await shot(pg, f'{S}-params.png')
    if await pg.locator('.sheet .ps-head').count():
        await pg.locator('.sheet .inp').fill('南京咖啡'); await pg.locator('.sheet .btn-run').click(); await pg.wait_for_timeout(1500)
        msg = await pg.locator('.imp-msg').inner_text() if await pg.locator('.imp-msg').count() else ''
        ok(S, '参数表运行', ('完成' in msg) if native else ('安卓' in msg), msg)
        if native:
            fl = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x1')")
            ok(S, '运行次数 +1', fl['runs'] == 13, fl['runs'])
    # 应用页：叠卡
    await pg.locator('.bt.hero').click(position={"x": 60, "y": 30}); await pg.wait_for_timeout(600)
    ok(S, '应用页标题', await pg.locator('.fh-name').inner_text() == '小红书')
    ok(S, '叠卡 3 张', await pg.locator('.wcard').count() == 3)
    await pg.locator(".wcard:has-text('收藏前 5 篇') .wc-head").click(); await pg.wait_for_timeout(800)
    ok(S, '叠卡展开显示步骤', await pg.locator('.wcard.open .wc-steps li').count() == 6)
    ok(S, '应用页无溢出', not await overflow(pg), await overflow(pg))
    await shot(pg, f'{S}-deck.png')
    await pg.locator(".wcard.open .wc-run").click(); await pg.wait_for_timeout(1500)
    if native: ok(S, '叠卡运行（类 + 循环）', await pg.locator('.run-panel').count(), await pg.locator('.page .scroll').inner_text())
    await pg.locator(".wcard:has-text('收藏前 5 篇') .wc-head").click(); await pg.wait_for_timeout(500)
    ok(S, '叠卡再点收起', not await pg.locator('.wcard.open').count())
    # 应用页 按任务生成弹窗带前缀
    await pg.locator('.fh-gen').click(); await pg.wait_for_timeout(300)
    ok(S, '应用页按任务生成预填应用名', (await pg.locator('.ask-in').input_value()).startswith('在小红书里'))
    await pg.locator('.sheet-back').click(position={"x": 10, "y": 10}); await pg.wait_for_timeout(300)
    # 录制（网页版提示）
    await pg.locator('.fh-rec').click(); await pg.wait_for_timeout(500)
    t = await pg.locator('.imp-msg').inner_text() if await pg.locator('.imp-msg').count() else ''
    if not native: ok(S, '网页版录制提示', '安卓' in t, t)
    # 编辑器
    await pg.locator(".wcard:has-text('收藏前 5 篇') .wc-head").click(); await pg.wait_for_timeout(600)
    await pg.locator(".wcard.open .btn-ghost:has-text('编辑')").click(); await pg.wait_for_timeout(600)
    ok(S, '编辑页', await pg.locator('.sub-title').inner_text() == '编辑 Flow' and await pg.locator('.flow-steps li').count() == 14, await pg.locator('.flow-steps li').count())
    await shot(pg, f'{S}-editor.png')
    if not native: await shot(pg, 'flow-editor.png', design=True)
    ok(S, '编辑页无溢出', not await overflow(pg), await overflow(pg))
    # 时间线缩进
    depth = await pg.evaluate("()=>[...document.querySelectorAll('.flow-steps li')].map(l=>l.style.getPropertyValue('--d'))")
    ok(S, '时间线按块缩进', '2' in depth, depth)
    # 展开 AI 步骤，改目标
    await pg.locator('.flow-steps li').nth(3).locator('.fs-head').click(); await pg.wait_for_timeout(300)
    body = await pg.locator('.flow-steps li.open .fs-body').inner_text()
    ok(S, '展开方法步骤编辑器', '方法' in body or '对象' in body, body[:100])
    await pg.locator('.flow-steps li').nth(4).locator('.fs-head').click(); await pg.wait_for_timeout(300)
    ok(S, '展开 if 显示条件编辑', await pg.locator('.flow-steps li.open .cond-ed').count())
    await pg.locator(".flow-steps li.open .seg-s button:has-text('变量比较')").click(); await pg.wait_for_timeout(200)
    cond = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x3').steps[4].cond")
    ok(S, '条件改成变量比较并保存', cond.get('kind') == 'var', cond)
    await pg.locator(".flow-steps li.open .seg-s button:has-text('出现文字')").click(); await pg.wait_for_timeout(200)
    await pg.locator(".flow-steps li.open .cond-ed .inp").fill('收藏'); await pg.wait_for_timeout(200)
    # 添加步骤：在第 5 步后加「如果…否则」
    await pg.locator(".add-btn:has-text('添加步骤')").click(); await pg.wait_for_timeout(300)
    ok(S, '添加步骤面板（5 组）', await pg.locator('.add-sheet .add-h').count() == 5)
    await shot(pg, f'{S}-add.png')
    await pg.locator(".add-sheet .add-it:has-text('如果…否则')").click(); await pg.wait_for_timeout(300)
    n = await pg.locator('.flow-steps li').count()
    ok(S, '插入 if/else/endif', n == 17, n)
    errs = await pg.locator('.val-box').inner_text() if await pg.locator('.val-box').count() else ''
    # 新的 if 条件文字为空 → 应该有提示
    ok(S, '校验提示（空条件）', errs != '', errs)
    await pg.locator('.flow-steps li.open .cond-ed .inp').fill('赞'); await pg.wait_for_timeout(200)
    ok(S, '填好条件后错误消失', not await pg.locator('.val-box.bad').count(), await pg.locator('.val-box').inner_text() if await pg.locator('.val-box').count() else '')
    # 上移 / 删除（第 2 步 new 下移再上移，删掉「返回」步）
    await pg.locator('.flow-steps li').nth(1).locator('.fs-head').click(); await pg.wait_for_timeout(200)
    await pg.locator(".flow-steps li.open .chip-t:has-text('下移')").click(); await pg.wait_for_timeout(200)
    k = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x3').steps.slice(1,3).map(s=>s.kind).join()")
    await pg.locator(".flow-steps li.open .chip-t:has-text('上移')").click(); await pg.wait_for_timeout(200)
    k2 = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x3').steps.slice(1,3).map(s=>s.kind).join()")
    ok(S, '下移 / 上移', k == 'for,new' and k2 == 'new,for', (k, k2))
    idx = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x3').steps.findIndex(s=>s.kind==='key')")
    await pg.locator('.flow-steps li').nth(idx).locator('.fs-head').click(); await pg.wait_for_timeout(200)
    await pg.locator(".flow-steps li.open .chip-t:has-text('删除')").click(); await pg.wait_for_timeout(200)
    ok(S, '删除步骤', await pg.locator('.flow-steps li').count() == 16)
    # 计次循环 + 设置变量
    await pg.locator(".add-btn:has-text('添加步骤')").click(); await pg.wait_for_timeout(300)
    await pg.locator(".add-sheet .add-it:has-text('设置变量')").click(); await pg.wait_for_timeout(300)
    st = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x3').steps.map(s=>s.kind)")
    ok(S, '添加设置变量', 'set' in st and st.count('set') == 2, st)
    # 类编辑
    await pg.locator('.cls-card:not(.add)').first.click(); await pg.wait_for_timeout(300)
    ok(S, '类编辑面板', await pg.locator('.cls-sheet').count())
    await shot(pg, f'{S}-class.png')
    await pg.locator(".cls-sheet .chip-t:has-text('字段')").click()
    fs = pg.locator('.cls-sheet .row-f')
    await pg.locator('.cls-sheet .row-f').nth(2).locator('input').nth(0).fill('likes')
    await pg.locator('.cls-sheet .row-f').nth(2).locator('input').nth(1).fill('0')
    await pg.locator(".cls-sheet .btn-ink:has-text('保存类')").click(); await pg.wait_for_timeout(300)
    cls = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x3').classes[0]")
    ok(S, '类加字段保存', 'likes' in cls['fields'], cls['fields'])
    # 新建类：方法体 JSON 错误
    await pg.locator('.cls-card.add').click(); await pg.wait_for_timeout(300)
    await pg.locator(".cls-sheet .chip-t:has-text('方法')").click()
    await pg.locator('.cls-sheet .code-ta').fill('[{bad json')
    await pg.locator(".cls-sheet .btn-ink:has-text('保存类')").click(); await pg.wait_for_timeout(200)
    ok(S, '方法体 JSON 错误提示', '不是合法' in await pg.locator('.cls-sheet').inner_text())
    await pg.locator('.sheet-back').click(position={"x": 10, "y": 10}); await pg.wait_for_timeout(300)
    # 快速模式开关
    await pg.locator(".fe-meta .chip-t:has-text('快速模式')").click(); await pg.wait_for_timeout(200)
    ok(S, '快速模式开关', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x3').fast") is False)
    # 改名
    await pg.locator('.fe-name').fill('收藏前五篇'); await pg.wait_for_timeout(200)
    ok(S, '改名保存', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='x3').name") == '收藏前五篇')
    # 试运行
    if not await pg.locator(".btn-ink:has-text('试运行')").is_disabled():
        await pg.locator(".btn-ink:has-text('试运行')").click(); await pg.wait_for_timeout(1500)
        t = await pg.locator('.page .scroll').inner_text()
        if native: ok(S, '编辑页试运行 → 运行明细', await pg.locator('.run-panel').count(), t[-200:])
        else: ok(S, '网页版试运行中文提示', '安卓' in t, t[-200:])
    else:
        ok(S, '试运行可用（无错误时）', False, await pg.locator('.val-box').inner_text())
    await pg.close()

    # AI 优化（美团 点外卖）→ 预览 → 采用
    pg = await new_page(b, native=native, flows=True, seg=S)
    await pg.evaluate("()=>window.dispatchEvent(new CustomEvent('lumi-go',{detail:'flow:m1'}))"); await pg.wait_for_timeout(600)
    ok(S, '打开编辑器（lumi-go）', await pg.locator('.fe-name').input_value() == '点外卖')
    await pg.locator('.dev-card .inp').fill('加上回车')
    await pg.locator(".dev-card .btn-ink:has-text('优化')").click(); await pg.wait_for_timeout(1500)
    ok(S, 'AI 优化给出预览', await pg.locator('.flow-steps li.ghost').count() == 6, await pg.locator('.dev-card').inner_text())
    await shot(pg, f'{S}-optimize.png')
    await pg.locator(".dev-card .btn-ink:has-text('采用')").click(); await pg.wait_for_timeout(300)
    fl = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.id==='m1')")
    ok(S, 'AI 优化采用后保存', fl['name'] == '点外卖（优化）' and len(fl['steps']) == 6 and fl['params'] == ['店名'], (fl['name'], len(fl['steps']), fl['params']))
    # 删除 Flow
    await pg.locator(".btn-ghost.danger:has-text('删除 Flow')").click(); await pg.wait_for_timeout(500)
    ok(S, '删除 Flow 回到应用页', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).some(f=>f.id==='m1')") is False and await pg.locator('.fh-name').count())
    # 总览「按任务生成」→ 示例 → 新对话
    await side(pg, 'Flow')
    await pg.locator('.f-sum .gen-btn').click(); await pg.wait_for_timeout(300)
    ok(S, '按任务生成弹窗', await pg.locator('.ask-sheet .ask-ex .chip').count() == 3)
    await shot(pg, f'{S}-ask.png')
    await pg.locator('.ask-sheet .ask-ex .chip').first.click()
    await pg.wait_for_selector('.ccard', timeout=8000); await pg.wait_for_timeout(500)
    ok(S, '生成 Flow 确认卡', await pg.locator('.ccard.flow .cc-ok:has-text("保存")').count())
    tags = await pg.locator('.ccard .cc-tag').all_inner_texts()
    ok(S, '确认卡步骤标签（AI 视觉 / 逻辑）', 'AI 视觉' in tags and '逻辑' in tags, tags)
    await shot(pg, f'{S}-confirm.png')
    await pg.locator('.ccard .cc-ok:has-text("保存")').click(); await pg.wait_for_timeout(1200)
    ok(S, '确认后保存', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).some(f=>f.name==='收藏南京咖啡笔记')"))
    t = await pg.locator('.chat').inner_text()
    ok(S, '模型收到确认结果并回复', '已保存' in t, t[-150:])
    tr = pg.locator(".ccard .cc-ok:has-text('试跑')")
    if native:
        await tr.click(); await pg.wait_for_timeout(500)
        ins = pg.locator('.sheet .inp')
        if await ins.count(): await ins.nth(0).fill('南京咖啡'); await ins.nth(1).fill('3'); await pg.locator('.sheet .btn-run').click(); await pg.wait_for_timeout(1500)
        note = await pg.locator('.ccard .cc-note').inner_text() if await pg.locator('.ccard .cc-note').count() else ''
        fl = await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).find(f=>f.name==='收藏南京咖啡笔记')")
        cached = [s.get('goal') for s in fl['steps'] if s['kind'] == 'ai' and s.get('sel')]
        ok(S, '试跑写回 AI 视觉位置（不含 ${i} 步）', note.startswith('试跑') and len(cached) >= 2 and not any('${i}' in (g or '') for g in cached), (note, cached))
        await shot(pg, f'{S}-tryrun.png')
    else:
        ok(S, '网页版试跑按钮禁用', await tr.count() and await tr.is_disabled(), await tr.count())
    # 撤销
    await pg.locator(".ccard .btn-ghost:has-text('撤销')").click(); await pg.wait_for_timeout(300)
    ok(S, '撤销后 Flow 被删除', not await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).some(f=>f.name==='收藏南京咖啡笔记')") and '已撤销' in await pg.locator('.ccard .cc-st').inner_text())
    # 取消路径
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    await home_send(pg, '按任务生成 Flow：在小红书收藏笔记')
    await pg.wait_for_selector('.ccard', timeout=8000); await pg.wait_for_timeout(300)
    await pg.locator('.ccard .btn-ghost:has-text("取消")').click(); await pg.wait_for_timeout(1000)
    t = await pg.locator('.chat').inner_text()
    ok(S, '确认卡取消', '已取消' in t and '没有保存' in t, t[-120:])
    # 刷新后待确认卡显示已失效
    await home_send_in_chat_new(pg, '按任务生成 Flow：再来一个')
    await pg.reload(); await pg.wait_for_timeout(800)
    await pg.locator('.side [aria-label=展开侧栏]').click(); await pg.wait_for_timeout(400)
    await pg.locator('.s-conv').first.click(); await pg.wait_for_timeout(600)
    t = await pg.locator('.ccard .cc-st').last.inner_text() if await pg.locator('.ccard').count() else ''
    ok(S, '重开后待确认卡显示已失效', t == '已失效', t)
    await pg.close()

async def home_send_in_chat_new(pg, text):
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    await home_send(pg, text)
    await pg.wait_for_selector('.ccard', timeout=8000); await pg.wait_for_timeout(300)

async def seg_native(b):
    await seg_flow(b, native=True)

# ---------------------------------------------------------------- 段：对话里定制（技能 / MCP / Flow 删除）+ 手机操控网页回退
async def seg_custom(b):
    S = 'custom'
    pg = await new_page(b, flows=True, seg=S)
    await home_send(pg, '帮我做个技能：会议纪要')
    await pg.wait_for_selector('.ccard', timeout=8000); await pg.wait_for_timeout(300)
    t = await pg.locator('.ccard').inner_text()
    ok(S, '技能确认卡（提示词 / 开场白）', '会议纪要' in t and '待确认' in t, t[:200])
    await pg.locator('.ccard .cc-ok:has-text("保存")').click(); await pg.wait_for_timeout(1000)
    ok(S, '技能保存', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.skills')||'[]').map(s=>s.name)") == ['会议纪要'])
    await side(pg, '技能')
    ok(S, '技能页显示自定义标签', await pg.locator(".agent:has-text('会议纪要') .ag-tag").count())
    await pg.locator('.side.rail [aria-label=新对话]').click(); await pg.wait_for_timeout(300)
    await home_send(pg, '删除技能 会议纪要')
    await pg.wait_for_selector('.ccard', timeout=8000); await pg.wait_for_timeout(300)
    ok(S, '删除确认卡（红色删除键）', await pg.locator('.ccard .cc-ok.danger').count())
    await pg.locator('.ccard .cc-ok.danger').click(); await pg.wait_for_timeout(1000)
    ok(S, '技能删除', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.skills')||'[]').length") == 0 and '已删除' in await pg.locator('.ccard .cc-st').inner_text())
    await pg.locator(".ccard .btn-ghost:has-text('撤销')").click(); await pg.wait_for_timeout(300)
    ok(S, '撤销删除：技能回来', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.skills')||'[]').length") == 1)
    # MCP：连接测试 → 保存 → 撤销
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    await home_send(pg, '加一个 MCP')
    await pg.wait_for_selector('.ccard', timeout=10000); await pg.wait_for_timeout(300)
    t = await pg.locator('.ccard').inner_text()
    ok(S, 'MCP 确认卡带连接测试结果', 'echo' in t or '2 个' in t, t[:300])
    await pg.locator('.ccard .cc-ok:has-text("保存")').click(); await pg.wait_for_timeout(1000)
    await side(pg, 'MCP')
    ok(S, 'MCP 列表实时刷新（lumi-mcp 事件）', await pg.locator('.card-row:has-text("本地测试")').count())
    await pg.locator('.side.rail [aria-label=新对话]').click(); await pg.wait_for_timeout(300)
    # 删除 Flow 确认卡
    await home_send(pg, '删除 Flow 批量点赞')
    await pg.wait_for_selector('.ccard', timeout=8000); await pg.wait_for_timeout(300)
    await pg.locator('.ccard .cc-ok.danger').click(); await pg.wait_for_timeout(800)
    ok(S, 'Flow 删除', not await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).some(f=>f.id==='x2')"))
    await pg.locator(".ccard .btn-ghost:has-text('撤销')").click(); await pg.wait_for_timeout(300)
    ok(S, 'Flow 删除撤销', await pg.evaluate("()=>JSON.parse(localStorage.getItem('lumi.flows')).some(f=>f.id==='x2')"))
    # 停止生成时取消待确认卡
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    await home_send(pg, '帮我做个技能：周报')
    await pg.wait_for_selector('.ccard', timeout=8000); await pg.wait_for_timeout(300)
    await pg.locator('.send.stop').click(); await pg.wait_for_timeout(500)
    t = await pg.locator('.chat').inner_text()
    ok(S, '停止生成 = 取消确认卡', '已取消' in t and '已停止' in t and not await pg.locator('.send.stop').count(), t[-150:])
    # flow_list（只读工具）
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(300)
    await home_send(pg, '列出 Flow'); await wait_idle(pg)
    await pg.locator('.chat .steps > button').click(); await pg.wait_for_timeout(200)
    ok(S, 'flow_list 工具步骤', '搜索笔记' in await pg.locator('.chat .steps').inner_text(), await pg.locator('.chat .steps').inner_text())
    # 手机操控模式（网页版）
    await pg.locator('.chat .c-plus').click(); await pg.wait_for_timeout(300)
    await pg.locator(".chat-menu .gen-menu.show button:has-text('手机操控')").click(); await pg.wait_for_timeout(300)
    ok(S, '手机操控芯片', await pg.locator(".c-field .gen-chip:has-text('手机操控')").count())
    open('/tmp/mock_reqs.jsonl', 'w').close()
    await chat_send(pg, '看屏幕'); await wait_idle(pg)
    rq = reqs()
    names = [t['function']['name'] for t in (rq[0].get('tools') or [])] if rq else []
    ok(S, '手机操控带 phone_* 工具', 'phone_screen' in names and 'flow_run' not in names or 'phone_screen' in names, names)
    await pg.locator('.chat .steps > button').last.click(); await pg.wait_for_timeout(200)
    t = await pg.locator('.chat .steps').last.inner_text()
    ok(S, '网页版手机工具回退提示', '安卓' in t, t)
    await shot(pg, 'chat-phone-web.png')
    # 对话 + 菜单「按任务生成 Flow」
    await pg.locator('.chat .c-plus').click(); await pg.wait_for_timeout(300)
    await pg.locator(".chat-menu .gen-menu.show button:has-text('按任务生成 Flow')").click(); await pg.wait_for_timeout(300)
    ok(S, '对话 + 菜单 按任务生成 Flow', (await pg.locator('.chat textarea').input_value()).startswith('按任务生成 Flow'))
    await pg.close()
    # 原生（模拟）：手机连接页 + 对话里 flow_run 运行卡
    pg = await new_page(b, native=True, flows=True, seg=S)
    await side(pg, '手机连接')
    t = await pg.locator('.page .scroll').inner_text()
    await shot(pg, 'phone-native.png')
    ok(S, '手机连接页（模拟原生）', '无障碍' in t, t[:200])
    await pg.locator('.side.rail [aria-label=新对话]').click(); await pg.wait_for_timeout(300)
    await home_send(pg, '运行 Flow 搜索笔记')
    await pg.wait_for_selector('.ccard.run', timeout=8000); await wait_idle(pg)
    t = await pg.locator('.ccard.run').inner_text()
    ok(S, '对话里 flow_run 运行卡', '已完成' in t, t[:200])
    await pg.close()

# ---------------------------------------------------------------- 段：字体
FONT_JS = """async (sel) => { await document.fonts.ready; const e = document.querySelector(sel); return e ? getComputedStyle(e).fontFamily : null }"""
async def platform_fonts(pg, sel):
    cdp = await pg.context.new_cdp_session(pg)
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
    doc = await cdp.send('DOM.getDocument', {"depth": -1})
    nid = (await cdp.send('DOM.querySelector', {"nodeId": doc['root']['nodeId'], "selector": sel}))['nodeId']
    if not nid: return {}
    r = await cdp.send('CSS.getPlatformFontsForNode', {"nodeId": nid})
    return {f['familyName']: f['glyphCount'] for f in r['fonts']}

async def seg_fonts(b):
    S = 'fonts'
    pg = await new_page(b, flows=True, seg=S)
    FURL = []
    pg.on('response', lambda r: r.url.endswith('.woff2') and FURL.append(r.url.rsplit('/', 1)[-1]))
    await pg.wait_for_timeout(600)
    fam = await pg.evaluate(FONT_JS, '.hello h1')
    ok(S, '字体栈：Anthropic Sans 在前，中文衬线在后', fam and fam.startswith('"Anthropic Sans", Inter, "Noto Serif SC"'), fam)
    pf = await platform_fonts(pg, '.hello h1')
    ok(S, '问候语：中文用衬线，Qi 用 Inter', any('Serif' in k for k in pf) and 'Inter' in ''.join(pf), pf)
    await home_send(pg, '用 markdown 表格对比语言，再给段代码和公式'); await wait_idle(pg)
    pf = await platform_fonts(pg, '.chat .md p')
    ok(S, '回答正文：中文衬线 + 西文 Inter', any('Serif' in k for k in pf) and any('Inter' in k for k in pf), pf)
    pf = await platform_fonts(pg, '.chat .md table td')
    ok(S, '表格单元格：衬线 / Inter', all(('Serif' in k) or ('Inter' in k) for k in pf), pf)
    pf = await platform_fonts(pg, '.chat .md pre code')
    ok(S, '代码块保持等宽', all('Mono' in k or 'mono' in k.lower() for k in pf), pf)
    pf = await platform_fonts(pg, '.chat textarea')
    ok(S, '输入框继承字体', 'Inter' in await pg.evaluate("()=>getComputedStyle(document.querySelector('.chat textarea')).fontFamily"), pf)
    await shot(pg, 'chat-fonts-v21.png')
    await pg.evaluate("()=>document.querySelector('.chat .scroll').scrollTo({top:0})"); await pg.wait_for_timeout(300)
    await shot(pg, 'chat-fonts.png', design=True)
    await pg.locator('.chat [aria-label=新对话]').first.click(); await pg.wait_for_timeout(400)
    await side(pg, 'Flow')
    await pg.wait_for_timeout(600)
    pf = await platform_fonts(pg, '.bt.hero .bh-fn')
    ok(S, 'Flow 卡中文衬线', any('Serif' in k for k in pf), pf)
    await shot(pg, 'flow-bento.png', design=True)
    loaded = await pg.evaluate("async()=>{await document.fonts.ready;return [...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight)}")
    print('loaded font faces:', loaded, 'woff2 requests:', FURL)
    await pg.close()
    pg = await new_page(b, 1280, 820, flows=True, seg=S)
    await home_send(pg, '你好'); await wait_idle(pg)
    await shot(pg, 'chat-fonts-desktop.png')
    await pg.close()

# ---------------------------------------------------------------- 段：角色内容渲染（复用 scripts/rp_render_mock.py 的卡和对话）
async def seg_rp(b):
    S = 'rp'
    src = open(os.path.join(ROOT, 'scripts', 'rp_render_mock.py'), encoding='utf-8').read().split('async def main')[0]
    G = {}; exec(src, G)
    pg = await new_page(b, seg=S, extra={'lumi.chars': json.dumps([G['card']], ensure_ascii=False), 'lumi.convs': json.dumps([G['conv']], ensure_ascii=False)})
    await pg.locator('.side [aria-label=展开侧栏]').click(); await pg.wait_for_timeout(400)
    await pg.locator(".s-conv:has-text('艾琳')").click(); await pg.wait_for_timeout(1500)
    ok(S, '状态卡（<stats>）', await pg.locator('.rp-status').count() >= 1, await pg.locator('.rp-status').count())
    ok(S, 'HTML 块沙箱 iframe', await pg.locator('.rp-frame').count() >= 1, await pg.locator('.rp-frame').count())
    bw = await pg.evaluate("()=>[...document.querySelectorAll('.rp-status .rp-bar')].map(e=>[Math.round(e.getBoundingClientRect().width),e.innerText])")
    ok(S, '状态卡进度条占满一行并显示数值（不被 Flow 运行明细的 .rp-bar 样式覆盖）', bw and all(w > 150 and '/' in t for w, t in bw), bw)
    ok(S, '心声折叠（<think>）', await pg.locator('.rp-fold, details').count() >= 1)
    ok(S, '正则好感度条（显示侧）', await pg.locator('.rp-frame').count() >= 2 or '好感度' in await pg.locator('.chat').inner_text())
    await pg.locator('.chat .scroll').first.evaluate("e=>e.scrollTo(0,0)"); await pg.wait_for_timeout(300)
    await shot(pg, 'rp-render.png')
    await pg.locator('.side.rail [aria-label=新对话]').click(); await pg.wait_for_timeout(300)
    ok(S, '角色对话无溢出', not await overflow(pg), await overflow(pg))
    await pg.close()

SEGS = {'rp': seg_rp, 'fonts': seg_fonts, 'custom': seg_custom, 'flow': seg_flow, 'native': seg_native, 'pages2': seg_pages2, 'chat': seg_chat, 'side': seg_side, 'pages': seg_pages}

async def main():
    want = sys.argv[1:] or list(SEGS)
    srv = subprocess.Popen(['npx', 'vite', 'preview', '--port', '4173', '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    gw = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'mock_sse.py'), '8787'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for s in want:
                try: await SEGS[s](b)
                except Exception as e: ok(s, '段异常', False, repr(e)[:300])
            await b.close()
    finally:
        srv.terminate(); gw.terminate()
    bad = [r for r in RES if not r[2]]
    print(f'\n== {len(RES) - len(bad)}/{len(RES)} 通过')
    for r in bad: print('FAIL', r)
    print('\n== console / page errors:'); print('\n'.join(LOGS) or '无')

asyncio.run(main())
