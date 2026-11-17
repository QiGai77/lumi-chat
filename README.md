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
- **v0.9 新界面**：衬线问候 + 首页直接输入、快捷指令、文件夹式最近对话（长按删除）；顶部胶囊导航「对话 / 收藏 / 智能体 / 会员」，头像进设置；思考链折叠显示秒数；回答可收藏；六个预设智能体；模式面板（套餐卡 + 对话模型 / 深度思考）。截图见 `design/v09/`
- **本地存储**：对话、Key、用量只存在本机

## 下载

到 [Releases](../../releases) 下载最新 `lumi-chat.apk`（每次推送 main 会自动构建）。

## 配置

打开 App →「设置」填网关地址和 API Key；Key 输入框下方的蓝色「获取密钥」直接跳到网关的 `/keys` 页。
网关怎么搭、怎么接入 OpenCode / Claude / Codex / Gemini / DeepSeek 等第三方订阅、怎么打包成 Helium / Neon / Argon、怎么建 Pro / Max / Ultra 套餐，见 [server/SETUP.md](server/SETUP.md)。

## 开发

```bash
npm i
npm run dev            # 浏览器预览
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```

## 致谢

- [compose-miuix-ui/miuix](https://github.com/compose-miuix-ui/miuix)（Apache-2.0）玻璃材质参数
- [seunghan91/ios27-design-system](https://github.com/seunghan91/ios27-design-system)（MIT）系统色与实测模糊/雾度
- Apple Human Interface Guidelines · Materials
- [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）Markdown / 公式解析与渲染思路
- Figma 社区文件 [InsureTech UI Cards](https://www.figma.com/community/file/1220009834416519318)（Maietry，CC BY 4.0）与 [100 card design templates UI kit](https://www.figma.com/community/file/1097964499926853798)（Yan Liu，CC BY 4.0）钱包卡片布局参考

MIT License
