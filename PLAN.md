# 栖语 Lumi v0.7 改动计划（交接文档）

## v0.22（2026-11-18，分支 v017-flow）
用户反馈（手机上 Flow 编辑器截图，左边常驻图标栏 新对话 / 技能 / MCP）：去掉常驻图标栏；Flow 继续录制；子 Flow（自定义 / 合并动作）；Inter 不好看换西文字体。这次用户说不用跑测试（没写 e2e_v22，只保证 `npm run build` 通过 + 截图）。

- **侧栏**（App.tsx `useLongPress`、index.css 末尾「v0.22 侧栏」）：回到原来的抽屉：手机默认隐藏，首页左上 / 页面头 / 子页头 / 对话顶栏都有侧栏按钮，单击打开完整侧栏（盖在内容上 + 遮罩，点外面或选完关），桌面默认展开推开内容、单击收起。图标栏只在**长按**侧栏按钮（480 ms，安卓上带震动）后出现，再长按隐藏，存 `localStorage 'lumi.sideRail'`（'1' 显示）；图标栏和完整侧栏里的按钮同样是单击开关抽屉、长按开关图标栏。`.app` 类名：`side-open`（抽屉开）+ `rail-on / rail-off`；`lumi.sideMini` 不再使用。图标栏开着时页面头里的侧栏按钮隐藏（用图标栏顶部那个）。
- **继续录制**：编辑器步骤下面「添加步骤 / 继续录制」两个按钮；继续录制 = `startRecording({appendTo, at})` → 原生 `recordStart({resume:true})`（LumiFlow：不记打开应用这一步，用启动 Intent 把应用切回前台，悬浮条显示「继续录制 · 新增 N 步」，撤销可撤到 0 步）。回到 App 时 `consumeRecording()`（flow.ts，新建录制和继续录制共用，App.tsx 的 `useRecordReturn` 和编辑器都调它）→ `appendRecorded()` 把新步骤（tidy，去掉重复的打开应用）插到展开那一步后面，没有展开就接在最后，提示「已接上 N 步」。网页版提示「只有安卓 App 里可以录制」。
- **子 Flow**：沿用已有的 `call` 步（以前只是内联、无参数、3 层），升级为「把另一个已保存的 Flow 当一步」：`{kind:'call', flowId, args?}`，args 给子 Flow 的 `{参数}` 传值（可写 `{外层参数}` / `${变量}`），没传的用外层同名参数（runFlow 展开后再 fill 一次）；最多嵌套 `MAX_SUBFLOW_DEPTH = 5` 层（类方法仍 3 层）。校验：不能调用自己、`subflowGraph` 找循环（报「A → B → A」）、超过 5 层报错、子 Flow 参数没传 / 多传给提示。展开时循环 / 超深保留原 call 步，原生 FlowVm 报错停下（原有行为）。编辑器：时间线上是一步，节点是子 Flow 应用的图标，卡片写子 Flow 名称、应用、步数、传参，玫红色「子 Flow」标签；展开后选 Flow（带图标的列表，会造成循环的灰掉）、「换一个」「打开」、参数表。添加步骤弹窗「子 Flow 与类」组里的「子 Flow」。**合并**：步骤标题右边「多选」，点选连续步骤 →「合并为子 Flow」（起名）→ `extractSubflow()` 新建一个同应用的 Flow（参数自动带上），原位置换成一个 call 步并把参数原样往下传；块（如果 / 循环）没选完整、选了打开应用（不在第一步）、选了方法进出步时不让合并（`canExtract`）。AI：flow_save 工具描述、对话里按任务生成 Flow 的 `CUSTOM_PROMPT` 第 8 条、编辑器「用 AI 优化」提示词都写了 call{flowId, args}，优化时把已有 Flow 列表发给模型。
- **西文字体**：Inter → **Hanken Grotesk**（OFL，@fontsource-variable 5.3.0 的 latin 可变字重 woff2，34.7 KB，`src/assets/fonts/HankenGrotesk-latin-wght.woff2` + `OFL-HankenGrotesk.txt`）。对比了 Instrument Sans / Hanken Grotesk / Figtree / Geist（`design/v22/font-compare.png`，同一张卡片：编辑 Flow、新的 Flow、用 AI 优化、50% · 12%）：Instrument Sans 字距太紧、数字挤在一起；Figtree 偏圆、几何感和衬线中文不搭；Geist 偏技术感、和 Inter 差不多硬；Hanken Grotesk 是带人文味的 grotesque，字怀开、笔画温和，最接近 Anthropic Sans 的感觉，和 Noto Serif SC 放一起最协调。字体栈 `"Anthropic Sans","Hanken Grotesk","Noto Serif SC",…`（Anthropic Sans 仍只按名字引用不打包）。Inter 文件和许可证已删。
- **版本**：0.22.0（versionCode 23），设置页页脚 v0.22。
- **截图**：`python3 scripts/v22_shots.py` → `design/v22/`：home-no-rail / home-drawer / home-rail（长按后）、flow-editor-subflow（+ 展开子 Flow 步、多选合并）、desktop-home（默认展开）/ desktop-home-closed、font-compare，合成 `design/v22/v22_preview.jpg`。脚本里顺带打印了状态：默认无图标栏、单击开抽屉、点遮罩关、长按出图标栏（main left 64px，存 '1'）、再长按隐藏（存 '0'），全部无横向溢出、无页面报错。
- **没测**：按用户要求没写 / 没跑 Playwright 测试（e2e_v21 里检查 Inter 的 4 项字体断言现在会失败，需要改成 Hanken Grotesk；侧栏相关断言基于旧的常驻图标栏，也要改）；`node scripts/flow-test.mts` 没跑；原生继续录制、子 Flow 真机运行没上真机；Java 只靠 CI 的 Gradle 编译。

