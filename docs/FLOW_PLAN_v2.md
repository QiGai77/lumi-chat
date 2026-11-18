# Flow v2 重设计方案（录制 / 回放 / 自愈）

> 适用：栖语 Lumi，分支 `v017-flow`，基于 v0.22.0（commit `599d181`）。
> 性质：设计与调研文档，不含代码改动。所有外部结论都在第 12 节列出实际打开过的来源；凡是本文自己的推断或待真机验证的数字，都标了「推断」或「待测」。
> 约束（不变）：只用无障碍服务 + 截图（无 root），可选自建无线 ADB；原生步要快（百毫秒级）；视觉模型一次约 2.3 s 且有成本 → 首跑用 AI、之后走缓存；最终用户不懂技术。

---

## 0. 一页结论

**根因不是"找不到元素"，而是"没有确认页面到了该到的地方"。** 现在的回放器把「动作已派发」当成「这一步成功」，步后只睡固定的 120 ms（快速模式），下一步在旧页面 / 过渡动画里的节点上找元素，于是：前几步"都成功"、真正失败的是后面某一步（通常是 AI 视觉步），错误被推迟、被误报。其余问题（坐标兜底、空选择器、学错的选择器被写回）都会放大这个根因。

**P0 只做五件事就能吃掉大部分失败**（详见第 11 节）：
1. **事件驱动的稳定等待**（settle）：替换所有固定 sleep；动作后先等"有反应"，再等"安静"。
2. **隐式后置条件（look-ahead）**：第 N 步成功的定义改为"第 N+1 步的目标能被找到"，找不到就重做第 N 步，而不是直接去跑第 N+1 步。录制时再补显式 `expect`。
3. **防陈旧节点**：只在目标应用的活动窗口里找；点击前 `refresh()`；动作后要有无障碍事件作"回执"，没有就判为"点了没反应"并重试（Maestro 也是无变化重试 2 次）。
4. **视觉步改为稳定后才截图、只在验证通过后写回**；去掉 180 ms 预取截图。
5. **校验器与提示词**：禁止空选择器的 wait / exists；坐标只在页面指纹一致时才允许兜底。

---

## 1. 现状诊断：根因与代码位置

### 1.1 用户手机上的两次失败，逐步复盘

**失败 A（小红书「搜索后打开第一篇笔记」）**

| 步 | 记录 | 实际发生（推断，依据代码） |
|---|---|---|
| launch 475 ms | `LumiFlow.step` `case "launch"`：快速模式只等「根节点包名变化」，最多 1200 ms（第 427–440 行） | 包名一变就返回。此时多半是开屏页 / 广告页，首页还没出来。 |
| tap「搜索」257 ms | `waitFind(sel, 2500)` → `find()` 遍历**所有**窗口（第 152–162 行），`score()` 里 `text` 用 `contains` 也给 +2 分（第 141 行） | 开屏 / 首页上任何"含有搜索二字"的可见节点都能命中（例如搜索框提示文字、"搜索历史"）。`clickNode()` 只要 `performAction(ACTION_CLICK)` 返回 true 就算成功（第 176–182 行），返回 true 只代表"动作派发了"。 |
| 步后等待 120 ms | `FlowVm.run` 第 120 行 `h.settle(fast ? 120 : 450)` = `sleep(120)` | 页面切换动画通常长于 120 ms，下一步在旧树上找。 |
| tap `com.xingin.xhs:id/...` 109 ms | 同上，109 ms 说明第一次扫描就命中 | 命中的是**旧页面或过渡中**的同 id 节点（小红书多个页面复用 id），点击"成功"但没有达到预期页面。 |
| AI 视觉找「第一篇笔记」失败 | `maybePrefetch()`：下一步是 ai 步时，在步后等待**并行**于 180 ms 后截图（第 306–311 行）；`visionAct` 优先用这张预取图（第 342–344 行），元素列表 `s.dump(60)` 只取 DFS 前 60 个节点、只看 `getRootInActiveWindow()` | 截图拍的是 180 ms 时的过渡画面 / 旧页面；元素列表前 60 个多被顶栏、底栏占满。模型如实回答"屏幕上没有"。真正的错误在第 2、3 步，却在第 4 步报出来。 |

**失败 B（点首页搜索 → 找输入框 → 搜索页弹回首页）**

- `case "input"`（第 459–467 行）：`waitFind(sel, 2500)` 失败后先找焦点输入框，再**不看当前是哪个页面就按录制坐标点一下** `tapRatio(st)`，再找焦点。若此时搜索页还在动画中或已被点回，按录制坐标的一点可能落在"取消 / 返回"上，于是"搜索页弹回首页"。这一条是推断，需要真机录屏 + 事件日志确认，但"坐标兜底不检查页面"本身就是缺陷。
- 和 A 一样：上一步 tap 没有等页面到位，下一步就开始找。

### 1.2 根因清单（按影响排序）

| # | 根因 | 代码位置 | 后果 |
|---|---|---|---|
| R1 | **成功 = 动作已派发**，没有后置条件 | `FlowVm.run` 第 108–121 行；`LumiFlow.clickNode` 第 176–182 行 | 错误延迟暴露、误报在后面的步骤；`trace` 里前几步都显示"原生 · 成功" |
| R2 | **固定时间等待**（步后 120/450 ms、launch 只等包名变化 ≤1.2 s、input 后 150 ms） | `FlowVm` 第 120 行；`LumiFlow.step` launch 分支；`input`/`visionAct` 里的 `sleep` | 快机 / 慢网 / 冷启动 / 开屏广告下都不稳。2017 年微信团队对录制回放工具的实证研究里，appetizer 在朋友圈场景失败，把事件间隔加到 30 s 才不再失败——固定延时在网络型应用上必然脆弱 [R-Industry17] |
| R3 | **在所有窗口、旧树上找节点**，命中即点 | `find()` 遍历 `getWindows()`（只排除 overlay）；`waitFind` 找到第一个就返回 | 命中上一页面 / 过渡中 / 键盘窗口里的同名节点 |
| R4 | **选择器太薄**：只有 id / text / desc / cls；cls 不参与打分；text 用"包含"匹配；同分取 DFS 第一个 | `selOf()` 第 113–124 行；`score()` 第 133–144 行 | 中文应用里 id 被复用 / 混淆、文字为空或动态，多数步骤退化成坐标；美团 `(50%,12%)` 这类步骤即 `sel` 只剩 `cls`，`score()` 恒为 0，只能坐标 |
| R5 | **坐标兜底不检查页面** | `step` 中 tap 第 455 行、input 第 462 行 | 点错页面、触发返回、误触 |
| R6 | **视觉步时序与上下文错误**：180 ms 预取截图；元素列表只取 60 个、只看活动窗口；学到的选择器在动作**之前**就记入 learned，且不论成败都写回 | `maybePrefetch`、`visionAct`、`learn()`（第 369 行在 `doAct` 之前）；`flow.ts runFlow` 无条件 `applyLearned` | 喂给模型旧画面；错误选择器被缓存，下次"缓存命中"直接点错；带列表文字的选择器下次必然 miss，白等 600 ms 再走视觉 |
| R7 | **无障碍配置漏信号** | `res/xml/lumi_a11y.xml`：未订阅 `typeWindowsChanged`；未加 `flagIncludeNotImportantViews`；`notificationTimeout=100` | 弹窗 / 浮层出现收不到窗口变化；自绘视图被标为"对无障碍不重要"时整块不在树里；同类事件被 100 ms 节流（官方定义：同类事件最近一次之后过了这么久才通知服务 [R-ASI]） |
| R8 | **AI 生成 / 优化的步骤没有约束** | `flowui.tsx` 优化提示词"页面切换后加合适的 wait 或 sleep"；`custom.ts` 第 4 条"等页面加载用 wait"；`validateFlow` 不检查 wait 的 sel | 出现「等待「」出现」这种空步骤，运行时才报"等待步缺少要等的文字" |
| R9 | **录制只记动作，不记状态** | `onEvent()` 第 516–559 行 | 回放时不知道"应该在哪个页面"、"点完应该出现什么"，也就无法自动插 expect、无法自愈 |
| R10 | **弹窗 / 广告 / 权限只能靠用户手写 if** | 无全局中断处理 | 每个 Flow 都要自己处理开屏广告、升级弹窗 |

### 1.3 为什么不是"换个更强的模型"就能解决

