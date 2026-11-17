# 栖语 Lumi v0.7 改动计划（交接文档）

## v0.16
- **Flow 逻辑节点**（`src/flow.ts`、`android/.../LumiFlow.java`）：新增 if/else/endif、while/endwhile、do/dowhile、for/endfor、break/continue、set、call；条件 cond（exists/not_exists/text/var，op ==/!=/>/</>=/<=/contains）；变量（string/number/boolean/point/struct，初始变量 `Flow.vars`）；set 支持 `${变量}` 插值、四则、拼接、point 字面量、struct JSON；for 含端点；call 内联子流程（最多 3 层，防循环调用）；tap 可用 `pointVar` 指 point 变量。旧 Flow JSON 向前兼容。`validateFlow`（块配对、空循环、for 缺字段、call 目标不存在、变量未定义警告；循环嵌套 ≤8、单循环默认 ≤20 次可 `max` 覆盖）、`expandCalls`、`stepLabel` 全覆盖；`runFlow` 先校验再展开，`fast` 传给原生；Java 侧 pc 循环解释器 + 控制栈 + 变量表 + 循环保护（单循环超 max 失败、总步数 ≤500 防死循环），每步耗时记 `stepMs`、结果带总 `ms`。
- **速度与 AI 视觉（诚实口径）**：快的来源是原生无障碍直跑 + 选择器缓存，不是 AI 视觉——视觉（phone_screen + 模型逐步操作）每步都要一次模型往返，比原生 Flow 慢，只做“首跑发现”（找不到元素时定位，找到后把选择器存回 Flow）。目标口径统一为：**快速模式下缓存选择器的步骤目标 ≤1 秒/步**，launch 与页面加载不计入；UI/文档不写“每次执行 1 秒”或“全流程 1 秒”。快速模式（`Flow.fast`）：步后等待 450→120ms、`waitFind` 轮询 350→80ms、tap 默认 timeout 6000→2500ms、launch 不固定睡 1800ms 改为每 100ms 检查窗口根节点变化（最多 1200ms）、input 后聚焦等待 500→150ms。运行成功消息显示总耗时（如 `完成，5 步 · 2.3 秒`）。
- **Flow 卡片改色**：`tint()` 改为 curated 浅色双色（蜜桃/天空/薄荷/薰衣草/蔷薇/奶油黄/雾蓝/豆绿，亮度 88–94%），文字深色墨 `#23272F`，阴影淡；`.fapp/.fhero/.ftile` 及子元素按深色文字重调；空状态三色块改为蜜桃/天空/薰衣草浅色。
- **侧栏迷你态**：`App` 增加 `mini` state（`localStorage 'lumi.sideMini'`），桌面 ≥980px 时侧栏缩为 76px，只留折叠按钮 + 新建对话/技能/MCP 三个图标（`title` 提示文字）；手机端 mini 不生效（仍是关闭抽屉）。`s-head` 最前面的按钮即折叠/展开切换。
- **官网 platform.qigai.tech**（新 `server/platform/`，Worker `lumi-platform`，未部署）：`/` 首页（Helium/Neon/Argon、Flow、APK 下载链接）、`/keys`（说明 App 内置密钥打开即用、提供复制内置密钥按钮；自建 Sub2API 用户填网关地址跳 `{网关}/keys`）、`/upgrade`（Pro ¥50 / Max ¥100 / Ultra ¥200，订阅按钮跳 `{网关}/purchase`）、`/feedback`（表单拼 GitHub Issue 链接新窗口打开 + 复制文本）、`/health`。**诚实限制**：platform v1 是官网前门，真发 key 与真支付在 Sub2API 网关侧；内置网关目前免费、无在线支付，不许写“已支持在线支付/自动发 key”。
- **App 侧接线**：`api.ts` 增加 `PLATFORM_URL`，`keyPage` 默认 `platform.qigai.tech/keys`、`purchasePage` 默认 `platform.qigai.tech/upgrade`（自定义值仍优先）；设置页 placeholder 与页脚改为 v0.16；钱包页脚改为“订阅与支付在 platform.qigai.tech 完成”。
- **版本**：0.16.0。
- **未做**：Cloudflare 部署 platform Worker（需主 agent 做）、真机验证（Java 解释器与 fast 模式只做了人工复核，未跑 Gradle/真机）、PR。