## v0.21（2026-11-18，分支 v017-flow）
需求：网页版全功能 Playwright 端到端测试并修 bug；字体改成「中文一律衬线、西文 Anthropic Sans」；侧栏长按暂不改（等参考图）；版本 0.21.0、出新 APK。

- **测试**：新脚本 `scripts/e2e_v21.py`（段：chat side rp pages pages2 flow native custom fonts；不写就全跑，单次超 2 分钟时分段跑）+ 模拟网关 `scripts/mock_sse.py`（真 SSE 逐块输出、工具调用、AI 视觉非流式、/v1/usage、最小 MCP；请求写到 /tmp/mock_reqs.jsonl 供断言系统提示 / 工具列表）。`native` 段复用 v20 的 LumiPhone 模拟（运行、AI 视觉写回、应用图标）。每次截图都检查横向溢出和 `.app` 是否被滚动；收集 console error / pageerror / HTTP ≥400。结果 218 项全部通过（chat+side+rp 54、pages+pages2+flow 92、native+custom+fonts 72），无页面报错（剩下的 404 / ERR_UNSAFE_PORT 是测试故意请求的失败地址）。`node scripts/flow-test.mts` 59 项通过，oxlint 0 错误（19 个旧警告）。
- **修的 bug**：
  1. 整个 `.app` 会被聚焦 / scrollIntoView 往上推（`overflow:hidden` 仍可被程序滚动），露出藏在底下的「选择模式」面板、侧栏图标栏被切掉 → `.app` 改 `overflow:clip`（保留 hidden 兜底）。
  2. 角色状态卡的进度条被 Flow 运行明细同名的 `.rp-bar` 样式覆盖（宽 56px、overflow hidden，看不到 84/100 数值）→ 运行明细的规则限定为 `.rp-list .rp-bar`。
  3. 网页版运行 Flow 显示英文报错「"LumiPhone" plugin is not implemented on web」→ `runFlow` 在网页版直接给中文提示。
  4. 发送后输入框不回到一行高（对话页和首页都是）→ 发送时清掉 textarea 的内联高度。
  5. 手机工具在网页版失败时（phone_screen）步骤里不显示原因 → 失败时显示结果。
  6. 壁纸选到打不开的图片会抛未处理的异常 → try/catch 提示「这张图片打不开」。
  7. MCP 地址是本机 / 内网 IP 时去请求 duckduckgo / google 的图标（必然失败，控制台报错）→ 这类地址直接用玻璃插头图标。
