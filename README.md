# 栖语 Lumi

一个仿 Claude 体验的 AI 聊天 App（Android / Web），iOS 26/27 Liquid Glass 风格。

- **两档线路**：经济（官方价 0.5×）/ 极速（官方价 1.5×），可分别配置 Key 和模型
- **流式输出**：OpenAI 兼容 `/v1/chat/completions`，支持 DeepSeek 的思考过程（`reasoning_content`）
- **Liquid Glass**：导航层用玻璃，内容层实色（遵循 Apple HIG）。材质参数参照 [miuix-glass](https://github.com/compose-miuix-ui/miuix)，边缘折射用 SVG `feDisplacementMap` 做 backdrop-filter（Android WebView / Chromium 生效，其他浏览器回退为模糊）
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

MIT License
