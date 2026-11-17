/**
 * lumi-platform：栖语 Lumi 官网（platform.qigai.tech）。
 * 单文件 Worker，内联 HTML+CSS，无外部资源，移动端自适应。
 * 设计语言参照 DeepSeek 开放平台（实测的公开登录页与文档站）：
 * 蓝色公告条 + 黑白极简 + 全圆角胶囊按钮 + 浅灰输入框 + 左右分栏；
 * 品牌、文案、Logo 均为 Lumi 自己的，不复制 DeepSeek 的商标与文案。
 * 诚实口径：本站只是官网前门——不提供在线支付、不自动发 key；
 * 真发 key 与真支付在用户自建的 Sub2API 网关侧（/keys、/purchase）完成。
 * 内置网关 https://api.qigai.tech 目前免费，App 内置密钥打开即用。
 */
const APP_KEY = 'lumi-app-7f3c9a2e'
const DEFAULT_GW = 'https://api.qigai.tech'
const ISSUES_NEW = 'https://github.com/QiGai77/lumi-chat/issues/new'
const RELEASES = 'https://github.com/QiGai77/lumi-chat/releases'

const CSS = [
  '*{box-sizing:border-box;margin:0;padding:0}',
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#111827;background:#fff;min-height:100vh;-webkit-font-smoothing:antialiased}',
  'a{color:#111827}',
  /* 蓝色公告条 */
  '.banner{background:#3B82F6;color:#fff;font-size:13.5px;line-height:1.5;text-align:center;padding:10px 44px 10px 16px;position:relative}',
  '.banner a{color:#fff;text-decoration:underline;text-underline-offset:2px}',
  '.banner button{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;color:#fff;font-size:18px;cursor:pointer;padding:4px 8px}',
  /* 白色顶栏 */
  'header.top{max-width:1200px;margin:0 auto;padding:0 24px;height:64px;display:flex;align-items:center;gap:28px}',
  '.brand{display:flex;align-items:center;gap:10px;text-decoration:none;flex:none}',
  '.brand b{font-size:19px;font-weight:700;letter-spacing:-.02em}',
  '.badge{background:#0F1115;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:5px}',
  'nav.topnav{display:flex;gap:4px;margin-left:auto}',
  'nav.topnav a{padding:8px 13px;border-radius:99px;text-decoration:none;font-size:14px;color:#374151}',
  'nav.topnav a:hover{background:#F3F4F6}',
  'nav.topnav a.on{background:#F3F4F6;color:#111827;font-weight:600}',
  '.top-cta{flex:none;background:#0F1115;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:9px 18px;border-radius:99px}',
  /* 左右分栏 Hero */
  '.hero{display:grid;grid-template-columns:1fr 1.4fr;min-height:560px}',
  '.hero-dark{background:radial-gradient(120% 90% at 85% 0%,rgba(195,239,255,.28),transparent 55%),radial-gradient(90% 70% at 0% 100%,rgba(111,142,173,.35),transparent 60%),linear-gradient(160deg,#232a31,#1C2227 55%,#14181c);color:#fff;padding:72px 56px;display:flex;flex-direction:column;justify-content:center}',
  '.hero-dark h1{font-size:38px;line-height:1.3;font-weight:600;letter-spacing:-.01em}',
  '.hero-dark p{margin-top:16px;font-size:15px;line-height:1.8;color:rgba(255,255,255,.78);max-width:420px}',
  '.hero-dark .btn-white{margin-top:28px;align-self:flex-start;background:#fff;color:#111827;text-decoration:none;font-size:14.5px;font-weight:600;padding:12px 22px;border-radius:99px}',
  '.hero-light{background:#fff;padding:72px 56px;display:flex;flex-direction:column;justify-content:center}',
  '.hero-light h2{font-size:22px;font-weight:600}',
  '.hero-light .sub{margin-top:10px;font-size:14.5px;line-height:1.8;color:#6B7280}',
  /* 内容区 */
  '.wrap{max-width:960px;margin:0 auto;padding:48px 24px 64px}',
  '.wrap.narrow{max-width:560px}',
  'h1.page{font-size:30px;font-weight:600;letter-spacing:-.01em}',
  'p.lead{margin-top:12px;font-size:15px;line-height:1.8;color:#4B5563}',
  '.card{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:24px;margin-top:20px}',
  '.card h2{font-size:18px;font-weight:600}',
  '.card h3{font-size:15px;font-weight:600;margin:16px 0 6px}',
  '.card p{font-size:14.5px;line-height:1.8;color:#4B5563}',
  '.rows{margin-top:16px;border-top:1px solid #F3F4F6}',
  '.mrow{display:flex;align-items:center;gap:14px;padding:15px 2px;border-bottom:1px solid #F3F4F6}',
  '.mrow .dot{width:10px;height:10px;border-radius:50%;flex:none}',
  '.mrow b{font-size:15.5px}',
  '.mrow span{font-size:13.5px;color:#6B7280;display:block;margin-top:2px;line-height:1.5}',
  '.mrow .tag{margin-left:auto;flex:none;font-size:12px;font-weight:600;color:#374151;background:#F9FAFB;border:1px solid #E5E7EB;padding:4px 10px;border-radius:99px}',
  '.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}',
  '.plan{border:1px solid #E5E7EB;border-radius:16px;padding:20px 16px;text-align:center}',
  '.plan.hot{border-color:#111827;box-shadow:0 0 0 1px #111827}',
  '.plan b{font-size:16px}',
  '.plan .price{font-size:30px;font-weight:800;margin:10px 0 4px;letter-spacing:-.02em}',
  '.plan .price small{font-size:13px;font-weight:400;color:#6B7280}',
  '.plan span{font-size:13px;color:#6B7280;display:block;line-height:1.7}',
  '.plan .btn{margin-top:16px;width:100%}',
  /* 表单：浅灰底全圆角输入框 + 黑色全宽胶囊按钮 */
  'label{font-size:13px;font-weight:600;display:block;margin-top:18px}',
  'input,select,textarea{width:100%;font-size:14.5px;padding:0 18px;height:48px;border-radius:99px;border:1px solid #E5E7EB;background:#F9FAFB;margin-top:8px;font-family:inherit;color:#111827;outline:none}',
  'input:focus,select:focus,textarea:focus{border-color:#111827;background:#fff}',
  'textarea{height:auto;min-height:140px;padding:14px 18px;border-radius:16px;resize:vertical;line-height:1.6}',
  '.keybox{display:flex;gap:8px;margin-top:12px}',
  '.keybox input{flex:1;font-family:ui-monospace,Menlo,monospace;font-size:13.5px}',
  '.keybox .btn{width:auto;margin-top:8px;white-space:nowrap}',
  '.btn{display:inline-block;background:#0F1115;color:#fff;text-decoration:none;text-align:center;font-weight:600;font-size:14.5px;padding:0 22px;height:42px;line-height:42px;border-radius:99px;border:0;cursor:pointer}',
  '.btn.ghost{background:#fff;color:#111827;border:1px solid #E5E7EB}',
  '.btnrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}',
  '.btnrow .btn{flex:1;min-width:140px}',
  '.note{font-size:13px;color:#6B7280;line-height:1.7;margin-top:14px}',
  '.note a{color:#6B7280}',
  'code{background:#F3F4F6;padding:2px 7px;border-radius:6px;font-size:13px}',
  'footer{border-top:1px solid #F3F4F6;margin-top:48px;padding:20px 24px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12.5px;color:#9CA3AF}',
  'footer a{color:#9CA3AF}',
  '@media(max-width:880px){.hero{grid-template-columns:1fr;min-height:0}.hero-dark,.hero-light{padding:48px 24px}.hero-dark h1{font-size:30px}header.top{flex-wrap:wrap;height:auto;padding:12px 16px;gap:10px}nav.topnav{display:flex;order:3;flex-basis:100%;margin-left:0;overflow-x:auto;scrollbar-width:none}nav.topnav a{white-space:nowrap}.keybox{flex-wrap:wrap}.wrap{padding:32px 20px 48px}.plans{grid-template-columns:1fr}}',
].join('\n')