- **字体**（`src/index.css` 顶部 @font-face + `--font`）：`"Anthropic Sans", "Inter", "Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", serif`；`--serif` 也指向它（标题同样是中文衬线 + 西文无衬线）。Anthropic Sans 是 Anthropic 专有字体，只按名字引用不打包；开源替身 Inter（OFL，latin 子集可变字重 48 KB），它的 unicode-range 去掉了 — ‘’“” … 让中文引号、省略号、破折号走衬线。中文衬线打包 Noto Serif SC 子集（OFL，`src/assets/fonts/`，许可证文本同目录）：Regular = GB2312 全部 6763 字 + 标点（2.68 MB），SemiBold（600–900）= GB2312 一级 3755 字（1.52 MB），共约 4.2 MB；本机有 Noto Serif SC / 思源宋体时先用本机的（local()）。子集外的生僻字退回系统字体。代码块、`.mono` 仍是等宽；角色卡 HTML 沙箱 iframe 默认字体也改成同一栈（iframe 里拿不到打包字体，退回系统衬线）。实测：把系统 Noto Serif CJK 移走后中文仍渲染成打包的衬线。
- **侧栏长按**：没动（等用户参考图）。
- **版本**：0.21.0（versionCode 22），设置页页脚 v0.21。
- **截图**：`design/v21/`：chat-fonts.png（新字体的对话）、flow-bento.png（Flow 总览）、flow-editor.png（编辑器时间线），合成预览 `design/v21/v21_preview.jpg`。
- **没测到 / 限制**：原生部分（无障碍读屏、录制、ADB 配对 / shell、SAF 文件夹、真实应用图标渲染、悬浮条）只能在真机上测，这次测的是网页回退提示和模拟插件下的界面；图片 / 视频生成只测了失败提示（模拟网关不出图）；chub.ai 链接导入只测了失败提示（沙盒外网不通）；真网关 api.qigai.tech 没连（全用模拟网关）。

## v0.20（2026-11-18，分支 v017-flow）
用户需求（原话）：「头像使用app原生图标 还有 支持在聊天里面定制技能，mcp，flow并且flow是结合ai视觉的一套针对任务，新版apk」。保留 v0.19 布局（便当格、钱包叠卡）和白底 + 主题色浅渐变卡面。

