# 栖语 Lumi

一个仿 Claude 体验的 AI 聊天 App（Android / Web），橙白暖色玻璃风格，可换自定义壁纸。

- **三个模型**：Helium（轻快）/ Neon（均衡）/ Argon（最强），由 Sub2API Composite 分组把任意上游打包而成，App 只能用这三个
- **会员订阅**：Pro ¥50 / Max ¥100 / Ultra ¥200 每月，套餐、到期、额度与每日用量实时读网关 `/v1/usage`
- **流式输出**：OpenAI 兼容 `/v1/chat/completions`，支持 DeepSeek 的思考过程（`reasoning_content`）
- **Liquid Glass**：导航层用玻璃，内容层实色（遵循 Apple HIG）。材质参数参照 [miuix-glass](https://github.com/compose-miuix-ui/miuix)，边缘折射用 SVG `feDisplacementMap` 做 backdrop-filter（Android WebView / Chromium 生效，其他浏览器回退为模糊）
- **Markdown + LaTeX**：GFM 表格、任务列表、代码高亮与复制；`$..$`、`$$..$$`、`\(..\)`、`\[..\]` 公式（KaTeX + mhchem），流式输出不闪烁
- **智能界面**：模型可用 ` ```lumi-ui ` JSON 输出卡片（数据、图表、步骤、清单、进度、按钮），按钮点了直接发下一句
- **图片 / 视频生成**：输入框「+」切换，OpenAI 兼容 `/v1/images/generations` 与 `/v1/videos`，结果存本机
- **会员页**：套餐卡、三档订阅卡、14 天用量图、用量记录
- **v0.10 侧栏**：ChatGPT 式左侧栏（新建对话、技能、MCP、定时任务、项目、最近对话、我的），升级会员在「我的」里。截图见 `design/v10/`
- **v0.9 新界面**：衬线问候 + 首页直接输入、快捷指令、文件夹式最近对话（长按删除）；顶部胶囊导航「对话 / 收藏 / 智能体 / 会员」，头像进设置；思考链折叠显示秒数；回答可收藏；六个预设智能体；模式面板（套餐卡 + 对话模型 / 深度思考）。
- **v0.19 Flow 卡片排布**：Flow 卡回到 v0.17 原版的饱和 mesh 渐变 + 白字 + 白框应用图标，加发丝高光和柔和大阴影；全部图标回到原版两层玻璃图标（彩色底块 + 磨砂玻璃前片）。Flow 总览改成便当格（Flow 最多的应用是 2×2 大格，列出 Flow 和播放键，其余是 2×1 宽格、1×2 高格和小方格，宽格 / 高格上的胶囊可直接运行），尺寸只由 Flow 数量决定；应用页的 Flow 是钱包式叠卡，点一张抬起展开看步骤和运行键（≤2 个直接展开）。截图见 `design/v19/`
- **v0.18 界面重做**：参考 Figma Community 的几个 Riffs，Flow 卡片改成浅色实底 + 每张卡一个强调色（图标块、徽标、淡光晕），发丝描边 + 柔和大阴影；侧栏、弹窗、列表、输入条、按钮、Flow 编辑器统一成同一套样式，文字对比度 ≥4.5:1（`node scripts/contrast.mjs`）；侧栏关上就是一条图标栏（新对话 / 技能 / MCP），展开是完整侧栏（手机上盖在内容上）。截图见 `design/v18/`
- **v0.17 Flow**：类（字段 + 方法，方法体是子流程）、`new` 实例化、`obj.field` 读写、`obj.method()`（运行时绑定 `this`）；逻辑节点端到端可用并修了 v0.16 的几个 bug（do-while 校验永远失败、for 超过 20 次被误判、初始变量没传给原生、`${变量}` 在输入框里不替换）；AI 视觉步（缓存选择器命中直接走原生，不调模型；未命中才截图（长边 720px、JPEG q60）+ 元素列表发给 Helium 定位，找到的选择器自动写回 Flow）；运行明细显示每步耗时和来源（原生 / 缓存 / 视觉）；Flow 卡片换成自绘 mesh 渐变（白字，对比度 ≥5.8:1）；侧栏折叠成图标栏（新对话 / 技能 / MCP）手机和桌面都可用；我的 / 设置里的升级会员、获取 API Key、提交反馈都直达 platform.qigai.tech。截图见 `design/v17/`
- **v0.16 Flow 逻辑节点**：if/else、while/do-while/for、break/continue、变量 set、子流程 call；迷你侧栏（折叠后只留新建对话/技能/MCP）；Flow 卡片新浅色配色；官网 platform.qigai.tech（获取密钥 /upgrade /反馈）
- **本地存储**：对话、Key、用量只存在本机

## 下载

到 [Releases](../../releases) 下载最新 `lumi-chat.apk`（每次推送 main 会自动构建）。

## 配置

打开 App →「设置」填网关地址和 API Key；Key 输入框下方的蓝色「获取密钥」直接跳到 platform.qigai.tech/keys，订阅页在 platform.qigai.tech/upgrade。
网关怎么搭、怎么接入 OpenCode / Claude / Codex / Gemini / DeepSeek 等第三方订阅、怎么打包成 Helium / Neon / Argon、怎么建 Pro / Max / Ultra 套餐，见 [server/SETUP.md](server/SETUP.md)。

## 开发

```bash
npm i
npm run dev            # 浏览器预览
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```

Flow 测试：

```bash
node scripts/flow-test.mts          # TS 侧：校验、求值、类展开（node 22+ 直接跑 TS），并生成 TS→Java 用例
scripts/flowvm-test/run.sh          # Java 侧：FlowVm 解释器在普通 JVM 上跑（需要 JDK 17+），含上面的 TS→Java 端到端用例
python3 scripts/v18_shots.py        # 截图自测（需要 playwright），原生插件是模拟的
node scripts/contrast.mjs           # 界面文字对比度检查（WCAG ≥4.5:1）
```

## Flow 速度的口径

- 原生步（选择器、坐标）和 AI 步的「缓存命中」走无障碍，不调模型；快速模式下目标约 1 秒以内一步（启动应用、页面加载算在步骤里，看应用本身）。
- AI 视觉步第一次（或缓存的选择器失效时）一定有一次模型往返：截图缩到长边 720px、JPEG 质量 60，只要一行 JSON，关闭深度思考、max_tokens 40，下一步要视觉时提前截图。实际耗时取决于网络和模型，不保证 1 秒。找到后选择器写回 Flow，之后走原生。
- 网关上游不收图片时自动退回只发元素列表（文字定位）。无障碍截屏要 Android 11 以上。

## 致谢

- [compose-miuix-ui/miuix](https://github.com/compose-miuix-ui/miuix)（Apache-2.0）玻璃材质参数
- [seunghan91/ios27-design-system](https://github.com/seunghan91/ios27-design-system)（MIT）系统色与实测模糊/雾度
- Apple Human Interface Guidelines · Materials
- [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）Markdown / 公式解析与渲染思路
- Flow 卡片（mesh 渐变、颗粒、便当格、叠卡）与玻璃图标：本仓库自写的 CSS，图标为内联 SVG，均为本项目原创，以 CC0 1.0 释出
- v0.18 界面风格参考了 Figma Community 的这些 Riffs（只看了公开预览、提炼了设计原则，没有下载或复制任何素材、代码、图片）：
  - [Figma, Claude, ChatGPT in one dock ✨](https://www.figma.com/riffs/bdefa2ba-16df-4bc6-8fb8-b1eabf96a742) — Hijrat (@hijrat)
  - [Artificial Design: an orbit of AI tools](https://www.figma.com/riffs/5fca8363-2256-4c47-8309-eaadf42b3c36) — Hijrat (@hijrat)
  - [Modern Galaxy Folder.📂👀](https://www.figma.com/riffs/e0866623-bbe0-4c52-87c3-819eeaa98cc7) — Nastaran Jamali (@Nasiwho)
  - [UI Liquid Glass Menu 👓](https://www.figma.com/riffs/a2fc7bfe-ad9c-4d19-a95c-2aa709a62323) — Hardik Gondhiya (@hardikgondhiya)
  - [150+ Bento UI Components …](https://www.figma.com/riffs/c9a8f549-aafc-47ea-8cee-0e71d2fd98a3) — DD UIUX (@dd_uiux)
  - [A tab bar that flows instead of slides](https://www.figma.com/riffs/07c35a71-d36c-44da-b9e4-97c90b5cebd0) — Crafttor (@CrafttorDesign)
  - [Speak, and watch it listen 🎙️🧡](https://www.figma.com/riffs/6707d7d8-77c5-4424-b460-156b5f192981) — Hijrat (@hijrat)
  - [Liquid Dropdown Flow](https://www.figma.com/riffs/75f78ed4-77ec-443f-8044-800428157795) — Hijrat (@hijrat)
  - [Searching for user 🔎🕵️✅](https://www.figma.com/riffs/e161a88d-3cc2-4e5b-8dff-cf629a6b075f) — Hijrat (@hijrat)
  - [A sleek, premium metallic button …](https://www.figma.com/riffs/81788abd-73cb-4e19-a19f-69a77e85df00) — Harshita Upadhyay (@velvetdrafts)
- v0.19 卡片排布参考了 Figma Community 的这 5 个 Riffs（只看了公开预览、借了排布与交互思路，没有下载或复制任何素材、代码、图片）：
  - [Card shuffle (RIFF 28)](https://www.figma.com/riffs/573ca127-c0de-4d04-90c1-f94e8f52d6f5) — Alejandro Vasquez (@alefunlab)：竖向叠放、后面的卡只露出顶部色带
  - [Magnetic Player](https://www.figma.com/riffs/82709a3f-d316-42f8-a413-00a47a479b63) — Hijrat (@hijrat)：收起成一叠、点开弹簧展开
  - [Bento UI Components / Bento Design System](https://www.figma.com/riffs/c9a8f549-aafc-47ea-8cee-0e71d2fd98a3) — DD UIUX (@dd_uiux)：1×1 / 2×1 / 1×2 混合尺寸的便当格、统一间距和大圆角（Flow 总览）
  - [3D Cylindrical Carousel](https://www.figma.com/riffs/10770094-8b74-453e-9b87-3862bc3abad4) — Arian Taheri (@ariantaheri)：聚焦卡更亮、旁边的卡缩小变暗
  - [Five glossy cards, one continuous shuffle](https://www.figma.com/riffs/a2d24278-2ca5-488b-994a-649fe4fb210f) — waqarhsyed (@waqarhsyed)：钱包式叠卡、前面的卡抬起（应用页 Flow 叠卡）
- Figma 社区文件 [InsureTech UI Cards](https://www.figma.com/community/file/1220009834416519318)（Maietry，CC BY 4.0）与 [100 card design templates UI kit](https://www.figma.com/community/file/1097964499926853798)（Yan Liu，CC BY 4.0）钱包卡片布局参考

MIT License
