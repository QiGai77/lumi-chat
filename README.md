# 栖语 Lumi

一个仿 Claude 体验的 AI 聊天 App（Android / Web），橙白暖色玻璃风格，可换自定义壁纸。

- **两档线路**：经济（官方价 0.5×）/ 极速（官方价 1.5×），可分别配置 Key 和模型
- **流式输出**：OpenAI 兼容 `/v1/chat/completions`，支持 DeepSeek 的思考过程（`reasoning_content`）
- **Liquid Glass**：导航层用玻璃，内容层实色（遵循 Apple HIG）。材质参数参照 [miuix-glass](https://github.com/compose-miuix-ui/miuix)，边缘折射用 SVG `feDisplacementMap` 做 backdrop-filter（Android WebView / Chromium 生效，其他浏览器回退为模糊）
- **Markdown + LaTeX**：GFM 表格、任务列表、代码高亮与复制；`$..$`、`$$..$$`、`\(..\)`、`\[..\]` 公式（KaTeX + mhchem），流式输出不闪烁
- **智能界面**：模型可用 ` ```lumi-ui ` JSON 输出卡片（数据、图表、步骤、清单、进度、按钮），按钮点了直接发下一句
- **图片 / 视频生成**：输入框「+」切换，OpenAI 兼容 `/v1/images/generations` 与 `/v1/videos`，结果存本机
- **卡片式钱包**：本月消费卡、线路卡、14 天图表、账单
- **本地存储**：对话、Key、用量只存在本机

## 下载

到 [Releases](../../releases) 下载最新 `lumi-chat.apk`（每次推送 main 会自动构建）。

## 配置

打开 App →「设置」：

| 项 | 说明 |
| --- | --- |
| 地址 | 你的 [Sub2API](https://github.com/Wei-Shaw/sub2api) 网关地址，或 `https://api.deepseek.com` |
| 经济 Key / 极速 Key | 网关里两个分组各自的 Key；极速留空则共用经济 Key |
| 模型 | 默认 `deepseek-chat`，深度思考用 `deepseek-reasoner` |
| 单价 | 只用于 App 内估算显示，实际扣费以网关为准 |
| 充值页 | Sub2API 用户中心地址 |
| 图片与视频生成 | 地址和 Key 留空则沿用上面的；模型默认 `gpt-image-1` / `sora-2`，可改成网关支持的任意模型 |
| 主题 | 橙白（默认）或壁纸（从本机选一张图） |

> 网关需要允许跨域（CORS），App 的来源是 `https://localhost`。

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