Mobile-Agent-v2 专门加了一个反思智能体：每次操作后比较操作前后的屏幕，把结果分成"正确 / 错误（进了无关页面）/ 无效（页面没变）"三类，错误时回退、无效时保持，且错误和无效操作都不进历史；论文报告多智能体架构比单智能体提升 30% 以上任务完成率 [R-MAv2]。AutoGLM、UI-TARS 这类端到端模型能跑通是因为它们**每一步都重新看屏幕**（Open-AutoGLM 的执行器在每个动作后固定等 1.0 s 再截图 [R-AutoGLM-code]）。确定性回放省掉了"每步看屏幕"，就必须把"看一眼确认"换成便宜的原生检查——这正是本方案的核心。

---

## 2. 新的步骤数据模型（Flow schema v2）

### 2.1 设计原则

1. **一步 = 前置条件 + 动作 + 目标定位 + 后置条件 + 失败策略**。
2. 定位信息是**多属性证据**而不是单个选择器（借鉴 Similo：同时用多个定位参数、加权相似度打分，在 48 个网站新旧版本上，失败率 11% 对比基线 27%，平均定位 4 ms [R-Similo]）。
3. 学到的东西（缓存）与用户写的东西分开存，可按应用版本失效。
4. 向后兼容：v1 的 `sel / x / y` 自动迁移到 `target`；没有 `expect` 的旧步骤用"隐式后置条件"（第 3.4 节）。

### 2.2 TypeScript 类型（`src/flowcore.ts` 新增）

```ts
/** 一个控件的多属性证据。录制时尽量全记，回放时按权重打分。 */
export interface Target {
  id?: string            // 完整 resource-id；被判为混淆/易变时 idStable=false
  idStable?: boolean
  text?: string          // 自身文字（<40 字）
  desc?: string          // contentDescription
  hint?: string          // 输入框 hint（API 26+ getHintText）
  cls?: string           // 短类名
  role?: 'button' | 'input' | 'list_item' | 'tab' | 'icon' | 'text' | 'other'
  flags?: { click?: boolean; edit?: boolean; scroll?: boolean; check?: boolean }
  path?: { cls: string; id?: string; idx: number }[]  // 祖先链，自下而上最多 4 层，idx = indexInParent
  near?: string[]        // 邻近文字：同父兄弟 + 外接框 1.5 倍范围内的短文字，最多 4 个
  list?: { container?: string; index: number; of?: number }  // 在可滚动容器中的第几项（可见项序号）
  box: { x: number; y: number; w: number; h: number }        // 0–1 比例，中心点 + 宽高
  ocr?: string           // 录制时对控件截图做 OCR 得到的文字（自绘控件常常树里无字、图上有字）
  thumb?: string         // 控件裁剪图的 64 位 dHash（十六进制），用于图标比对
  img?: string           // 控件裁剪图文件名（存 App 私有目录，不进 localStorage）
}

/** 屏幕指纹：判断"是不是那个页面"。 */
export interface ScreenFp {
  pkg: string
  act?: string           // 最近一次 TYPE_WINDOW_STATE_CHANGED 的 className（Activity / Dialog 类名）
  win?: string           // 顶层窗口类型：app | dialog | popup | ime | system
  anchors: string[]      // 关键节点签名（最多 6 个）：`cls|id|text`，优先取有稳定 id 或短文字、且不在列表项里的节点
  struct?: string        // 去内容的结构签名（见 3.3）
  shot?: string          // 整屏缩略图文件名（360 px 长边，JPEG q50）
}

export interface Expect {
  screen?: ScreenFp | string    // 期望到达的页面（指纹或页面库里的 id）
  appear?: Partial<Target>[]    // 必须出现（任一 / 全部见 mode）
  gone?: Partial<Target>[]      // 必须消失
  focusEdit?: boolean           // 有可编辑控件获得焦点（进入搜索页的强证据）
  mode?: 'any' | 'all'
  timeout?: number              // 默认见 3.5
}

export interface Policy {
  retries?: number              // 动作重试次数，默认 1（加首次共 2 次）
  ladder?: ('relocate' | 'scroll' | 'back' | 'interrupt' | 'ocr' | 'vision' | 'agent')[]
  coord?: 'never' | 'samescreen' | 'always'   // 坐标兜底条件，默认 samescreen
  optional?: boolean
  onFail?: 'stop' | 'skip' | 'ask'
}

/** v2 动作步（控制步不变）。 */
export interface FlowStepV2 extends FlowStep {
  v?: 2
  target?: Target
  pre?: ScreenFp | string
  expect?: Expect
  policy?: Policy
  intent?: string               // 这一步想干什么（人话，自愈 / AI 接手时用）："打开搜索页"
  resolved?: Resolved           // 运行中学到的缓存，见第 4 节
}

export interface Resolved {
  appVer: number                // 学到它时应用的 versionCode
  via: 'native' | 'fuzzy' | 'ocr' | 'vision' | 'user'
  target: Partial<Target>       // 学到的定位证据
  ok: number; miss: number      // 连续成功 / 失败计数
  at: number
}
```

### 2.3 JSON 示例

**A. 录制得到的"点首页搜索框"（小红书）**

```json
{
  "v": 2, "kind": "tap", "intent": "打开搜索页",
  "pre": { "pkg": "com.xingin.xhs", "act": "com.xingin.xhs.index.v2.IndexActivityV2",
           "anchors": ["TextView||发现", "TextView||关注", "ImageView||(desc)搜索"] },
  "target": {
    "id": "com.xingin.xhs:id/0_resource_name_obfuscated", "idStable": false,
    "desc": "搜索", "cls": "ImageView", "role": "icon", "flags": { "click": true },
    "path": [ { "cls": "FrameLayout", "idx": 3 }, { "cls": "LinearLayout", "idx": 0 } ],
    "near": ["发现", "关注"],
    "box": { "x": 0.918, "y": 0.071, "w": 0.083, "h": 0.040 },
    "thumb": "c3e1f0f0d8988c0e"
  },
  "expect": { "focusEdit": true,
              "appear": [ { "cls": "EditText", "role": "input" }, { "text": "搜索" } ],
              "mode": "any", "timeout": 4000 },
  "policy": { "retries": 1, "coord": "samescreen", "ladder": ["relocate", "interrupt", "ocr", "vision"] }
}
```

> 上例里的 id、Activity 名、锚点文字都是**示意**，需真机录制得到。"小红书大量 resource-id 被混淆成同一个名字"在 Auto.js 社区很常见，但本文没有找到可引用的一手来源，P0 需要真机抓一次布局确认（见 10.2）。

**B. 输入关键词（参数化）**

```json
{
  "v": 2, "kind": "input", "text": "{关键词}", "intent": "在搜索框输入关键词",
  "pre": "xhs.search",
  "target": { "cls": "EditText", "role": "input", "hint": "搜索", "flags": { "edit": true },
              "box": { "x": 0.46, "y": 0.071, "w": 0.70, "h": 0.04 } },
  "expect": { "appear": [ { "text": "{关键词}", "role": "input" } ], "timeout": 1500 },
  "policy": { "coord": "never" }
}
```

**C. 列表第一项（动态内容，不能记标题文字）**

```json
{
  "v": 2, "kind": "tap", "intent": "打开搜索结果里的第一篇笔记",
  "pre": "xhs.search_result",
  "target": { "role": "list_item", "cls": "FrameLayout",
              "list": { "container": "RecyclerView", "index": 0 },
              "box": { "x": 0.25, "y": 0.42, "w": 0.48, "h": 0.33 } },
  "expect": { "gone": [ { "role": "input" } ], "appear": [ { "desc": "点赞" }, { "text": "说点什么" } ],
              "mode": "any", "timeout": 5000 },
  "policy": { "ladder": ["relocate", "scroll", "vision"] }
}
```

**D. 页面库（每个 Flow 一份，录制时自动生成，步骤用 id 引用）**

```json
"screens": {
  "xhs.home":          { "pkg": "com.xingin.xhs", "act": "...IndexActivityV2", "anchors": ["TextView||发现", "TextView||首页", "TextView||我"] },
  "xhs.search":        { "pkg": "com.xingin.xhs", "anchors": ["EditText||", "TextView||搜索", "TextView||历史记录"] },
  "xhs.search_result": { "pkg": "com.xingin.xhs", "anchors": ["TextView||综合", "TextView||最新", "TextView||筛选"] }
}
```

### 2.4 v1 → v2 迁移（`flowcore.ts` 新增 `migrateV1`）

