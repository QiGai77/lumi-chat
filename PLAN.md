# 栖语 Lumi v0.7 改动计划（交接文档）

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