> 写给任何接手的人或 AI：先读这份，再看 `git log`。每完成一小步就 commit + push。
> 未完成的提交信息带 `[skip ci]`，可编译、可出包的提交才不带，这样 Actions 只为能用的版本打 APK。

## 现状（v0.5，tag `v0.5`）
- Vite + React 19 + TS，Capacitor 8 Android（appId `tech.qigai.lumi`）。
- `src/glass.tsx` 液态玻璃组件；`src/api.ts` OpenAI 兼容 SSE（经济/极速两档 Key 与模型，`reasoning_content`）；`src/store.ts` localStorage 会话与用量；`src/App.tsx` 首页、对话、模式面板、钱包、设置。
- CI：`.github/workflows/android.yml`，push main 出预发布 `build-N`，打 `v*` tag 出正式 Release，附 `lumi-chat.apk`（debug 签名）。

## v0.7 目标（用户 2026-11-17 18:02 的需求）
1. **会话内 Markdown 渲染**：GFM（表格、任务列表、删除线、链接、图片）、代码高亮 + 复制。
2. **LaTeX 渲染**：`$..$`、`$$..$$`、`\(..\)`、`\[..\]`，KaTeX + mhchem，流式时公式未闭合不闪烁。
3. **类 GPT 的生成式界面（Intelligence UI）**：模型输出 ```` ```lumi-ui ```` JSON 代码块，App 渲染成原生卡片（card / stats / list / steps / kv / progress / chart / callout / buttons），按钮点击把 prompt 作为下一条消息发出。设置里可开关。
4. **图片 / 视频生成**：输入框「+」里切换「对话 / 生成图片 / 生成视频」。
   - 图片：`POST {media}/v1/images/generations`（model、prompt、size），支持 `b64_json` 和 `url`。
   - 视频：`POST {media}/v1/videos` → 轮询 `GET /v1/videos/{id}` → `GET /v1/videos/{id}/content`；网关若直接返回 url 也兼容。
   - 结果存 IndexedDB（`src/media.ts`），消息里只存 id。
   - 设置：媒体网关地址、Key、图片模型/尺寸、视频模型/时长（默认 gpt-image-1 / sora-2，可改成网关支持的任意模型）。
5. **钱包重做**：参考 Figma 社区文件 *InsureTech UI Cards*（Maietry，CC BY 4.0）与 *100 card design templates UI kit*（Yan Liu，CC BY 4.0）的卡片式布局：大余额卡（渐变 + 卡号式账户行）、套餐/线路卡、统计卡、近 14 天图表卡、账单流水卡片列表。README 注明署名。
6. **主题**（来自 v0.6 设计稿 `design/v06`）：
   - 主题一（默认）橙白渐变 `linear-gradient(170deg,#ffdcc4,#ffeee2 42%,#fffaf6)`，白色磨砂玻璃，珊瑚色 `#e0583e` 唯一强调色，墨色 `#141a26`，问候语用衬线体。
   - 主题二「自定义壁纸」：用户在设置里选一张本机图片，App 压缩后存本地，叠暖色白纱保证可读。**不把带第三方水印的星空图打进公开仓库**（需原作者授权）。
7. 版本号 0.7，README 更新，打 tag `v0.7` 让 Actions 出 APK。

## 文件规划
| 文件 | 内容 | 状态 |
|---|---|---|
| `src/md/parse.ts` | mdast 解析（移植 deepseek-ai/chat-demo，MIT） | 已写 |
| `src/md/Markdown.tsx` | 递归渲染、KaTeX、Prism、流式节流 | 已写 |
| `src/genui.tsx` | lumi-ui 组件与系统提示词 `GENUI_PROMPT` | 已写 |
| `src/media.ts` | IndexedDB 存图片/视频/壁纸 | 已写 |
| `src/api.ts` | 新设置项、system prompt、`generateImage`、`generateVideo` | 已写 |
| `src/App.tsx` | 接入 Markdown、生成模式、媒体消息、新钱包、主题、设置项 | 已做 |
| `src/index.css` | v0.6 主题变量、Markdown/KaTeX/代码/genUI/钱包样式 | 已做 |
| `README.md` | 新功能、署名（chat-demo MIT、两个 Figma 文件 CC BY 4.0） | 已做 |

## 约定
- 中文界面，不用 emoji（内联 SVG 图标，`src/icons.tsx`）。
- Key 只存本机。不提交任何密钥。
- 本地出包：`npm run build && npx cap sync android && cd android && ./gradlew assembleDebug`。
- 第三方素材（Figma 文件、chat-demo 代码、壁纸照片）当参考资料，按各自许可署名。

## 进度日志
- 2026-11-17 18:25 计划写好；parse/Markdown/genui/media/api 已写，尚未接入 App，未编译验证。
- 2026-11-17 18:50 全部接入并通过编译；`$$` 单行公式按块级显示；截图自测 Markdown/公式/卡片/钱包正常。版本号 0.7，打 tag v0.7 由 Actions 出 APK。
- 待验证：真机上壁纸主题、图片/视频接口（取决于网关支持的模型）。

---

# v0.8 改动计划（用户 2026-11-17 18:41）

需求原话：后端适配 sub2api，可以自定义接入 opencode、opendesign 等第三方订阅；API Key 输入框下方有蓝色超链接，点进去直接跳转获取密钥；打包转发成三个模型 Helium / Neon / Argon，按智力打包，只能用这三个；钱包充值改成会员订阅 Pro / Max / Ultra，定价 50 / 100 / 200。

## 后端（不改 Sub2API 源码，只做部署与配置，见 `server/`）
Sub2API 已原生支持需要的能力（已核对 vendor/sub2api 源码与 docs/COMPOSITE_GROUPS.md）：
- 上游平台：anthropic、openai、gemini、antigravity、grok、kimi、zhipu、deepseek、minimax、**opencode_go（OpenCode Zen 按量 / Go 订阅）**、command_code、cline、composite。其他任何 OpenAI 兼容的第三方订阅可作为 openai 平台 API Key 账号接入（自定义 base_url）。
- **Composite 分组 + 路由表**：`public_model` → `target_platform` + `upstream_model`。用它把上游打包成 `helium` / `neon` / `argon` 三个公开模型。
- **订阅套餐**：分组 `subscription_type=subscription`，绑定支付套餐（易支付 / 支付宝 / 微信 / Stripe），可设日/周/月额度（USD 计）。
- **`GET /v1/usage?days=14`**（用 API Key 调）：返回 `planName`（分组名）、`subscription`（日/周/月已用与上限、`expires_at`）、`daily_usage`（每日 tokens、cost）。App 钱包直接读它。
- 用户控制台路由：`/keys`（API 密钥）、`/purchase`（购买/订阅）、`/subscriptions`。

部署：`server/docker-compose.yml`（sub2api + postgres + redis，来自上游 deploy/docker-compose.local.yml）、`server/.env.example`、`server/SETUP.md` 一步步配置：
1. 添加上游账号（OpenCode / Claude / Codex / Gemini / DeepSeek / 任意 OpenAI 兼容）。
2. 建三个 composite 订阅分组 `Pro`、`Max`、`Ultra`（分组名即 App 显示的套餐名），每组加路由：
   | 公开模型 | 定位 | 建议上游（可换） |
   |---|---|---|
   | helium | 轻快，日常问答 | deepseek-chat / glm / kimi 等便宜快模型 |
   | neon | 均衡，写作与代码 | claude-sonnet / gpt-5 级 |
   | argon | 最强推理 | claude-opus / gpt-5 high / gemini-pro 级 |
   分组模型白名单只放这三个，用户只能用这三个。
3. 套餐：Pro ¥50/月、Max ¥100/月、Ultra ¥200/月；额度在分组的月/周/日上限里设（建议 Max ≈ Pro×2.5、Ultra ≈ Pro×6，待用户定）。Pro 是否含 Argon 待用户定（默认：三档都含三个模型，只差额度）。
4. CORS 放行 App 来源 `https://localhost`、`capacitor://localhost`、`http://localhost`。

## App
- 模型：删掉经济/极速两档与所有模型名、单价设置，固定 Helium / Neon / Argon（模型面板三张卡，按智力排）。深度思考开关改为发 `reasoning_effort: "high"`。
- 设置：网关地址 + 一个 API Key；Key 输入框下方蓝色链接「获取密钥 →」打开 `{网关}/keys`（可在高级里改地址）。
- 钱包 → 会员：当前套餐卡（读 `/v1/usage`：套餐名、到期、本月已用/上限进度）、Pro/Max/Ultra 三张订阅卡（¥50/100/200 每月），「订阅」打开 `{网关}/purchase`；近 14 天用量图表与账单改读网关 `daily_usage`，网关不可达时回退本机记录。
- 旧设置自动迁移（ecoKey → apiKey）。
- 版本 0.8，tag v0.8。

## 进度
- 2026-11-17 18:58 计划写好。
- 2026-11-17 19:20 v0.8 完成：server/（Sub2API compose + SETUP.md）、App 三模型（元素周期表徽章）、获取密钥链接、会员页（mock /v1/usage 截图自测）。版本 0.8，tag v0.8。
- 待用户定：各套餐额度（USD 上限）、Pro 是否含 Argon、三个模型各自接哪个上游；"opendesign" 未找到对应平台，按 OpenAI 兼容 API Key 方式接入。

---

# v0.9 前端重构（用户 2026-11-17 19:12）

需求：按 v0.6 设计稿（`栖语 Lumi · v0.6` 三屏 + 桌面首页）重构前端。功能保留 v0.8（Helium/Neon/Argon、Pro/Max/Ultra 会员、Markdown/LaTeX、智能界面、图片/视频生成、壁纸主题）。

## 布局
- 顶部：「栖」珊瑚方块 logo + 栖语，右侧搜索按钮 + 头像（Q，点开设置）。下面玻璃胶囊导航：对话 / 收藏 / 智能体 / 会员（桌面横排居中）。去掉底部 Tab 栏和悬浮铅笔。
- 首页：衬线问候「晚上好，Qi」+「今天想聊点什么？」；白色磨砂输入卡（＋菜单、模型胶囊 He Helium ▾、深度思考胶囊、珊瑚发送键），首页直接发送即新建对话；快捷指令胶囊：润色文字 / 解释代码 / 旅行计划 / 读论文 / 写周报；「最近对话」衬线标题 +「全部 N」，文件夹式卡片（珊瑚/鼠尾草绿/金三色轮换，三张纸片露出对话片段，其中一张深色代码纸，玻璃前片写标题，底部「模型 · N 条」和时间），长按删除。
- 对话：顶部玻璃条（返回、标题、副标题「模型 · 深度思考」、新建 ＋）；用户气泡白色磨砂；回答头「● 栖语」+ 右侧模型胶囊；思考链折叠「已深度思考 · N 秒」左竖线；回答衬线正文；操作：复制 / 重答 / 收藏 + 首字耗时；底部单个胶囊输入「＋ 继续追问…」。
- 模式面板：白色底部面板，衬线标题「选择模式」，套餐卡（粉色，当前套餐 + 本月已用，「订阅」跳会员页），分段「对话模型 / 深度思考」，三模型行 + 珊瑚单选，黑色大按钮「使用 Neon」。
- 收藏：回答点星标收藏，收藏页列出（来源对话、片段、跳回对话）。
- 智能体：预设系统提示词（翻译官、代码助手、论文精读、周报写手、旅行规划、润色编辑），点开即带该提示词新建对话。
- 会员：套餐卡改成「账户卡」样式，Pro/Max/Ultra 竖排整行卡，14 天图表、用量记录。
- 设置：从头像进入，带返回；图标统一浅珊瑚底，开关珊瑚色。
- 背景：橙白渐变 + 淡半调网点装饰。

## 进度
- 2026-11-17 19:20 计划写好，开始改 App.tsx / index.css。
- 2026-11-17 19:45 v0.9 完成并通过编译；Playwright 截图自测首页（手机/桌面）、对话（思考链、卡片、公式）、模式面板、会员、智能体、收藏、设置，首页直接发送→新建对话→流式回答正常。截图在 `design/v09/`。版本 0.9，tag v0.9。
- 待用户看真机：文件夹卡片在小屏的密度、桌面端问候字号。

---

# v0.10 侧栏（用户 2026-11-17 19:27）

需求：去掉顶栏（logo、文字、胶囊导航、头像），改成 ChatGPT 式左侧栏：新建对话 / 技能 / MCP / 定时任务 / 项目 / 最近对话，底部「我的」（头像在这里），升级会员放在「我的」里。原 logo 位置换成侧栏按钮。

- 侧栏：桌面（≥980px）常驻 300px，可收起；手机从左滑出 + 遮罩。顶部侧栏按钮 + 搜索。
- 技能 = 原智能体预设。项目：名称 + 项目说明（注入 system），项目内新建对话。MCP：添加 Streamable HTTP 服务器，initialize + tools/list 读取工具（对话内调用工具待做）。定时任务：时间 + 星期 + 提示词，App 打开时每 30 秒检查到点执行，错过 6 小时内补跑，结果存成新对话。
- 我的：头像卡、套餐卡（管理/升级）、升级会员 / 收藏 / 设置。
- 2026-11-17 19:50 完成，编译通过，Playwright 截图自测（design/v10/）。tag v0.10。

---

# v0.11 后端 + 液态玻璃（用户 2026-11-17 19:40）

需求：三个模型暂时都映射到 DeepSeek V4.1 Flash（官方 API），前端只显示 Helium/Neon/Argon，内置提示词让模型无论怎么问都只认这个名字；界面参考 Figma：Apple Liquid Glass iOS 26 Control Center、Iconly、Glassmorphism Glass Icon Set、Modern Galaxy Folder；MCP 卡片加官网和官网头像。

- 后端：`server/worker/`（Cloudflare Worker `lumi-api`，自定义域 https://api.qigai.tech）。helium/neon/argon → `deepseek-flash`；身份提示词在服务端注入；流里的 model 字段换回公开名；上游报错里的模型名也替换。深度思考开关 → `thinking: enabled/disabled`。密钥 DEEPSEEK_KEY、LUMI_KEY 存为 Worker secret，不进仓库。App 默认网关改为 api.qigai.tech。
- 以后上 Sub2API 时，把三条路由的 upstream_model 填 `deepseek-flash`（target_platform deepseek）即可，身份提示词需要另加（Sub2API 不注入）。
- 界面：Iconly 风格重画主要图标；玻璃图标（彩色底块 + 磨砂玻璃前片）用于侧栏、我的、空状态；侧栏 / 输入卡 / 卡片加液态玻璃高光；文件夹悬停或按住时纸张抽出、前盖前倾。
- MCP：官网（可填，默认从地址推断，去掉 mcp./api. 前缀）+ 官网 favicon（加载失败回退首字母），状态点放在头像角上。
- 2026-11-17 自测通过（design/v11/），tag v0.11。
- v0.11.1：文件夹前盖改成磨砂玻璃（前盖里放模糊的纸张副本，不依赖 backdrop-filter）；默认头像去掉首字母，用户头像换成人形图标，MCP 官网头像加载失败时显示玻璃插头图标。
- v0.11.2（2026-11-17 20:20）：Playwright 实测（scripts/e2e.py，连真实 api.qigai.tech）：首字 0.8 到 2.0 秒，身份、表格、代码、深度思考、停止生成都通过。修复：网关和公开客户端密钥 APP_KEY 内置，装好就能用（Worker 接受 LUMI_KEY 或 APP_KEY，并按 IP 每分钟限 20 次）；报错改成中文（断网、401、429、5xx）；停止生成后显示「已停止生成」并可以重答；输入框在深色代码上方不再发灰；表格单元格自动换行，不再被截断。沙盒代理会对 CORS 预检返回 407，测试脚本里用 route 绕过，真机不受影响。

## v0.12 角色扮演（2026-11-17）
用户：官方支持角色扮演类，支持链接导入酒馆角色卡。
- src/chara.ts：PNG（chara/ccv3，tEXt/iTXt）、JSON V1/V2/V3、chub.ai/characterhub 链接（avatars.charhub.io 卡 → api.chub.ai 兜底）、网页 og:image；宏 {{char}}/{{user}}；世界书（常驻 + 关键词）；对话示例；开场白与备选开场（左右切换）。
- 侧栏「角色」页：链接导入、文件导入、自己写；编辑页；设置里「我的名字」「用我的语言回复」。
- Worker：/v1/card 代理（需密钥，15 MB 上限，拦内网）；lumi_mode=roleplay 时用入戏版身份提示（OOC 问模型仍答 Lumi）。
- 实测：chub 导入 0.26s（8 条世界书），英文卡中文回复，OOC 答「由栖语 Lumi 的 Neon 模型驱动」。

## v0.13 角色内容渲染（2026-11-17）
用户：针对酒馆角色，生成渲染的功能内容特殊优化。
- src/rp.tsx RpView：HTML 块（div/details/table/style…、```html）进无脚本沙箱 iframe，按内容自适应高度；自定义标签（<stats> 等）和「键: 值」代码块 → 玻璃状态卡（数组→标签，a/b 与百分比→进度条，??? 变灰）；<think>/<inner>/心声 → 折叠；行内 span/font 白名单净化；台词引号高亮；*动作* 浅色斜体。
- chara.ts：导入 extensions.regex_scripts，runRegex 按 placement / markdownOnly / promptOnly 在显示与发给模型两侧分别执行（不改存储）。
- 实测：mock 卡（正则好感度条 + stats + details 公告 + think）与 Isekai RPG 真实对话均正常。

## v0.14 HTML 预览、手机连接、手机存储（2026-11-17）
用户：支持在应用内渲染预览 html；支持通过无障碍和自建 adb 链接手机；支持通过手机存储来保存项目。
- HTML 预览：html/svg 代码块「预览」→ 全屏沙箱（允许脚本，不同源），手机/平板/全宽切换、刷新、保存到手机（网页/标题-时间.html）。
- 原生插件 LumiPhone（android/.../PhonePlugin.java）：
  - LumiA11yService：读屏（编号元素列表）、点击/长按、输入（SET_TEXT）、滚动、滑动手势、系统键、打开应用。
  - LumiAdb（libadb-android 3.1.1，Apache-2.0；BouncyCastle 生成证书）：无线调试配对（LumiPair：mDNS 找 _adb-tls-pairing 端口 + 通知栏 RemoteInput 填配对码；也可手动输端口/码），自动连接（autoConnect / 发现的 connect 端口 / 5555），shell。
  - SAF 文件夹：pickFolder 持久授权，writeText/readText/list/remove。
- 手机操控模式：对话「+」→ 手机操控，模型获得 phone_* 工具；工具循环最多 30 步，步骤折叠显示；Worker 透传 tools / tool_calls / tool_call_id / reasoning_content。
- 项目存到手机：项目/<名>/ 下存 项目说明.md、对话/*.md（自动同步）、.lumi/*.json（导入用）；项目页可浏览文件、预览 html；项目列表「从手机存储导入项目」。项目里模型可用 phone_save/read/files 读写项目文件夹。
- 待真机验证：无障碍读屏、配对通知、ADB shell、SAF 写入。

## v0.15 Flow 工作流（2026-11-17）
用户：针对无障碍的 Flow 功能，自定义点击行为作为应用的小工作流（小红书 搜索、美团 点外卖…），AI 可以自定义、优化、保存 Flow。
- 原生 LumiFlow（无障碍服务内）：录制（点击/长按/输入/滚动/启动应用事件 → 步骤，选择器 id+文字+描述，坐标存 0-1 比例）；运行（选择器打分查找、等待重试、坐标兜底、optional 跳过、confirm 悬浮条确认）；TYPE_ACCESSIBILITY_OVERLAY 悬浮条显示进度/停止/完成/撤销。
- src/flow.ts：Flow 存 localStorage（关联了手机文件夹时同步到 Flow/flows.json），{参数} 替换、tidy 清理、flow_list / flow_run / flow_save 工具。
- 页面：侧栏 Flow（按应用分组、运行、录制新 Flow 选应用）；编辑页（改名/说明、步骤展开编辑、可选/确认/上下移/删除、添加步骤、AI 优化预览后采用、试运行，失败定位到卡住的步骤）。
- 手机操控对话：系统提示带上 Flow 列表，匹配时优先 flow_run；失败返回屏幕让模型接手并建议 flow_save 修复；执行过的操作记录 trace，完成后显示「存成 Flow」。
- 实测：网关上模型能正确调用 flow_run 并填参数；Flow 列表、编辑、AI 优化页面截图正常。原生部分待真机。

## v0.15.1 Flow 页面重做（2026-11-17）
用户：小红书用它的应用图标做成卡片，点进去看 Flow；页面太丑，参考 Figma 社区。参考 iOS 快捷指令的彩色卡片。
- 原生 appIcon（PackageManager 图标转 PNG base64），src/appicon.ts 按色相分桶取图标主色、缓存，tint() 生成渐变（黄色系用深色字）。
- Flow 首页：按应用的两列彩色卡（图标、Flow 数、Flow 名小标签）+「新应用」虚线卡；应用选择改为带图标的底部弹窗。
- 应用页 flowapp:<app>：大图标头图、录制新 Flow、快捷指令式 Flow 卡（点卡片运行，右上角编辑，运行中有闪光），参数用底部弹窗填写。
- 编辑页：应用头卡 + 带步骤图标的时间线（新增 tap/keyboard/enter/scroll/hourglass 图标）。