- `sel{id,text,desc,cls}` → `target{...}`；`x,y` → `target.box{x,y,w:0,h:0}`。
- `tap.vision:true` → `policy.ladder` 末尾加 `vision`；`ai{goal}` 保留为 kind `ai`，`goal` 复制到 `intent`。
- `wait` 且 sel 为空 → 迁移时删掉，换成上一步的 `expect`（若能推断）或提示用户。
- 没有 `pre / expect` 的步骤：运行时用隐式后置条件（3.4），并在运行明细里把这一步标"未加确认点"，编辑器提供一键"从这次运行补上"。

---

## 3. 屏幕稳定 + 期望页面校验（替换固定 sleep）

### 3.1 外部做法与可用数字

| 来源 | 做法 | 数字 |
|---|---|---|
| UiAutomator（androidx `QueryController`） | 每次查找前 `UiAutomation.waitForIdle(quiet, timeout)`：事件流在 quiet 时间内没有新事件即视为空闲 | quiet = **500 ms**（`QUIET_TIME_TO_BE_CONSIDERED_IDLE_STATE`），总超时默认 **10 s** [R-UiAutoSrc][R-UiAutomation] |
| Appium UiAutomator2 | 同上，可配置；点击后等"内容变化事件"作回执 | `waitForIdleTimeout` 10000、`waitForSelectorTimeout` 10000、`actionAcknowledgmentTimeout` 3000 ms [R-Appium] |
| Maestro（源码） | 点击后若界面无变化（截图像素差 <0.5%）重试；settle 时连续两次层级树相同才算稳定 | 元素查找 17 s / 可选 7 s；无变化重试 2 次；settle 每 200 ms 取一次树、最多 10 次（≤2 s）[R-MaestroSrc][R-MaestroDocs] |
| AndroidWorld | 连续 3 次 UI 元素列表相同才算稳定 | 每次间隔 0.5 s，超时 6 s；M3A 智能体动作后默认等 2.0 s [R-AWcode] |
| Open-AutoGLM | 每个动作后固定 sleep | 默认 1.0 s；输入相关各 1.0 s [R-AutoGLM-code] |

这些方案的共同点是"**无事件一段时间 + 树结构不再变**"。它们都偏保守（500 ms–2 s），因为面向测试；我们的目标是百毫秒级，所以用**事件驱动唤醒 + 更短的安静窗 + 以期望条件提前结束**。

### 3.2 事件采集（`LumiA11yService` 新增 `UiClock`）

- 订阅：`typeWindowStateChanged | typeWindowContentChanged | typeWindowsChanged | typeViewScrolled | typeViewClicked | typeViewLongClicked | typeViewTextChanged | typeViewFocused`。
- `notificationTimeout` 100 → **50 ms**（只节流同类事件；待测：事件量与 CPU 占用）。
- flags 增加 `flagIncludeNotImportantViews`（官方：让服务也拿到"对无障碍不重要"的视图 [R-ASI]，对自绘 / 列表项很关键）。
- `UiClock` 记录：`lastAnyAt`、`lastStateAt`、`lastWindowsAt`、按类型计数器、`stateClass`（最近 WINDOW_STATE_CHANGED 的 className 与包名）、`contentChangeTypes`（区分 `SUBTREE / TEXT / PANE_APPEARED` 等 [R-AE]）。
- 过滤噪音：忽略本应用包、`com.android.systemui`、输入法窗口；**周期性噪音源识别**：同一 source（viewId + cls）在 1 s 内触发 ≥5 次、且间隔方差小（轮播 Banner、Lottie、视频进度）→ 记入 `noisy` 集合，安静判断时排除（推断：小红书 / 抖音首页的视频和轮播会持续发 content changed，不排除则永远不"安静"）。
- 运行器线程通过 `Object.wait/notify`（或 `LockSupport`）被事件唤醒，替代 80 ms 固定轮询。

### 3.3 树快照与签名（低成本）

- **只取目标窗口**：从 `getWindows()` 里挑 `TYPE_APPLICATION` 且 `root.packageName == 目标包` 的、层级最高的窗口；有 `TYPE_SYSTEM` / 同包 dialog 浮层时作为"中断候选"另行处理。避免 R3。
- **快速结构签名**（参考 DroidBot：状态串 = 前台 Activity + 排序后的视图签名集合，内容无关版本只用 class + resource-id，再 MD5 [R-DroidBot]）：
  - `structSig` = hash(act + sorted{cls|id}，只取可见、深度 ≤ 25、最多 400 个节点)；
  - `textSig` = 可见短文字集合（≤20 字、去数字）的 SimHash。
- API 33+ 用 `getChild(i, FLAG_PREFETCH_DESCENDANTS_HYBRID)` 批量预取（每批最多 50 个节点 [R-ANI]），减少逐个 `getChild` 的 IPC；按 id / 文字查找优先用 `findAccessibilityNodeInfosByViewId / ByText`（系统侧查找，ByText 是不区分大小写的包含匹配 [R-ANI]），再在结果里精排。

### 3.4 算法：`act → ack → settle → verify`

```
runStep(step):
  0. pre-check: fpNow = snapshot(); if step.pre && !match(fpNow, step.pre): → handleMismatch()   // 第 6、7 节
  1. node = locate(step.target)                           // 第 4 节，含 refresh() 校验仍在树上、在屏幕内
  2. t0 = now; dispatch(action)
  3. ack: 等到 [t0, t0+ACK] 内出现任一"相关事件"（同包的 STATE/WINDOWS/CONTENT(SUBTREE)/SCROLLED/FOCUSED）
         无事件 → noReaction=true（"点了没反应"）
  4. settle: 直到 quiet(Q) 且 两次快照 structSig 相同（间隔 ≥ Q/2）；或到 MAX_SETTLE
         期间每次被事件唤醒都先试 verify，满足即提前结束（不必等满安静窗）
  5. verify:
       if step.expect: 轮询 expect 直到满足或 EXPECT_TIMEOUT
       else (隐式后置条件 look-ahead): 下一步是动作步 → 能否在 LOOKAHEAD_TIMEOUT 内定位到 next.target / next.pre
                                     下一步是控制步 → 只做 settle
  6. 结果：
       verify 通过 → 成功（记录 ms、src）
       noReaction 且 verify 失败 → retry 动作（policy.retries，默认再 1 次；第二次换手势点击节点中心）
       有反应但 verify 失败 → handleMismatch()（中断规则 → 自愈阶梯）
```

**默认阈值（快速模式 / 普通模式；全部待真机标定）**

| 参数 | 快速 | 普通 | 说明 |
|---|---|---|---|
| ACK（点击 / 输入） | 600 ms | 1000 ms | UiAutomator 的点击回执超时是 3 s，我们取短值，超时只判"无反应"而不直接失败 |
| ACK（launch） | 1500 ms | 3000 ms | |
| Q 安静窗 | 250 ms | 400 ms | UiAutomator 用 500 ms；有期望条件时常常提前结束 |
| MAX_SETTLE | 3000 ms | 5000 ms | 普通页面切换 |
| MAX_SETTLE（launch 冷启动） | 8000 ms | 12000 ms | 开屏广告 3–5 s 常见（推断） |
| EXPECT_TIMEOUT | 4000 ms | 8000 ms | 可在步上覆盖；Maestro 断言默认等 7 s 作参照 |
| LOOKAHEAD_TIMEOUT | 2500 ms | 5000 ms | |
| 轮询下限 | 50 ms | 100 ms | 由事件唤醒，没有事件时按下限兜底 |

**launch 的特殊处理**：`startActivity` 后不再"包名一变就返回"，而是：等包名变化 → 等 settle → 跑中断规则（开屏"跳过"、升级、权限）→ 校验 `expect.screen`（录制时 launch 之后第一个稳定页面）→ 不符则再等 / 再跑中断，直到 MAX_SETTLE。`fresh:true` 时用 `CLEAR_TASK`。可选（有 ADB 时）：`am start -W` 拿到 `TotalTime` 作为"启动完成"的强信号；`dumpsys activity activities` 取 `mResumedActivity` 校验 Activity（ADB 只作增强，不是依赖）。

**预期收益**：失败 A 的第 2、3 步会在各自的 verify 阶段就报"没有进入搜索页"，并触发重试 / 自愈；第 4 步的视觉只会在真正的搜索结果页上调用。

### 3.5 关于"快"的承诺