- **原生应用图标做头像**：`AppIcon`（flowui.tsx）/ `appLook`（appicon.ts）在真机上统一走 `Phone.appIcon`。改动：先按包名、再按应用名找（原生侧打分：完全相同 > 名字包含 > 被名字包含 ≥2 字，去空白、不分大小写）；拿到后同时记在包名键和应用名键下；缓存里没有图标的条目每个会话重试一次，回到前台（`visibilitychange`）再放开一次（可能刚装了应用），通过 `lumi-appicon` 事件让已挂载的图标刷新；localStorage 存不下时只存配色不存图。Java `PhonePlugin.appIcon` 取启动 Activity 的图标（`getActivityIcon`，和桌面一致），自适应图标（API 26+）手动把背景层 / 前景层按 108/72 放大画进 22% 圆角方形，普通图标按 intrinsic 尺寸等比画进 160px，画出来全透明退回 `Drawable.draw`，输出 PNG data URL。叠卡标题条加了应用图标（右下角小徽标是 Flow 类型）；对话里的 Flow 确认卡 / 运行卡也用应用图标。占位方块只在没装这个应用或网页版出现。
- **在对话里定制技能 / MCP / Flow**（`src/custom.ts`，纯模块可在 node 里测）：新工具 `skill_list / skill_save / skill_delete`、`mcp_list / mcp_add / mcp_remove`、`flow_delete`，`flow_list / flow_save` 普通对话里也能用，`flow_run` 只在安卓 App 里给。改动类工具不直接写，先生成确认卡（`ChatCard`，挂在 `Step.card` 上，存进对话）：卡上列出要保存的内容（技能的提示词 / 开场白；MCP 的地址、令牌是否填写（不显示内容）、连接测试结果；Flow 的步骤（带「AI 视觉 / 逻辑 / 变量 / 需确认」标签）、参数、速度说明），用户点「保存」才写入，点「取消」把取消告诉模型；保存后可「撤销」（恢复 before，新建的删掉，删除的放回）。工具循环在等确认时挂起（`waitDecision`），停止生成按取消处理；重开 App 后旧的待确认卡显示「已失效」。技能存 `lumi.skills`（内置 6 个不能改删，技能页显示「自定义」标签）；MCP 地址校验（http/https、像域名、外网 http 给警告），用现有 `probeMcp` 测连接（8 秒超时，失败也能保存）；App 监听 `lumi-mcp` 事件刷新 MCP 列表。Flow 保存前跑 `validateFlow + validateClasses`，有错误不出卡，把错误还给模型改。设置里新开关「在对话里定制」（默认开）。系统提示词 `CUSTOM_PROMPT` 告诉模型什么时候用、确认卡怎么回事。
- **Flow = 按任务生成的 AI 视觉工作流**：`CUSTOM_PROMPT` 里写了生成规则：launch（附常见包名），只在确定时写原生选择器，否则 `ai{goal, act}`；会变的写 `{参数}`，数量用 for；if/exists 处理弹窗；付款 / 下单 / 发送 / 删除加 `confirm:true`；「每天」交给定时任务。入口：Flow 总览「按任务生成」按钮、空状态按钮、新应用弹窗顶部「不想录？按任务生成」、应用页头卡「按任务生成」（预填「在{应用}里」）、对话输入框「+」菜单「按任务生成 Flow」；弹窗里有示例，提交后新开对话发给模型。确认卡保存后有「试跑」（安卓 App）：跑一次，AI 视觉找到的位置自动写回（`applyLearned`），卡上显示结果和运行明细；还有「打开」进编辑器。修了一个写回 bug：目标带 `${变量}` 的 ai 步（循环里的「第 ${i} 篇」）以前会把第一次的选择器写死，现在和带 `{参数}` 的一样不写回（`hasDynamic`）。定时任务的提示词是「运行 Flow「名称」」时直接在手机上跑这个 Flow（不经过模型）。
- **诚实口径**：确认卡和 README 写明：原生步和已缓存的步约 1 秒一步；AI 视觉步没缓存时每步一次模型往返（几秒）；目标带参数或变量的 AI 步不缓存、每次都走视觉。
- **版本**：0.20.0（versionCode 21），设置页页脚 v0.20。
- **截图**：`python3 scripts/v20_shots.py [phone|desktop]` → `design/v20/`：模拟的 `Phone.appIcon` 返回品牌色 PNG（不是真机图标），便当格 / 叠卡 / 编辑器 / 按任务生成弹窗（390 / 360）、技能页（含自定义技能）、MCP 页；对话里拦截 `/v1/chat/completions` 返回工具调用：Flow 确认卡（待确认 → 已保存 → 试跑后写回 2 个选择器）、技能确认卡、MCP 确认卡（连接测试成功 → 保存 → 撤销）；桌面便当格和叠卡。全部无横向溢出、无页面报错。
- **测试**：`npm run build` 通过；`node scripts/flow-test.mts` 59 项通过（+23：确认卡 / 保存 / 撤销 / 校验 / 等待确认 / ${变量} 不写回）；`scripts/flowvm-test/run.sh` 30 项通过；oxlint 0 错误（19 个旧警告）；Java 用 JDK 21 javac 对 android.jar（API 36）+ Capacitor 8.6.2 / AndroidX / libadb / BouncyCastle 的 jar 编译（除 MainActivity 缺传递依赖、未改动）通过。
- **未做 / 限制**：没上真机（图标渲染、试跑、确认卡在 WebView 里都没在手机上看过）；MCP 服务器目前只读工具列表，对话里还不会调用 MCP 工具；网页版 MCP 连接测试常被跨域拦住（卡上会提示，仍可保存）。

## v0.19（2026-11-18，分支 v017-flow，本地提交、未 push）
用户反馈（07:55）：「v0.18 的卡片布局还不如原版」——近白卡 + 两列平铺不好看；要 Figma Community Riffs 那样的卡片**排布**，图标要回到原版。