function shell(title, nav, body, extra = '') {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<title>' + title + ' · 栖语 Lumi 开放平台</title><style>' + CSS + '</style></head><body>'
    + '<div class="banner" id="banner">Lumi v0.16：Flow 支持 if / while / for 与子流程，快速模式步骤目标 ≤1 秒/步。<a href="/feedback">点此反馈 →</a><button onclick="document.getElementById(\'banner\').remove()" aria-label="关闭">×</button></div>'
    + '<header class="top"><a class="brand" href="/"><b>栖语 Lumi</b><span class="badge">开放平台</span></a>'
    + '<nav class="topnav">'
    + '<a href="/" class="' + (nav === 'home' ? 'on' : '') + '">首页</a>'
    + '<a href="/keys" class="' + (nav === 'keys' ? 'on' : '') + '">API Keys</a>'
    + '<a href="/upgrade" class="' + (nav === 'upgrade' ? 'on' : '') + '">充值 / 升级</a>'
    + '<a href="/feedback" class="' + (nav === 'feedback' ? 'on' : '') + '">反馈</a>'
    + '</nav><a class="top-cta" href="' + RELEASES + '">下载 APK</a></header>'
    + body
    + '<footer><span>栖语 Lumi v0.16 · 开源 MIT</span><span>本站是官网前门：不提供在线支付，不自动发 key；真发 key 与真支付在 Sub2API 网关侧完成。· <a href="' + RELEASES + '">GitHub Releases</a></span></footer>'
    + extra + '</body></html>'
}