- 稳定页面上的原生步：定位 20–80 ms（结构扫描）+ ack 首个事件（通常几十 ms）+ 期望命中即结束 → **目标 p50 ≤ 400 ms、p95 ≤ 900 ms，不含页面加载**（待测）。
- 页面跳转步的耗时 = 应用自己的加载时间 + ≤ Q；这部分不算"慢"，运行明细里拆成"动作 / 等页面"两段显示，避免用户误解。

---

## 4. 分层定位：原生 → 模糊打分 → OCR → VLM，及缓存

### 4.1 层级与预算

| 层 | 输入 | 典型耗时（待测） | 何时用 |
|---|---|---|---|
| T0 精确 | `resolved.target` 或 `target` 的稳定 id + 文字/desc 精确匹配，唯一命中 | 10–50 ms | 默认 |
| T1 模糊打分 | 全部证据加权打分（4.2） | 30–120 ms（与 T0 共享一次快照） | T0 无唯一命中 |
| T2 OCR / 图标比对 | 截图 + 端侧 OCR；`thumb` dHash 滑窗比对 | 截图 + 识别，预计数百 ms | 目标有 text/ocr/thumb 但树里找不到（自绘、WebView、Canvas） |
| T3 VLM | 稳定后的截图 + 精简元素列表 + 意图 + 录制时的目标裁剪图 | ~2.3 s / 次，有成本 | 上面都失败，或分数落在灰区且后置条件验证失败 |

规则：**任何层的命中都要经过 3.4 的 verify 才算数**；只有 verify 通过才写回缓存。

### 4.2 T1 打分（Similo 思路的移动端版本）

Similo 对每个候选元素逐属性比较，按权重相加，属性分两组（稳定性高的 1.5、其余 0.5）[R-Similo]；VON Similo 再用 LLM 在前几名里挑，把 804 对元素中定位失败从 70 降到 40 [R-VONLLM]。我们用相同骨架，权重按移动端改：

| 属性 | 比较 | 权重（初值） |
|---|---|---|
| id（`idStable`=true） | 相等 1，否则 0 | 1.5 |
| id（易变 / 混淆） | 不计 | 0 |
| text | 相等 1；归一化后相等（去空格、全半角、去数字）0.8；包含 0.4 | 1.5 |
| desc | 同 text | 1.5 |
| hint | 同 text | 1.0 |
| near（邻近文字） | 交集 / 并集（Jaccard） | 1.5 |
| path | 自下而上逐层比较 cls、id、idx，命中层数 / 总层数 | 1.0 |
| role + flags | 一致 1 | 0.5 |
| list.index | 同容器、同序号 1；差 1 → 0.5 | 1.0（仅 role=list_item） |
| box | 中心距离的高斯核 `exp(-d²/2σ²)`，σ = 0.08（屏幕比例） | 0.5 |
| 尺寸 | 宽高比与面积比都在 ±30% 内 1 | 0.5 |

- 归一化得分 `s = Σw·sim / Σw(该目标上存在的属性)`。
- **接受**：`s ≥ 0.75` 且领先第二名 ≥ 0.10；**灰区**：0.55–0.75 或领先不足 → 先动作、靠 verify 把关，verify 失败则直接升到 T2/T3（不在灰区里反复试）；**拒绝**：< 0.55。
- **易变 id 识别**：id 名含 `obfuscated`、长度 ≤ 2 的短名、纯数字 / 十六进制、或同一快照里 ≥3 个不同控件共用 → `idStable=false`（录制时判定，回放时也可动态降级）。
- 权重后续可用积累的运行记录离线调（Ranking 研究里用学习排序替代静态权重有收益 [R-SimiloRank]），P2 再做。

### 4.3 T2 端侧 OCR 与图标

- **选型**：ML Kit Text Recognition v2 支持中文，按文字体系分模型；有"打包进 APK（bundled）"与"由 Play 服务下载（unbundled）"两种 [R-MLKit][R-MLKitPaths]。国内大量机型没有 GMS，unbundled 不可靠，**只考虑 bundled**；第三方整理的体积数据是 Android 每种文字体系每个架构约 4 MB [R-TextDet]（待我们自己构建验证）。备选 PP-OCR（PaddleOCR 的移动端 tiny/small 模型 + ONNX Runtime / Paddle Lite），同一份整理给出 tiny 检测 + 识别约 6.4 MB 加运行时 [R-TextDet]；PaddleOCR 官方 README 显示最新 PP-OCRv6 有 tiny 1.5M / small 7.7M 参数三档 [R-Paddle]。**P1 先接 ML Kit bundled（中文），PP-OCR 作为对照基准**。
- **用法**：只识别候选区域（`target.box` 周围 2 倍范围 + 全屏低分辨率一遍），用文字（`text / desc / ocr / near`）在 OCR 结果里找框，框中心作为点击点；同时要求点击点所在的树节点（`findNodeAt`）可点击或其祖先可点击，否则用手势点。
- **图标**：`thumb` 是录制时控件裁剪图的 64 位 dHash；回放时在 `box` 附近 ±15% 范围以 4 px 步长滑窗，汉明距离 ≤ 10 视为命中（推断阈值，P1 标定）。主要解决"只有图标没文字"的按钮（返回、搜索、更多）。
- **截图限制**：`takeScreenshot` 需要 Android 11（API 30）+，并且有调用频率限制（太快会返回 `ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT` [R-AS]；AOSP 内部间隔约 1/3 s，未在公开文档中写明，待核实）。我们 minSdk 是 24，所以 API < 30 时 T2/T3 只能用元素列表（现状一致）；有 ADB 时可用 `screencap` 兜底。

### 4.4 T3 VLM（改造现有 `vision.ts` / `visionAct`）

1. **稳定后再截图**：删除 180 ms 预取；改为在上一步 verify 通过后、本步需要视觉时才截图（verify 通过意味着已稳定）。可选优化：上一步 verify 通过后若下一步 `resolved` 为空且需要视觉，立刻异步截图 + 发请求（"预测性视觉"），此时画面已稳定，不会再拍到过渡帧。
2. **元素列表**：从目标窗口而非 `getRootInActiveWindow()` 取；上限 60 → 150；先列可点击 / 可编辑节点，再列有文字节点；列表项合并成"第 i 项：文字摘要"（参考 AutoDroid 剪枝不可见元素、合并功能等价元素以减少 token [R-AutoDroid]）。
3. **Set-of-Mark**：在截图上画编号框（与元素列表编号一致）再发给模型，模型回编号比回坐标稳（OmniParser 的出发点就是"把截图解析成可交互区域 + 语义，再让模型选" [R-OmniParser]）。截图长边仍 720 px、JPEG q60。
4. **给模型更多上下文**：`intent`、录制时该步的前后缩略图与目标裁剪图（"要找的是长这样的东西"）、期望（"点完应该进入搜索页"）。
5. **回答格式**扩展：`{"i":n}` / `{"x","y"}` / `{"none":true,"why":"page"|"popup"|"login"|"absent"}`，`why` 用于第 6、7 节分流。
6. **写回**：只有 verify 通过才写；写回的是**多属性 target**（4.5），不写列表项里的动态文字。

### 4.5 缓存（`resolved`）与失效

- **键**：Flow 内步骤（`_fid` + `_i`）× 应用 `versionCode`（`PackageManager.getPackageInfo(pkg,0).getLongVersionCode()`，API 28+；低版本用 `versionCode`）。
- **写入条件**：步骤 verify 通过。来源 `via` 记录哪一层找到的。对视觉 / OCR 找到的节点，写入它的完整 `Target`（id 是否稳定、near、path、list、box、thumb），而不是只写 `selOf` 的三个字段。
- **不写入**：带 `{参数}` / `${变量}` 的步骤（沿用 `hasParam / hasDynamic`）；回退 / 自愈过程中执行的中间动作（借鉴 Midscene：缓存的计划执行失败后走 AI 回退时，**不把回退生成的流程写回原缓存**，因为前面的步骤可能已改变页面状态，回退计划只描述了剩余部分 [R-Midscene]）；`role=list_item` 的 `text`。
- **失效**：
  - `versionCode` 变化 → 所有 `resolved` 标"待复核"：照常先用，但验证失败时不重试同一缓存、直接下沉一层；首次复核通过后更新 `appVer`。
  - 连续 2 次 miss → 删除该 `resolved`。
  - 用户编辑这一步 → 清空 `resolved`。
- **存储**：`resolved` 与截图文件不再塞进 `localStorage`（现在 Flow 全量 JSON 存 `lumi.flows`，加缩略图会爆配额）：Flow JSON 仍在 localStorage / 手机文件夹，二进制放 App 私有目录 `files/flow/<flowId>/`，用文件名引用。