- **图标恢复原版**：`GlassIcon` 回到 v0.11 的两层玻璃图标（后面彩色底块旋转 -14°，前面磨砂玻璃片 + 白色线条图标），删掉 v0.18 在 index.css 里对 `.gi` 的覆盖；侧栏、图标栏（新对话 / 技能 / MCP）、我的、设置、AI 优化卡、各空状态都跟着恢复。应用图标占位回到 v0.17：mesh 渐变底 + 白色衬线首字，外面白框（`.fa-ring`）。
- **卡面恢复原版配色**：`appicon.ts` 的 `tint()` 回到 v0.17 的饱和 mesh 渐变（`meshBg`，白字在左下 deep 区）+ 新增 `meshTop`（deep 在顶部，给叠卡标题条和便当 hero 用）；`meshVars(t, top)` 写背景和 `--glow / --ink / --acc-soft`。加 Riffs 式层次：顶部 1px 发丝高光、1px 白描边、两层柔和扩散阴影，圆角 26–30px。`.riff`、`cardBg`、`riffVars` 已删。编辑页头卡、空状态三色块也回到 mesh。
- **Flow 总览 = 便当格**（参考 Riff「Bento UI Components」，`src/bento.ts`）：底层网格手机 4 列（一行两个正方形）、≥720px 8 列（一行四个），行高 = 列宽（`container-type:inline-size` + `cqi`），间距 12 / 14px。应用按 Flow 数排序（同数按出现顺序），第 1 名是 hero（2×2 个正方形：顶部深色条放图标 + 衬线名，下面奶白面板列出最多 3 个 Flow，每行有播放键直接运行），之后按 wide（2×1，右侧两个白色胶囊直接运行）、tall（1×2，大号淡水印字 + 胶囊）、sq、sq 循环。摆放用天际线算法（以正方形为单位放到最低最左的位置，宽度不够就降级 hero→wide→sq、wide→sq；tall 后面不足两格就用 sq），手机和桌面各算一次，位置写成 CSS 变量（`--pc/--pr/--pw/--ph`、`--dc/--dr/--dw/--dh`），中间永远不留洞；「新应用」补在最后：只剩一格时是方格，整行空时是半高胶囊卡。单测：1–30 个应用 × 两种宽度无重叠无洞。
- **应用页 = 钱包叠卡**（参考 Riff「Five glossy cards」+「Card shuffle」）：每个 Flow 一张 meshTop 卡（同应用按序号换邻近色相，和 v0.17 一样），卡片重叠只露 62px 标题条（图标、名称、说明、白色播放键）；最后一张露出卡面（衬线大序号 + 提示）。点标题条抬起展开（弹簧，`grid-template-rows 0fr→1fr` + margin 过渡），奶白面板里列前 6 步、「编辑」「运行」；前面的卡仍压在下面只露标题条，后面的卡让开 12px；再点收起。≤2 个 Flow 时全部直接展开。运行逻辑抽成 `useRunner()`，总览和应用页共用（参数表、运行明细面板）。
- **侧栏**：保持 v0.18 行为（关上 = 图标栏），图标换回原版玻璃图标。
- **对比度**：`node scripts/contrast.mjs` 加了 v19 项（白字 vs deep / mid + 底纱、奶白面板上的墨字 / 灰字 / deep 字），全部 ≥4.5:1；mesh 是渐变，所以 `scripts/v19_shots.py` 另做像素实测：把白字设透明后截图，取每个文字框背景 98 分位最亮像素算对比度——390 / 360 / 1280 下便当格最低 4.83（美团 360px），叠卡标题全部 ≥4.6（最低是 34px 大号序号 4.61，大字门槛 3:1）。
- **版本**：0.19.0（versionCode 20），设置页页脚 v0.19。README 加 v0.19 说明和 5 个排布 Riffs 署名（只看公开预览，没有复制素材）。
- **截图**：`python3 scripts/v19_shots.py [phone|desktop]` → `design/v19/`：手机 390 / 360 各一套（图标栏、便当格、叠卡收起、叠卡展开一张、≤2 个时的平铺叠卡、编辑器头卡、我的），桌面便当格和叠卡展开；全部无横向溢出、无页面报错。
- **测试**：`npm run build` 通过；`node scripts/flow-test.mts` 36 项通过（+3 便当格）；`scripts/flowvm-test/run.sh` 30 项通过（JDK 21，/tmp/jdk）；oxlint 0 错误（19 个旧警告，和 v0.18 相同）。
- **未做**：push、真机验证（Android WebView 上 `cqi`、`grid-template-rows` 动画需要 Chromium 105+/107+，较新的 WebView 都支持，旧 WebView 上行高会退化）。

