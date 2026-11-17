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