---

## 5. 录制升级

### 5.1 每一步记录什么

| 字段 | 来源 | 用途 |
|---|---|---|
| `pre` 屏幕指纹 | 动作事件到达时，使用**事件前**最近一次稳定快照（录制时后台每次 settle 后缓存一份） | 回放前置条件 |
| `target` 全属性 | `event.getSource()` + 祖先 4 层 + 兄弟 / 邻近文字 + 列表位置 | 分层定位 |
| 目标子树 | source 节点向下 2 层的精简 JSON | 自愈与 AI 解释 |
| `post` 屏幕指纹 | 动作后按 3.4 的 settle 得到的快照 | 自动生成 `expect`，也是下一步的 `pre` |
| 截图 | 动作前整屏缩略图（360 px，q50）+ 目标裁剪图（96 px）；API 30+ | 失败报告、视觉上下文、dHash |
| 时间 | 与上一步间隔、页面加载耗时 | 回放超时的初值（取录制耗时 × 3，夹在默认值之间） |

截图节流：录制期间每步最多 1 张整屏 + 1 张裁剪，受系统截图频率限制，拍不到就跳过（不影响步骤本身）。

### 5.2 没有点击事件的点击

自绘控件、Flutter、部分 WebView 点击时不发 `TYPE_VIEW_CLICKED`（推断，常见于中文应用的自绘列表 / 游戏化页面）。无 root 时无障碍服务拿不到原始触摸（`TYPE_TOUCH_INTERACTION_*` 只在触摸浏览模式下有）。对策：

- 监测"**无动作事件却发生了页面变化**"（`WINDOW_STATE_CHANGED` 或结构签名大变）→ 插入一个**待补全步**：`{kind:"ai", intent:"(未识别的点击)", pre, expect:post}`，附前后截图。
- 录制结束时（或用户点"整理"）把这些待补全步连同前后截图交给 VLM，一次性推断"用户点了什么"，生成 `target`（box + ocr + thumb + 意图）。这是"从演示中学习"的做法：AppAgent 支持从人工演示生成知识库再用于执行 [R-AppAgent]。

### 5.3 自动去重与整理（`tidy` 升级）

1. 连续同向滚动合并（已有），并记录滚动容器与次数。
2. **无效点击剔除**：post 与 pre 结构签名相同、且无 ack 事件 → 删除（录制时用户误触）。
3. **中断步剥离**：命中全局中断规则（第 6 节）的点击（"跳过"、"我知道了"、"以后再说"）→ 不作为步骤，改为确保运行时中断规则开启；若规则库里没有，提示"把它加入这个应用的弹窗规则？"。
4. 点击输入框 + 输入 → 合并为一步 `input`（现在的 `isEditable` 跳过逻辑保留）。
5. 输入后紧跟回车 / 点"搜索" → 保留，但 `expect` 指向结果页。
6. 返回键连按 → 合并，并在 `expect` 里写目标页面。

### 5.4 自动插入 expect

- 对每个动作步：`expect.screen = post`；`appear` = post 中新增、且在 pre 中不存在的锚点（取最多 3 个最稳定的）；`gone` = pre 中有、post 中消失的锚点（取 1 个）；进入搜索页时 `focusEdit = true`。
- 如果 post 与 pre 是同一页面（比如勾选、点赞），`expect` 写成控件状态变化（`checked` / `selected` / 文字变化），否则不写（只用 ack）。
- 页面库：按 `act + anchors` 聚类，同一页面合并为一个 id（`xhs.home`），步骤用 id 引用，编辑器里可以给页面起人话名字。

---

## 6. 中断处理：弹窗 / 广告 / 权限 / 登录 / 升级

### 6.1 全局规则集（随 App 发布 + 用户可学习新增）

```json
{
  "id": "splash-skip", "pkgs": ["*"], "win": ["app"],
  "when": { "textRe": "^(跳过|跳过广告|\\d+\\s*s?\\s*跳过|跳过\\s*\\d+)$", "maxY": 0.25 },
  "do": { "tap": "match" }, "prio": 90
}
{
  "id": "update-later", "pkgs": ["*"], "win": ["dialog", "app"],
  "when": { "allTextRe": ["(新版本|版本更新|发现新版本|立即更新|立即升级)"], "anyTarget": "(以后再说|暂不更新|稍后|下次再说|取消|关闭)" },
  "do": { "tap": "anyTarget" }, "prio": 80
}
{
  "id": "sys-permission", "pkgs": ["com.android.permissioncontroller", "com.google.android.permissioncontroller", "com.lbe.security.miui", "com.coloros.securitypermission"],
  "when": { "anyTarget": "(仅在使用中允许|仅使用期间允许|本次运行允许|允许)" },
  "do": { "ask": true, "default": "仅在使用中允许" }, "prio": 70
}
{
  "id": "login-wall", "pkgs": ["*"],
  "when": { "anyTextRe": "(登录|手机号登录|一键登录|验证码)", "editable": true },
  "do": { "handover": "需要你登录一下，登录好后点「继续」" }, "prio": 100
}
{
  "id": "danger", "pkgs": ["*"],
  "when": { "anyTextRe": "(支付|付款|确认订单|立即购买|删除|解绑)" },
  "do": { "never": true }
}
```

（权限弹窗的包名因厂商而异，上面几个只是示例，P0 需要在 3–4 台主流国产机上核对。）

### 6.2 何时检查

1. **前置条件不符**时（3.4 第 0 步）——最主要的入口。
2. **settle 期间出现新窗口**（`TYPE_WINDOWS_CHANGED` 的 `WINDOWS_CHANGE_ADDED` [R-AE]），且新窗口是 dialog / 同包浮层 / 系统窗口。
3. **launch 之后**固定跑一遍（开屏广告、升级、隐私协议）。
4. verify 失败、模型返回 `why:"popup"` 时。

规则只执行一次 / 每条每步最多 2 次；执行后重新 settle 并重新校验前置条件。`never` 规则命中时禁止任何自动点击（包括坐标兜底与 VLM 返回的点击），转为向用户确认（复用现有 `confirm` 悬浮条）。

### 6.3 AI 兜底

规则都不命中、前置条件仍不符时，调一次 VLM 做**页面分类**而不是直接点：`{state: expected | popup | other_page | login | captcha | error, dismiss?: 元素编号, back?: true}`。

- `popup` → 点 `dismiss`，成功后**提议**把它学成新规则（文字模式 + 包名 + 按钮），用户确认后写入"这个应用的弹窗规则"。
- `other_page` → 交给第 7 节自愈。
- `login / captcha` → 暂停，悬浮条提示人工接管（Open-AutoGLM 也内置"登录 / 验证码场景人工接管"与敏感操作确认 [R-AutoGLM]）。

---

## 7. 自愈：失败后的处理阶梯

```
L0 重做本步动作（无反应时）：最多 1 次；第二次改用手势点击节点中心（Maestro：无变化重试 2 次 [R-MaestroSrc]）
L1 重新定位：重新 settle → T0/T1（扩大候选：滚动容器内上下各滚 1 屏找，SARA 的自适应回放也会"自动滑动可滚动控件去找控件、按屏幕参数变换坐标" [R-SARA]）
L2 中断规则 → 回到 pre 页面后重试本步
L3 导航恢复：当前页面属于本 Flow 页面库中更早的页面 → 从那一步重放（检查点）；属于未知页面 → back 最多 2 次后重判；仍不行 → fresh 重启应用，从 launch 后的第一个检查点重放（仅限该 Flow 没有 confirm 步已执行，避免重复下单）
L4 T2 OCR / 图标
L5 VLM 接管（目标导向的小循环）：
      输入：Flow 名称与描述、本步 intent、本步 expect（人话 + 期望截图）、最近 3 步的 intent、当前截图 + 元素列表
      输出：一个动作；执行 → settle → verify；最多 3 个动作、最多 3 次模型调用
      成功 → 生成"修复补丁"
L6 失败 → 失败报告（第 9 节），把当前截图与已尝试的手段一起给用户
```

**预算**：单次运行视觉调用上限默认 6 次，单步 3 次，超出直接进 L6（用户可在设置里调）。每一层都写进 `trace`，便于统计"哪层救回来的"。

**修复补丁与确认**