## v0.18（2026-11-18，分支 v017-flow，本地提交、未 push）
用户反馈：Flow 应用卡太丑（饱和多色 mesh 渐变 + 颗粒 + 白字）。参考 Figma Community「Riffs」重做，其他不好看的界面一起改；侧栏行为澄清：折叠态就是侧栏的关闭态。

- **设计语言**（`src/index.css` 末尾「v0.18 设计语言」一层，覆盖前面各版本的样式；参考资料见 README 致谢，没有复制任何素材）：浅色实底卡片 + 每张卡只有一个强调色（右上角同色淡光晕、图标块、数量徽标、阴影光晕）；层次靠 1px 发丝描边 + 顶部 1px 高光 + 大而柔的扩散阴影；面板圆角 16–26px，图标放在小 squircle 里，选中态是白色胶囊；标题中粗无衬线、说明文字灰 `#5c6270`；按下用短弹簧（`--spring-s`）。保留暖色浅主题（珊瑚 `#e0583e`、墨 `#141a26`、衬线大标题），没做暗色便当版。
- **Flow 卡片**：`appicon.ts` 的 `tint()` 返回 `cardBg`（近白单方向渐变 + 色族 soft 光晕）、`icon`（无图标时占位的单色渐变）、`ink`（色族 deep）；新增 `riffVars()` 把 `--acc / --acc-deep / --acc-soft / --glow` 写到卡上。应用卡、应用头卡、Flow 卡、编辑页头卡都用 `.riff`（`.mesh` 不再使用）。同一应用的 Flow 卡统一用该应用的强调色（不再按序号换色相）。Flow 卡：左上图标块、右上「更多」，名称最多两行，底部一行说明 + 播放键（播放键从顶部移到底部，360px 下不再挤）。桌面卡片比例 5:4，避免大片空白。
- **其他界面**：`GlassIcon` 从「彩色底 + 磨砂玻璃两层」改成单个色调 squircle + 深色线条图标（侧栏、我的、设置、AI 优化卡等全部跟着变）；我的 / 设置列表、套餐卡、模式面板、添加步骤 / 类 / 参数弹窗、输入框（页面底上白色发丝边，卡片 / 弹窗里浅灰填充，聚焦珊瑚环）、首页输入卡、对话输入条、chip、按钮（墨色渐变胶囊、珊瑚按钮改用 `#cc4a2e→#c13f27` 保证白字 ≥4.5:1）、Flow 编辑器时间线（白卡 + 发丝边、节点 squircle）、运行明细；首页最近对话文件夹前盖改成奶白磨砂 + 深色标题（原来白字压在珊瑚色上对比度不够）。
- **对比度**：`node scripts/contrast.mjs` 检查墨字 / 灰字在白卡、页面底、弹窗上，徽标 deep 字在 soft 底上，白字在 deep 色 / 按钮上，全部 ≥4.5:1（最低 4.58，按钮渐变顶端）。`--label2` 从半透明改成实色 `#5c6270`。
- **侧栏**：折叠态就是关闭态——关上后左侧永远是一条图标栏（新对话 / 技能 / MCP + 顶部展开按钮），去掉了完全隐藏的抽屉、页面头和对话顶栏里的单独侧栏按钮。展开：桌面推开内容显示完整侧栏（288px）；手机是盖在内容上的抽屉（宽 `min(304px, 100vw-52px)`，右侧圆角 + 遮罩），点遮罩、选完条目或点折叠按钮回到图标栏。状态存 `localStorage 'lumi.sideMini'`（'1' 折叠，'0' 展开；没有记录时桌面默认展开、手机默认折叠）。内容区 `left` 始终等于图标栏宽（手机 64px、桌面 72px），不会被盖住；截图脚本里量了 `.side` 右边和 `.main` 左边。
- **版本**：0.18.0（versionCode 19），设置页页脚 v0.18。
- **截图**：`python3 scripts/v18_shots.py [phone|desktop]` → `design/v18/`（390px 和 360px 各一套：首页、图标栏、展开侧栏、对话、模式面板、Flow 网格、应用页、编辑器、添加步骤、类、试运行、我的、设置；桌面：图标栏、展开侧栏 + Flow 网格、折叠 + Flow 网格、应用页、编辑器），每张检查横向溢出，全部无溢出、无页面报错。`scripts/v17_shots.py` 依赖旧的页面侧栏按钮，已过时。
- **测试**：`npm run build` 通过；`node scripts/flow-test.mts` 33 项通过；`scripts/flowvm-test/run.sh` 30 项通过（JDK 21）。功能没改，只改了样式和侧栏开关逻辑。
- **未做**：push、真机验证（Android WebView 上的阴影 / 动画没看过）。