const HOME = shell('栖语 Lumi 开放平台', 'home', ''
  + '<section class="hero"><div class="hero-dark"><h1>手机上的事，<br>点一下就跑完。</h1>'
  + '<p>栖语 Lumi 是一个 Android / Web 聊天 App：三个模型随叫随到，常用操作录一遍存成 Flow，下次点卡片就能自动跑完。</p>'
  + '<a class="btn-white" href="/keys">获取 API Key →</a></div>'
  + '<div class="hero-light"><h2>三个模型，随叫随到</h2>'
  + '<p class="sub">全部由网关打包成 Helium / Neon / Argon，App 内只认这三个。</p>'
  + '<div class="rows">'
  + '<div class="mrow"><span class="dot" style="background:#3B82F6"></span><div><b>Helium</b><span>轻快 · 日常问答、翻译、总结</span></div><span class="tag">日常</span></div>'
  + '<div class="mrow"><span class="dot" style="background:#111827"></span><div><b>Neon</b><span>均衡 · 写作、代码、分析</span></div><span class="tag">均衡</span></div>'
  + '<div class="mrow"><span class="dot" style="background:#8B5CF6"></span><div><b>Argon</b><span>最强 · 复杂推理、长任务</span></div><span class="tag">最强</span></div>'
  + '</div><div class="btnrow"><a class="btn" href="' + RELEASES + '">下载 APK</a><a class="btn ghost" href="/upgrade">升级会员</a></div></div></section>'
  + '<div class="wrap"><div class="card"><h2>Flow 一键工作流</h2>'
  + '<p>录一遍操作（搜索、点外卖、打卡……），存成卡片；支持 if / while / for / 变量 / 子流程等逻辑节点，不再只是线性点按。</p>'
  + '<p style="margin-top:8px">速度口径：快速模式下，缓存选择器的步骤目标 ≤1 秒/步（应用冷启动与页面加载不计入）。AI 视觉只做首跑发现——找不到元素时才定位，找到后把选择器存回 Flow，下次直接原生跑。</p></div>'
  + '<p class="note">装好 App 就能直接用：内置密钥已内置，打开即聊。想用自己的网关，到「设置」里填网关地址和 Key。</p></div>')

const KEYS = shell('API Keys', 'keys', ''
  + '<div class="wrap narrow"><h1 class="page">API Keys</h1>'
  + '<p class="lead">App 已内置下面的公开客户端密钥，装好就能聊（服务端按 IP 限流）。</p>'
  + '<div class="card"><h2>内置密钥</h2>'
  + '<div class="keybox"><input id="k" readonly value="' + APP_KEY + '">'
  + '<button class="btn" onclick="copyKey()">复制</button></div>'
  + '<p class="note" id="copied"></p></div>'
  + '<div class="card"><h2>自建 Sub2API 网关</h2>'
  + '<p>如果你自己搭了 Sub2API 网关，填网关地址后跳转到该网关的 <code>/keys</code> 页面领 key，再填回 App 的设置里。</p>'
  + '<label>网关地址</label><input id="gw" placeholder="' + DEFAULT_GW + '">'
  + '<div class="btnrow"><button class="btn" onclick="goKeys()">去网关领 key →</button></div>'
  + '<p class="note">本站不发 key：key 由你的网关签发，这里只帮你跳过去。</p></div></div>', '<script>'
  + 'function copyKey(){var i=document.getElementById("k");i.select();'
  + 'if(navigator.clipboard){navigator.clipboard.writeText(i.value).then(function(){document.getElementById("copied").textContent="已复制，粘贴到 App 设置的 API Key 里即可。";});}'
  + 'else{document.execCommand("copy");document.getElementById("copied").textContent="已复制。";}}'
  + 'function goKeys(){var g=document.getElementById("gw").value.trim()||"' + DEFAULT_GW + '";'
  + 'g=g.replace(/\\/+$/,"");window.open(g+"/keys","_blank");}'
  + '</script>')

