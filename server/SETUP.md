# 栖语 Lumi 后端：Sub2API

App 只认三个模型 `helium` / `neon` / `argon` 和三档会员 Pro / Max / Ultra。全部用 [Sub2API](https://github.com/Wei-Shaw/sub2api)（LGPL-3.0）原生功能实现，不改它的源码。
本目录的 `docker-compose.yml`、`.env.example` 拷自 Sub2API `deploy/`（上游提交 15871f9），`docker-compose.override.yml` 是我们加的跨域配置。

## 1. 启动

```bash
cd server
cp .env.example .env && chmod 600 .env
# 必填：POSTGRES_PASSWORD；建议填：JWT_SECRET、TOTP_ENCRYPTION_KEY（各用 openssl rand -hex 32 生成）
mkdir -p data postgres_data redis_data
docker compose up -d
docker compose logs sub2api | grep "Generated admin"   # 没在 .env 里填管理员时，看这里拿账号密码
```
打开 `http://localhost:8080` 进管理后台。手机连电脑调试时，App 的网关地址填电脑局域网 IP，如 `http://192.168.1.10:8080`。

## 2. 接入上游（第三方订阅 / API）

管理后台 → 账号 → 新建，按平台选：

| 想接的 | 平台 | 账号类型 |
|---|---|---|
| OpenCode Zen（按量）/ OpenCode Go（订阅） | `opencode_go` | API Key |
| Claude Pro/Max 订阅、Claude Code | `anthropic` | OAuth / Setup Token |
| ChatGPT / Codex 订阅 | `openai` | OAuth |
| Gemini、Antigravity | `gemini` / `antigravity` | OAuth / API Key |
| DeepSeek、Kimi、智谱 GLM、MiniMax（含 Coding Plan） | 对应平台 | API Key |
| Command Code、Cline | `command_code` / `cline` | API Key |
| 其他任何 OpenAI 兼容服务（自建、其他中转） | `openai` | API Key，自定义 Base URL |

> 用订阅账号转售可能违反上游服务条款，上线前请自行确认。

## 3. 打包成三个模型

管理后台 → 分组 → 新建三个分组，平台选 **composite**，类型选 **订阅（subscription）**，名称分别叫 `Pro`、`Max`、`Ultra`（App 钱包直接显示分组名）。把第 2 步的账号分配进去，然后在分组的「Routes」里加三条路由：

| public_model | match_type | endpoint | target_platform | upstream_model（示例，可换） |
|---|---|---|---|---|
| `helium` | exact | any | deepseek | deepseek-chat |
| `neon` | exact | any | anthropic | claude-sonnet 系列 |
| `argon` | exact | any | anthropic | claude-opus 系列 |

- 按智力排：Helium 轻快 < Neon 均衡 < Argon 最强。换上游只改路由，App 不用动。
- 分组的模型白名单只放这三个，未知模型 Composite 会直接拒绝，用户只能用这三个。
- 每个 target_platform 要在「渠道」里配好价格，否则计费为 0（Composite 不自动建价格）。
- 图片/视频生成想走同一个网关时，另加 `endpoint=images` 的路由。

## 4. 会员套餐

管理后台 → 支付设置，接易支付 / 支付宝 / 微信 / Stripe（见 Sub2API `docs/PAYMENT_CN.md`），再建三个订阅套餐，各绑一个分组：

| 套餐 | 价格 | 绑定分组 | 额度（分组日/周/月上限，USD，建议值待定） |
|---|---|---|---|
| Pro | ¥50 / 月 | Pro | 月上限 X |
| Max | ¥100 / 月 | Max | 约 2.5X |
| Ultra | ¥200 / 月 | Ultra | 约 6X |

用户在 `/purchase` 订阅后，到 `/keys` 用对应分组建 API Key，填进 App。

## 5. App 用到的接口

- `POST /v1/chat/completions`（model = helium / neon / argon）
- `GET /v1/usage?days=14`：套餐名、到期时间、日/周/月用量与上限、每日用量
- `POST /v1/images/generations`、`POST /v1/videos`（可选）
- 用户页面：`/keys`（App 里「获取密钥」链接）、`/purchase`（「订阅」按钮）