## v0.17（2026-11-18，分支 v017-flow，未 push）
用户：以 Flow 为主的新版本；官网 platform.qigai.tech（/keys 获取 Key、/upgrade 升级会员、/feedback 反馈），App 内入口都指过去；Flow 逻辑（if/else、for、while、do-while）验证端到端可用并修 bug，加 point / struct / class（字段 + 方法，方法体是子流程，new 实例化，obj.field，obj.method() 绑定 this）；AI 视觉步明显变快（目标约 1 秒一步）；Flow 卡片配色重做；侧栏可折叠，手机也要。

- **解释器拆分**：`android/.../FlowVm.java` 纯 Java（只依赖 org.json），LumiFlow 实现 `FlowVm.Host` 做真机动作。新增控制步 `new`、`bind`/`unbind`（方法调用），路径读写 `a.b.c`、`this.x`，`${路径}` 插值。`src/flowcore.ts` 是 TS 侧纯逻辑（类型、evalValue/evalVarCond、validateFlow/validateClasses、expandCalls、fill、applyLearned），`flow.ts` 只留存储、原生运行、视觉桥和模型工具。
- **修掉的 v0.16 bug**（都有测试）：`validateFlow` 对 dowhile 不出栈，任何 do-while Flow 都校验失败；for 区间超过 20 次被默认循环上限误判失败（for 默认上限改为区间长度，最多 1000）；`Flow.vars` 初始变量没传给原生；动作步（输入文字、按钮文字）里的 `${变量}` 原生不替换；`continue` 跳过了循环尾部的计数；嵌套上限把 if 也算进去；`'3f'`、`NaN` 这类被 Java parseDouble 当数字；单个引号字符串 `'abc'` 不去引号（TS→Java 端到端测试发现）。
- **类**：`Flow.classes: [{name, fields:{字段:默认值表达式}, methods:[{name, params?, steps | flowId}]}]`。`new{var, cls, args?}`；`method{var, method, args?, cls?}` 由 `expandCalls` 展开成 `bind{var, cls, method, args}` + 方法体 + `unbind`（运行时 this 绑定到对象引用，实参在调用方作用域求值，unbind 时恢复同名变量）。递归 / 超过 3 层 / 找不到时保留原步，原生报错停下。类型不匹配（对象不是该类）原生报错。`validateClasses` 校验类名、字段名、方法体（this 只能在方法里用）。
- **AI 视觉**（`ai{goal, act: tap|long|input, text?}`，以及 `tap` 上 `vision:true` 作兜底）：缓存的 `sel` 命中 → 原生，不调模型（结果标「缓存」）。未命中 → 截图（`takeScreenshot`，Android 11+，长边 720px、JPEG q60，下一步是 ai 时与步后等待并行预取）+ `dump(60)` 元素列表 → `flowVision` 事件 → JS `vision.ts` 用 Helium 非流式请求（不发 reasoning_effort ⇒ 网关 thinking disabled，max_tokens 40，temperature 0，只要 `{"i":n}` / `{"x","y"}` / `{"none":true}`），`flowVisionAnswer` 回传；元素编号直接拿节点，选择器记进 `learned`，`applyLearned` 写回 Flow（带 `{参数}` 的步不写回）。上游 4xx 拒收图片时本次会话改为只发元素列表。a11y 配置加 `canTakeScreenshot`。
- **每步耗时**：FlowVm 结果带 `trace[{pc, i, fid, label, ms, src}]`（src：native/cache/vision/coord/logic/skip/fail）、`visionMs`、`visionCalls`；编辑页「试运行」和应用页运行后显示运行明细面板，点一行定位到那一步。Flow 卡显示上次耗时。
- **编辑器**（`src/flowui.tsx`）：时间线按块缩进、按类别着色（逻辑紫、变量蓝、类青、AI 琥珀）；添加步骤弹窗分组（基础 / AI 视觉 / 逻辑 / 变量 / 类与子流程），块成对插入到当前展开步之后；条件编辑（出现 / 没有 / 屏幕包含 / 变量比较）；for、set、call、new、method（参数表）、ai 的专用表单；类编辑弹窗（字段、方法、方法体选 Flow 或写步骤 JSON）；实时校验（错误阻止试运行，警告只提示）；快速模式开关。AI 优化提示词允许把不稳定的点击换成 ai 步。
- **卡片**：`tint()` 改为 8 个饱和色族（珊瑚/琥珀/绿/青/蓝/靛/紫/玫）+ 石墨（低饱和图标），CSS mesh gradient + 底部黑纱 + SVG 颗粒，白字；文字区 deep 色对白字对比度 5.8–10.9:1（脚本算过）。应用卡、应用头图、Flow 卡、编辑页头卡统一。素材全部自绘，README 写明 CC0。
- **侧栏**：折叠态手机和桌面都生效（`lumi.sideMini`），图标栏只有 新对话 / 技能 / MCP + 展开按钮，带小字标签。桌面展开回完整侧栏；手机点展开临时拉出完整抽屉盖在图标栏上，选完或点遮罩回到图标栏。修了底部弹窗被侧栏挡住（main 层级）、手机输入卡「深度思考」被挤成竖排（与旧 `.think` 类名冲突）。
- **官网入口**：`feedbackPage()`；我的：升级会员 → /upgrade（外链）、用量与套餐（App 内）、获取 API Key → /keys、提交反馈 → /feedback；设置新增「会员与帮助」（升级会员、提交反馈、官网）；模式面板「订阅」、侧栏「升级」标签、会员页按钮都外链到 /upgrade。安卓里用系统浏览器打开。
- **版本**：0.17.0（versionCode 18）。
- **测试**：`node scripts/flow-test.mts`（33 项）、`scripts/flowvm-test/run.sh`（30 项，含 5 个 TS 展开 → Java 执行的端到端用例）、`python3 scripts/v17_shots.py`（16 张截图 + 横向溢出检查，原生插件是模拟的）。
- **诚实限制**：没跑 Gradle、没上真机——沙盒是 arm64，Android 的 aapt2 只有 x86-64，Gradle 走不到 javac；改用 JDK 21 的 javac 对 android.jar（API 36）+ 真实依赖 jar（Capacitor 8.6.2、AndroidX、libadb、BouncyCastle）编译全部 Java，通过；解释器逻辑在 JVM 上单测。截图、视觉定位、预取、写回都没在真机验证。AI 视觉每次未命中都要一次模型往返，1 秒不保证；内置网关的 Helium 目前接 DeepSeek，可能不收图片，会自动退回只发元素列表。没有局部作用域：方法里的普通变量是全局的（只有实参会在返回时恢复）；没有 return 值；struct 赋值是复制，对象（new 出来的）是引用。
- **未做**：push / PR（没有凭据）、真机验证、Gradle 出包、截图里的运行数据是模拟的。

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