- 补丁类型：`replaceTarget`（换定位证据）、`insertBefore`（在本步前插入 1–2 步，如"先点关闭"）、`addInterruptRule`、`relaxExpect`（期望太严）。
- 写回需要**用户确认**：运行结束卡片上列出"AI 修好了第 3 步：原来点『搜索』图标，现在改为点顶部搜索框（附前后截图）"，按钮「保留修复」「不要」。默认不勾选自动保留；用户可在 Flow 设置里打开"自动保留 AI 修复（仍然记录可撤销）"。
- 补丁应用后该步 `resolved` 清空并以补丁结果为新缓存；保留上一个版本，编辑器"历史"可一键回滚（复用 v0.20 的撤销机制思路）。
- 这与 Mobile-Agent-E 的"Tips / Shortcuts 长期记忆"、AppAgentX 的"从执行历史中进化出高层动作（shortcut）"同一思路：把一次成功的推理固化成下次可直接执行的步骤 [R-MAE][R-AppAgentX]。

---

## 8. 目标级模式（agent mode）与确定性回放怎么分工

### 8.1 新步骤 `goal`

```json
{ "kind": "goal", "intent": "在搜索结果里找到价格最低的那家店并打开",
  "until": { "appear": [ { "text": "店铺详情" } ] },
  "maxSteps": 8, "visionBudget": 8, "model": "agent" }
```

运行时：每一轮截图（稳定后）+ 元素列表 → 模型给一个动作 → 执行 → settle → 检查 `until`；最多 `maxSteps` 轮。这就是 AutoGLM / UI-TARS / Mobile-Agent 的闭环，只是被关在一个步骤里，前后仍是确定性步骤。

### 8.2 什么时候用哪种

| 用确定性回放 | 用目标级模式 |
|---|---|
| 固定导航：打开应用 → 搜索 → 输入 → 回车 | 选择依赖内容判断：最便宜、评分最高、"最新一条未读" |
| 页面结构稳定、能录到 | 页面是 WebView / Canvas / 游戏化活动页，树里几乎没东西 |
| 要快（每步百毫秒） | 次数少、能接受几秒一步 |
| 有副作用的步骤（发送、下单）——必须确定性 + confirm | 探索性 / 一次性任务 |

**默认策略**：用户"按任务生成 Flow"时，导航部分生成确定性步骤（首跑用视觉学会），判断部分生成 `goal` 步；`goal` 步成功后，若轨迹固定（两次运行动作序列相同），提示"把这段固化成普通步骤以后更快？"。

### 8.3 模型选择（建议，需评估成本）

- 现在的 Helium（定位用，关思考、max_tokens 40）继续做 T3 定位与页面分类，快且便宜。
- `goal` 模式需要会"操作手机"的模型：AutoGLM-Phone-9B 针对中文应用优化，开源、可经智谱 BigModel（模型名 `autoglm-phone`）或 ModelScope 调用 [R-AutoGLM]；AutoGLM 论文报告在热门中文应用常见任务上成功率 89.7% [R-AutoGLM-paper]。其它可选：UI-TARS-2（AndroidWorld 73.3）[R-UITARS2]、GUI-Owl / Mobile-Agent-v3（AndroidWorld 73.3，开源）[R-MAv3]。AndroidWorld 首发时最好的基线只有 30.6% [R-AW]，说明这类数字增长快但仍不保证——**`goal` 模式永远不承诺"每次都成功"**。
- 接入方式：网关新增一个 `phone-agent` 模型别名，客户端只认动作 JSON（Launch / Tap / Type / Swipe / Back / Wait / Take_over，与 Open-AutoGLM 的动作集对齐 [R-AutoGLM]），坐标统一用 0–1000 归一化（Open-AutoGLM 的做法 [R-AutoGLM-code]）。

---

## 9. 编辑器与体验（给非技术用户）

### 9.1 失败报告卡（替换"卡在第 N 步：原因"一行字）

```
┌─────────────────────────────────────────┐
│ 第 3 步没完成：应该进入「搜索页」，但还停在首页 │
│ [录制时：点完后的样子]   [这次：现在的样子]     │  ← 两张缩略图并排，目标框用珊瑚色圈出
│ 我试过：重点 1 次 · 关掉 1 个弹窗 · AI 找了 1 次 │
│ [让 AI 修好]  [我来示范这一步]  [跳过这步]  [设为可选] │
└─────────────────────────────────────────┘
```

- 原因分 6 类、用人话：**没找到按钮 / 点了没反应 / 页面不对 / 被弹窗挡住 / 需要你登录 / 网络太慢**。对应 3.4 和第 7 节的分类结果，不显示"AI 视觉出错：xxx"这类技术串。
- 「让 AI 修好」= 从当前页面起跑第 7 节 L5，结果以补丁卡确认。
- 「我来示范这一步」= 复用 v0.22「继续录制」：从失败步开始录，录到的步骤**替换**失败步（而不是追加），并带上新的 pre / expect。

### 9.2 步骤卡上的"稳不稳"

- 每步一个小圆点：绿（稳定 id / 文字 / 已多次验证）、黄（模糊匹配 / OCR / 视觉学到的）、红（只有坐标 / 没有确认点）。
- 整个 Flow 一个"稳定度"：绿步比例 + 最近 10 次成功率。
- 红点步上直接给按钮「让 AI 加固」：跑一次，补全 target / expect。
- 坐标步显示为"点屏幕上方中间（录制时这里是『外卖』）"而不是 `(50%,12%)`。

### 9.3 防止"空步骤"

- `validateFlow`：`wait`、`if/while exists` 的 sel 为空 → **错误**（现在只在运行时报）。`tap` 只有 `cls` 没有其它证据 → 警告"这一步只能靠位置点"。
- AI 生成 / 优化的提示词（`custom.ts` 第 4 条、`flowui.tsx optimize`）改为："等页面加载不要写 wait/sleep，写在上一步的 expect 里：`expect:{appear:[{text:'…'}]}`；不知道页面上有什么就不要写 expect"。工具描述（`FLOW_TOOLS.flow_save`）同步更新 schema。
- 保存前对 AI 产出的步骤再跑一次校验，有错误不出确认卡（沿用 v0.20 机制）。

### 9.4 运行中悬浮条

- 显示"第 3/7 步 · 等页面…"/"关掉了一个弹窗"/"AI 正在看屏幕（第 1 次）"，让用户知道慢在哪里。
- 「停止」立即生效（已有）；新增「我来接手」：暂停运行，用户手动操作后点「继续」，运行器重新判断当前页面属于哪一步再接着跑（检查点恢复）。

---

## 10. 测试策略

### 10.1 回放测试台（JVM，无真机）

- 把 `FlowVm.Host` 的真机实现拆成接口 `Screen`（快照 / 事件流 / 动作），新增 `TraceScreen`：从**录制下来的轨迹文件**按时间线重放（每个时间点的树 JSON + 事件 + 动作后的下一个树），可以注入：延迟（页面加载 0.3–5 s）、开屏广告、升级弹窗、id 改名、列表顺序变化、点击无反应。
- 跑在 `scripts/flowvm-test/`（已有 JDK 21 + `run.sh`），覆盖：settle 状态机、look-ahead、打分器、中断规则、自愈阶梯（VLM 用桩）。

### 10.2 黄金轨迹（真机采集）

- App 内新增"导出诊断包"（开发者开关）：每步的树快照（精简 JSON）、事件时间线、截图、trace，打包到手机文件夹 `Flow/diag/<时间>.zip`。
- 第一批基准（P0 验收用）：
  1. 小红书：搜索关键词 → 打开第一篇笔记
  2. 美团：搜索店名 → 进店
  3. 淘宝：搜索商品 → 按销量排序
  4. 微信：给「文件传输助手」发一条消息（Open-AutoGLM 也用它做验收 [R-AutoGLM]）
  5. 抖音：搜索 → 打开第一个视频
- 每个基准录一次、在**冷启动 / 热启动 / 弱网（开发者选项限速）/ 开屏广告**四种条件下各回放 10 次。
- 应用升级后重跑一次，记录缓存失效与自愈情况。

### 10.3 指标（每次运行本地记录，设置页可看）

| 指标 | 定义 | P0 目标 | P1 目标 |
|---|---|---|---|
| 成功率 | 5 个基准 × 4 条件 × 10 次 | ≥ 85% | ≥ 93% |
| 误报成功 | trace 显示成功但 expect 实际不满足 | 0 | 0 |
| 原生步耗时 | 不含页面加载，p50 / p95 | ≤ 500 / 1200 ms | ≤ 400 / 900 ms |
| 视觉调用 / 次运行（第 2 次起） | 缓存生效后 | ≤ 0.5 | ≤ 0.2 |
| 自愈救回率 | 失败步中被 L0–L5 救回的比例 | 统计即可 | ≥ 60% |
| 中断处理 | 开屏 / 升级弹窗被规则处理比例 | ≥ 90% | ≥ 95% |