const UPGRADE = shell('充值 / 升级', 'upgrade', ''
  + '<div class="wrap"><h1 class="page">充值 / 升级</h1>'
  + '<p class="lead">三档订阅，权益以网关侧配置为准。</p>'
  + '<div class="plans">'
  + '<div class="plan"><b>Pro</b><div class="price">¥50<small>/月</small></div><span>三模型可用<br>日常用量</span><button class="btn" onclick="goBuy()">订阅</button></div>'
  + '<div class="plan hot"><b>Max</b><div class="price">¥100<small>/月</small></div><span>2.5 倍用量<br>高峰优先</span><button class="btn" onclick="goBuy()">订阅</button></div>'
  + '<div class="plan"><b>Ultra</b><div class="price">¥200<small>/月</small></div><span>6 倍用量<br>长任务优先</span><button class="btn" onclick="goBuy()">订阅</button></div>'
  + '</div>'
  + '<div class="card"><h2>去订阅</h2>'
  + '<p>订阅在你的 Sub2API 网关 <code>/purchase</code> 页面完成。填网关地址后跳转过去。</p>'
  + '<label>网关地址</label><input id="gw" placeholder="' + DEFAULT_GW + '">'
  + '<div class="btnrow"><button class="btn" onclick="goBuy()">去订阅 →</button></div>'
  + '<p class="note">如实说明：内置网关（api.qigai.tech）目前免费、无在线支付；付费订阅需自建 Sub2API 网关后，在其 /purchase 页面完成。本站不收钱、不代扣。</p></div></div>', '<script>'
  + 'function goBuy(){var g=(document.getElementById("gw")||{}).value||"";g=g.trim()||"' + DEFAULT_GW + '";'
  + 'g=g.replace(/\\/+$/,"");window.open(g+"/purchase","_blank");}'
  + '</script>')

const FEEDBACK = shell('提交反馈', 'feedback', ''
  + '<div class="wrap narrow"><h1 class="page">提交反馈</h1>'
  + '<p class="lead">填完点提交，会打开 GitHub 新建 Issue 页面（标题与内容已按你的输入填好），点提交即公开在 <code>QiGai77/lumi-chat</code> 的 Issues 里。</p>'
  + '<div class="card"><h2>告诉我们哪里不好用</h2>'
  + '<label>类型</label><select id="type"><option>反馈</option><option>Bug</option><option>功能建议</option></select>'
  + '<label>标题</label><input id="title" placeholder="一句话说清问题或想法">'
  + '<label>内容</label><textarea id="body" placeholder="复现步骤、期望结果、手机型号与 App 版本（比如 v0.16）……"></textarea>'
  + '<div class="btnrow"><button class="btn" onclick="submitFb()">在 GitHub 提交 →</button>'
  + '<button class="btn ghost" onclick="copyFb()">复制文本</button></div>'
  + '<p class="note" id="fbmsg"></p></div></div>', '<script>'
  + 'function fbText(){var t=document.getElementById("type").value;var ti=document.getElementById("title").value.trim();'
  + 'var b=document.getElementById("body").value.trim();return {title:"["+t+"] "+ti,body:b+"\\n\\n—— 来自 platform.qigai.tech/feedback"};}'
  + 'function submitFb(){var f=fbText();if(!document.getElementById("title").value.trim()){document.getElementById("fbmsg").textContent="先写个标题。";return;}'
  + 'window.open("' + ISSUES_NEW + '?title="+encodeURIComponent(f.title)+"&body="+encodeURIComponent(f.body),"_blank");}'
  + 'function copyFb(){var f=fbText();var txt=f.title+"\\n\\n"+f.body;'
  + 'if(navigator.clipboard){navigator.clipboard.writeText(txt).then(function(){document.getElementById("fbmsg").textContent="已复制，可自行粘贴到 GitHub Issue。";});}}'
  + '</script>')

export default {
  async fetch(req) {
    const u = new URL(req.url)
    const path = u.pathname.replace(/\/+$/, '') || '/'
    const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
    if (path === '/') return html(HOME)
    if (path === '/keys') return html(KEYS)
    if (path === '/upgrade') return html(UPGRADE)
    if (path === '/feedback') return html(FEEDBACK)
    if (path === '/health') return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
    return html(shell('404', '', '<div class="wrap narrow"><h1 class="page">这个页面不存在</h1><p class="lead">回 <a href="/">首页</a> 看看。</p></div>'), 404)
  },
}