### 10.4 现有测试要补

- `scripts/flow-test.mts`：v1→v2 迁移、`validateFlow` 新规则、`applyLearned` 只写 verified、不写动态文字。
- e2e（Playwright，模拟 LumiPhone 插件）：失败报告卡、补丁确认卡、稳定度圆点。

---

## 11. 分阶段路线图

估时按一名熟悉本仓库的开发者计（人日），含自测，不含真机采集等待时间。

### P0：先止血（约 9–11 人日）

| # | 事项 | 改动文件 | 估时 | 验收标准 |
|---|---|---|---|---|
| P0-1 | **UiClock + settle 状态机**（3.2、3.4 的 ack / quiet / MAX），替换 `FlowVm` 步后固定 `settle`、launch 的包名等待、input/vision 里的 sleep；无障碍配置加 `typeWindowsChanged`、`flagIncludeNotImportantViews`、`notificationTimeout=50` | `LumiA11yService.java`、`LumiFlow.java`、`FlowVm.java`（`Host.settle` 改为 `awaitSettle(step, t0)`）、`res/xml/lumi_a11y.xml` | 3 | 回放测试台注入 0.3–3 s 页面加载均通过；真机 trace 里每步分"动作 / 等页面"两段 |
| P0-2 | **隐式后置条件 look-ahead** + 显式 `expect` 字段与检查器（appear / gone / focusEdit / screen anchors） | `FlowVm.java`（run 循环里取 next 步）、`LumiFlow.java`（`check(expect)`）、`flowcore.ts`（类型、`label`） | 2 | 失败 A、B 在测试台复现后：报错位置变为真正出错的那一步；"误报成功"= 0 |
| P0-3 | **防陈旧节点**：只在目标包的应用窗口找；点击前 `refresh()` 并确认节点在屏幕内；`text` 包含匹配降为低分；同分时取离录制 `box` 最近者；无回执重试 1 次（第二次手势点） | `LumiFlow.java`（`find/score/clickNode`） | 1.5 | 测试台：旧页面同 id 节点不再被命中 |
| P0-4 | **坐标兜底收紧**：`policy.coord` 默认 `samescreen`（当前快照与 `pre` 或录制时锚点匹配才允许）；`input` 去掉"按录制坐标点一下" | `LumiFlow.java` | 0.5 | 测试台：页面不符时坐标步报"页面不对"而不是乱点 |
| P0-5 | **视觉步修正**：删预取；稳定后截图；元素来自目标窗口、上限 150；`learn` 移到 verify 通过后；`runFlow` 只应用 verified 的 learned；返回 `why` | `LumiFlow.java`、`LumiA11yService.dump`、`vision.ts`、`flow.ts`、`flowcore.ts applyLearned` | 1.5 | 失败的视觉步不产生写回；视觉请求里的截图时间戳晚于上一步 verify |
| P0-6 | **校验与提示词**：空 sel 的 wait / exists 报错；AI 生成 / 优化提示词与 `flow_save` 描述改为用 expect | `flowcore.ts validateFlow`、`custom.ts CUSTOM_PROMPT`、`flowui.tsx optimize`、`flow.ts FLOW_TOOLS` | 0.5 | 单测：「等待「」出现」无法保存 |
| P0-7 | **中断规则 v1**：内置开屏跳过 / 升级稍后 / 系统权限（询问）/ 登录接管 / 危险词禁止；在 launch 后、pre 不符、WINDOWS_CHANGED 新窗口时检查 | 新 `FlowInterrupts.java`（纯 Java，可 JVM 测）、`LumiFlow.java`、规则 JSON 放 `android/app/src/main/assets/flow_rules.json` | 1.5 | 测试台注入开屏 / 升级弹窗通过；危险词按钮永不自动点 |
| P0-8 | **失败报告 v1**：失败时附当前截图（API 30+）+ 原因分类 + 「我来示范这一步」（替换模式的继续录制） | `LumiFlow.java`（失败截图）、`flow.ts RunResult`、`flowui.tsx`、`App.tsx useRecordReturn` | 1.5 | e2e：失败卡显示截图与人话原因；示范后失败步被替换 |
| P0-9 | 真机采集 5 个基准的诊断包、核对权限弹窗包名与小红书 id 混淆情况 | 文档 + `scripts/` | 1（不含等待） | 第 10.3 节 P0 指标出第一版数 |

> P0 不改数据格式的大结构：`expect / policy / intent` 是新增可选字段，旧 Flow 不迁移也能跑（靠 look-ahead）。

### P1：可靠定位与自愈（约 15–18 人日）

| # | 事项 | 改动文件 | 估时 | 验收 |
|---|---|---|---|---|
| P1-1 | Target v2 + 迁移 + 打分器（4.2）+ 易变 id 识别 | `flowcore.ts`、`FlowVm.java`（透传）、新 `FlowLocator.java` | 3 | 测试台：id 改名 / 文字改动 / 列表顺序变化下定位成功率 ≥ 90% |
| P1-2 | 录制 v2：pre/post 指纹、全属性 target、子树、缩略图与裁剪图、页面库、自动 expect、整理规则 | `LumiFlow.java`（`onEvent`）、新 `FlowSnapshot.java`、`flow.ts consumeRecording`、`flowcore.ts tidy` | 4 | 新录制的步骤 100% 带 pre/expect；红点（仅坐标）步比例下降（记录基线对比） |
| P1-3 | 缓存 `resolved` + versionCode 失效 + 文件存储 | `flowcore.ts`、`flow.ts`、`PhonePlugin.java`（取 versionCode、读写私有目录） | 2 | 升级应用后首跑能复核 / 自愈，不会反复使用失效缓存 |
| P1-4 | T2：ML Kit 中文 bundled OCR + dHash 图标比对；APK 体积评估 | `android/app/build.gradle`、新 `FlowOcr.java` | 3 | 体积增量记录；自绘按钮基准上 OCR 层救回率统计 |
| P1-5 | 自愈阶梯 L0–L5 + 补丁 + 用户确认卡 + 回滚 | `LumiFlow.java`、`vision.ts`（接管提示词）、`flow.ts`、`flowui.tsx` | 4 | 测试台注入的 6 类故障中 ≥ 4 类可自动救回并生成补丁 |
| P1-6 | 编辑器稳定度圆点、坐标步人话描述、「让 AI 加固」 | `flowui.tsx`、`index.css` | 1.5 | e2e 截图 |
| P1-7 | 回放测试台 `TraceScreen` + 诊断包导出 | `scripts/flowvm-test/`、`LumiFlow.java` | 2 | CI 跑通 |

### P2：智能与规模（约 20+ 人日）

- P2-1 `goal` 步 + 网关 `phone-agent` 模型别名 + 动作集对齐 AutoGLM（5 人日）。
- P2-2 轨迹固化：`goal` 成功两次轨迹一致 → 提示转确定性步骤（3 人日）。
- P2-3 中断规则学习（VLM 分类 → 用户确认 → 写入应用规则）（3 人日）。
- P2-4 打分权重离线学习（从本地运行记录导出，学习排序）（4 人日）。
- P2-5 跨设备 / 分辨率：box 归一化 + 滚动搜索（SARA 式自适应）（3 人日）。
- P2-6 指标面板与匿名统计（用户同意后）（3 人日）。

---

## 12. 参考资料（本次实际打开过的来源）

**智能体 / 模型**
- [R-AutoGLM] Open-AutoGLM README（动作集、人工接管、敏感操作确认、0–1000 坐标、支持 50+ 中文应用、BigModel `autoglm-phone`）：https://github.com/zai-org/Open-AutoGLM
- [R-AutoGLM-code] Open-AutoGLM 源码 `phone_agent/config/timing.py`、`phone_agent/adb/device.py`、`phone_agent/actions/handler.py`（每个动作后默认 1.0 s；坐标 /1000 换算）：https://raw.githubusercontent.com/zai-org/Open-AutoGLM/main/phone_agent/config/timing.py ， https://raw.githubusercontent.com/zai-org/Open-AutoGLM/main/phone_agent/actions/handler.py
- [R-AutoGLM-paper] AutoGLM: Autonomous Foundation Agents for GUIs（中文应用常见任务 89.7%，AndroidLab 36.2%）：https://export.arxiv.org/abs/2411.00820
- [R-MAv2] Mobile-Agent-v2（规划 / 决策 / 反思三智能体；正确 / 错误 / 无效三类反思；+30% 以上）：https://arxiv.org/abs/2406.01014 ，正文 https://arxiv.org/html/2406.01014v1
- [R-MAE] Mobile-Agent-E（Tips 与 Shortcuts 长期记忆，+22%）：https://arxiv.org/abs/2501.11733
- [R-MAv3] Mobile-Agent-v3 / GUI-Owl（AndroidWorld 73.3）：https://arxiv.org/abs/2508.15144
- [R-UITARS] UI-TARS（AndroidWorld 46.6）：https://arxiv.org/abs/2501.12326
- [R-UITARS2] UI-TARS-2 技术报告（AndroidWorld 73.3）：https://export.arxiv.org/abs/2509.02544
- [R-AppAgent] AppAgent（自主探索或观察人工演示生成知识库）：https://export.arxiv.org/abs/2312.13771
- [R-AppAgentX] AppAgentX（从历史中进化 shortcut 节点）：https://arxiv.org/abs/2503.02268 ，正文 https://arxiv.org/html/2503.02268v3
- [R-AutoDroid] AutoDroid（UTG 记忆、剪枝不可见 / 合并等价元素、动作准确率 90.9%、任务成功率 71.3%）：https://arxiv.org/abs/2308.15272 ，正文 https://arxiv.org/html/2308.15272v4
- [R-DroidAgent] DroidAgent（意图驱动的 LLM GUI 测试，活动覆盖 61% vs 51%）：https://export.arxiv.org/abs/2311.08649
- [R-DroidBot] DroidBot 源码 `device_state.py`（状态串 = 前台 Activity + 排序视图签名；内容无关签名 = class + resource-id；MD5）：https://raw.githubusercontent.com/honeynet/droidbot/master/droidbot/device_state.py ，README：https://github.com/honeynet/droidbot
- [R-OmniParser] OmniParser（截图解析为可交互区域 + 语义）：https://export.arxiv.org/abs/2408.00203 ，仓库 README：https://github.com/microsoft/OmniParser

**基准**
- [R-AW] AndroidWorld（116 个任务、20 个应用，最好基线 30.6%）：https://export.arxiv.org/abs/2405.14573
- [R-AWcode] AndroidWorld 源码 `env/interface.py` `_get_stable_state`（连续 3 次相同、间隔 0.5 s、超时 6 s）与 `agents/m3a.py`（动作后等 2.0 s）：https://raw.githubusercontent.com/google-research/android_world/main/android_world/env/interface.py
- [R-AitW] Android in the Wild（71.5 万条轨迹、3 万条指令、Android 10–13、8 种设备）：https://export.arxiv.org/abs/2307.10088

**Android 平台与测试框架**
- [R-UiAutomation] `UiAutomation.waitForIdle(idleTimeoutMillis, globalTimeoutMillis)` 语义：https://developer.android.com/reference/android/app/UiAutomation
- [R-UiAutoSrc] androidx UiAutomator `QueryController.java`（`QUIET_TIME_TO_BE_CONSIDERED_IDLE_STATE = 500`）：https://raw.githubusercontent.com/androidx/androidx/androidx-main/test/uiautomator/uiautomator/src/main/java/androidx/test/uiautomator/QueryController.java ；Configurator 默认值（10 s / 10 s / 3 s）：https://android.googlesource.com/platform/frameworks/uiautomator/+/android-support-test/src/main/java/android/support/test/uiautomator/Configurator.java
- [R-Appium] Appium UiAutomator2 Settings（waitForIdleTimeout 10000、waitForSelectorTimeout 10000、actionAcknowledgmentTimeout 3000）：https://appium.github.io/appium-uiautomator2-driver/latest/reference/settings/
- [R-AE] `AccessibilityEvent`（TYPE_WINDOW_STATE_CHANGED / TYPE_WINDOW_CONTENT_CHANGED / TYPE_WINDOWS_CHANGED、CONTENT_CHANGE_TYPE_*、WINDOWS_CHANGE_*）：https://developer.android.com/reference/android/view/accessibility/AccessibilityEvent
- [R-ASI] `AccessibilityServiceInfo`（notificationTimeout 定义、FLAG_INCLUDE_NOT_IMPORTANT_VIEWS）：https://developer.android.com/reference/android/accessibilityservice/AccessibilityServiceInfo
- [R-ANI] `AccessibilityNodeInfo`（refresh、findAccessibilityNodeInfosByViewId / ByText、getChild 预取策略、MAX_NUMBER_OF_PREFETCHED_NODES = 50）：https://developer.android.com/reference/android/view/accessibility/AccessibilityNodeInfo
- [R-AS] `AccessibilityService.takeScreenshot` 与 `ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT`：https://developer.android.com/reference/android/accessibilityservice/AccessibilityService
- [R-MaestroDocs] Maestro 文档（内建容错 / 自动等待；assertVisible 自动重试最长 7 s）：https://docs.maestro.dev/reference/commands-available/assertvisible ，https://github.com/mobile-dev-inc/maestro-docs
- [R-MaestroSrc] Maestro 源码解读（查找 17 s / 可选 7 s、无变化重试 2 次、截图差 0.5%、settle 200 ms × 10）：https://devicelab.dev/blog/maestro-flakiness-code-deep-dive
- [R-Hamibot] Hamibot（Auto.js 系）选择器文档（findOne(timeout)、boundsInside、depth、indexInParent、drawingOrder、textMatches）：https://docs.hamibot.com/reference/widgetsBasedAutomation
- [R-Midscene] Midscene.js 缓存文档（规划缓存与 XPath 定位缓存、失效回退、回退结果不写回缓存）：https://midscenejs.com/caching.html

**录制回放与定位鲁棒性研究**
- [R-SARA] SARA: Self-Replay Augmented Record and Replay for Android in Industrial Cases（ISSTA 2019；自适应回放：自动滑动查找控件、按屏幕参数变换坐标；同设备回放 86.0% vs appetizer 60.7% vs RERAN 10.9%）：https://github.com/microsoft/SARA （论文 PDF：https://github.com/microsoft/SARA/raw/master/SARA%20--%20ISSTA2019.pdf ）
- [R-Industry17] Record and Replay for Android: Are We There Yet in Industrial Cases?（ESEC/FSE 2017 Industry，微信场景；固定延时不足导致失败，加到 30 s 才稳定；RERAN 换分辨率无法回放）：https://taoxiease.github.io/publications/esecfse17industry-replay.pdf
- [R-RERAN] RERAN 项目页：https://androidreran.com/
- [R-Similo] Similo: Similarity-based Web Element Localization（TOSEM；失败 11% vs 27%，平均 4 ms）：https://research.chalmers.se/en/publication/536319 ，https://arxiv.org/abs/2208.00677
- [R-VONLLM] VON Similo LLM（804 对元素，失败 70 → 40）：https://gup.ub.gu.se/publication/362894
- [R-SimiloRank] Ranking approaches for similarity-based web element location（学习排序替代静态权重）：https://research.chalmers.se/en/publication/544187

**端侧 OCR**
- [R-MLKit] ML Kit Text Recognition v2（Android，含中文；bundled / unbundled 依赖名）：https://developers.google.com/ml-kit/vision/text-recognition/v2/android
- [R-MLKitPaths] ML Kit 安装方式（bundled 计入 APK、unbundled 依赖 Play 服务）：https://developers.google.com/ml-kit/tips/installation-paths
- [R-TextDet] 端侧文字检测选型整理（ML Kit bundled 每体系每架构约 4 MB；PP-OCR tiny 约 6.4 MB + 运行时）——第三方整理，体积需自测：https://textdet.com/guides/text-detection-android-ios
- [R-Paddle] PaddleOCR README（PP-OCRv6 tiny 1.5M / small 7.7M / medium 34.5M 参数）：https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/README.md

**未能确认 / 需真机核实的点**
- 小红书等应用 resource-id 被混淆的具体形式（本文示例中的 `0_resource_name_obfuscated` 是社区常见说法，未找到一手来源）。
- `takeScreenshot` 的最小间隔具体值（公开文档只给出错误码）。
- 各国产 ROM 权限弹窗的包名。
- 第 3.4 节所有阈值、第 4.1 节各层耗时、OCR 体积增量——均为初值，P0-9 / P1-4 用真机数据标定。
